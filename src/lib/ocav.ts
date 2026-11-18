'use client'

import type { Table } from 'dexie'
import type { QueryClient } from '@tanstack/react-query'

import { db } from '@/lib/db'
import { downloadJson } from '@/lib/export'
import { embedImagesDeep } from '@/lib/embed-assets'
import type { ImportResult, MergeStrategy } from '@/lib/import'
import { filterByActiveWorld, getActiveWorldId } from '@/lib/world-scope'
import { importCharacterFolders, loadCharacterFolders } from '@/features/characters/folders'
import {
  importCustomSectionForOcav,
  readVisibleCustomSections,
} from '@/features/custom-sections/store'
import {
  applyRelationProjection,
  relationId,
  syncRelationsFromEntities,
} from '@/features/relations/services'
import type {
  Character,
  CharacterKind,
  Country,
  Event,
  RelationEntityType,
  RelationKind,
  RelationRecord,
  Tag,
  WorldEntry,
} from '@/types'

/**
 * OCAV = OC editor Archive Vault（对外显示为 .ocbak 分类备份）。
 *
 * 一个 .ocbak 文件只描述「一个分类」的数据，并显式写入 kind / table。
 * 导入端先校验 kind 与 payload.table 是否一致，再按表导入；绝不靠字段猜测，
 * 因此角色数据不会被当成国家，事件数据也不会被写进角色表。
 *
 * 角色/事件/国家导出时会把直接关联的对象放进 context（可自动补齐），
 * 世界观词条与自定义分类则只带 refs（按名称对齐，缺目标时跳过），
 * 避免导入时意外创建大量无关条目。
 */

export type OcavKind = 'character' | 'event' | 'country' | 'world-entry' | 'custom-section'
export type OcavTable = 'characters' | 'events' | 'countries' | 'worldEntries' | 'customSections'

export interface OcavRef {
  type: 'character' | 'event' | 'country' | 'world'
  id: number
  name: string
}

export interface OcavRelation {
  sourceType: RelationEntityType
  sourceId: number
  targetType: RelationEntityType
  targetId: number
  kind: RelationKind
  label: string
  directed: boolean
  color?: string
  arrow?: 'none' | 'forward' | 'reverse' | 'both'
  /** 同一对角色可能有多条关系；导出时带上原始 id 以提示导入端保留重复边。 */
  id?: string
}

export interface OcavPayloadContext {
  characters: Character[]
  events: Event[]
  countries: Country[]
  worldEntries: WorldEntry[]
  tags: Tag[]
}

export interface OcavFile {
  format: 'oc-editor-ocav'
  version: 1
  kind: OcavKind
  scope?: 'single' | 'all-character-kinds'
  exportedAt: string
  app: 'OC editor'
  world: { name: string; description?: string } | null
  payload: {
    table: OcavTable
    items: Record<string, unknown>[]
    contextMode: 'create' | 'link-only'
    context: OcavPayloadContext
    refs: OcavRef[]
    folders: Array<{ id: string; name: string }>
  }
  relations: OcavRelation[]
  meta: {
    label: string
    count: number
    contextCount: number
    relationCount: number
    includes: string[]
  }
}

export interface OcavSummary {
  kind: OcavKind
  table: OcavTable
  kindLabel: string
  label: string
  count: number
  contextCount: number
  relationCount: number
  worldName: string
  includes: string[]
}

export interface OcavDownload {
  name: string
  size: number
  count: number
}

export interface OcavImportResult extends ImportResult {
  kind: OcavKind
  kindLabel: string
  label: string
  relations: number
  contextAdded: number
}

const KIND_TABLE: Record<OcavKind, OcavTable> = {
  character: 'characters',
  event: 'events',
  country: 'countries',
  'world-entry': 'worldEntries',
  'custom-section': 'customSections',
}

const KIND_LABEL: Record<OcavKind, string> = {
  character: '角色',
  event: '事件',
  country: '国家',
  'world-entry': '世界观',
  'custom-section': '自定义分类',
}

const ALL_CHARACTER_INCLUDES = ['character', 'weapon', 'pet']
const DATE_STAMP = (): string => {
  const date = new Date()
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    : []
}

function boolValue(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(isRecord)
    : []
}

function safeName(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned || 'OC-editor'
}

function metaCount(file: Pick<OcavFile, 'payload' | 'relations'>): number {
  const context =
    file.payload.context.characters.length +
    file.payload.context.events.length +
    file.payload.context.countries.length +
    file.payload.context.worldEntries.length
  return file.payload.items.length + context + file.payload.refs.length
}

function makeFile(input: {
  kind: OcavKind
  scope?: 'single' | 'all-character-kinds'
  label: string
  includes: string[]
  world: OcavFile['world']
  table: OcavTable
  items: Record<string, unknown>[]
  contextMode: 'create' | 'link-only'
  context: OcavPayloadContext
  refs: OcavRef[]
  folders: Array<{ id: string; name: string }>
  relations: OcavRelation[]
}): OcavFile {
  const file: OcavFile = {
    format: 'oc-editor-ocav',
    version: 1,
    kind: input.kind,
    scope: input.scope,
    exportedAt: new Date().toISOString(),
    app: 'OC editor',
    world: input.world,
    payload: {
      table: input.table,
      items: input.items,
      contextMode: input.contextMode,
      context: input.context,
      refs: input.refs,
      folders: input.folders,
    },
    relations: input.relations,
    meta: {
      label: input.label,
      count: input.items.length,
      contextCount: 0,
      relationCount: input.relations.length,
      includes: input.includes,
    },
  }
  file.meta.contextCount = metaCount(file) - file.payload.items.length
  return file
}

async function downloadFile(file: OcavFile, name: string): Promise<OcavDownload> {
  const embedded = await embedImagesDeep(file)
  const json = JSON.stringify(embedded, null, 2)
  const size = new Blob([json]).size
  downloadJson(embedded, name)
  return { name, size, count: embedded.payload.items.length }
}

async function activeWorldSnapshot(): Promise<{
  id: number
  name: string
  description?: string
}> {
  const id = getActiveWorldId()
  if (id === null) throw new Error('请先选择一个世界观，再导出分类数据')
  const world = await db.worlds.get(id)
  return {
    id,
    name: world?.name ?? '当前世界观',
    description: world?.description,
  }
}

function usedTagIds(records: Array<Record<string, unknown>>): Set<number> {
  const ids = new Set<number>()
  for (const record of records) {
    for (const id of numberArray(record.tags)) ids.add(id)
  }
  return ids
}

function refOf(
  type: OcavRef['type'],
  row: { id?: number; name?: string; title?: string },
): OcavRef | null {
  if (row.id === undefined) return null
  return {
    type,
    id: row.id,
    name: row.name ?? row.title ?? '未命名',
  }
}

function collectRefs(input: {
  characters?: Character[]
  events?: Event[]
  countries?: Country[]
  worldEntries?: WorldEntry[]
}): OcavRef[] {
  const refs: OcavRef[] = []
  for (const row of input.characters ?? []) {
    const ref = refOf('character', row)
    if (ref) refs.push(ref)
  }
  for (const row of input.events ?? []) {
    const ref = refOf('event', { id: row.id, title: row.title })
    if (ref) refs.push(ref)
  }
  for (const row of input.countries ?? []) {
    const ref = refOf('country', row)
    if (ref) refs.push(ref)
  }
  for (const row of input.worldEntries ?? []) {
    const ref = refOf('world', { id: row.id, title: row.title })
    if (ref) refs.push(ref)
  }
  return refs
}

function relationIncludes(
  relation: RelationRecord,
  included: Map<RelationEntityType, Set<number>>,
): boolean {
  return (
    included.get(relation.sourceType)?.has(relation.sourceId) === true &&
    included.get(relation.targetType)?.has(relation.targetId) === true
  )
}

function serializeRelations(
  rows: RelationRecord[],
  included: Map<RelationEntityType, Set<number>>,
): OcavRelation[] {
  return rows
    .filter((row) => !row.deleted && relationIncludes(row, included))
    .map((row) => ({
      id: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      targetType: row.targetType,
      targetId: row.targetId,
      kind: row.kind,
      label: row.label,
      directed: row.directed,
      color: row.color,
      arrow: row.arrow,
    }))
}

async function loadBase(): Promise<{
  world: { id: number; name: string; description?: string }
  characters: Character[]
  events: Event[]
  countries: Country[]
  worldEntries: WorldEntry[]
  tags: Tag[]
  relations: RelationRecord[]
}> {
  const world = await activeWorldSnapshot()
  const [charactersRaw, eventsRaw, countriesRaw, entriesRaw, tags, relationsRaw] = await Promise.all([
    db.characters.toArray(),
    db.events.toArray(),
    db.countries.toArray(),
    db.worldEntries.toArray(),
    db.tags.toArray(),
    db.relations.toArray(),
  ])
  return {
    world,
    characters: filterByActiveWorld(charactersRaw).filter((row) => !row.deleted),
    events: filterByActiveWorld(eventsRaw).filter((row) => !row.deleted),
    countries: filterByActiveWorld(countriesRaw).filter((row) => !row.deleted),
    worldEntries: filterByActiveWorld(entriesRaw).filter((row) => !row.deleted),
    tags,
    relations: relationsRaw.filter(
      (row) => !row.deleted && (row.worldId === undefined || row.worldId === world.id),
    ),
  }
}

function emptyContext(): OcavPayloadContext {
  return { characters: [], events: [], countries: [], worldEntries: [], tags: [] }
}

// ── 导出：角色 / 武器 / 宠物 ───────────────────────────────────────────────

export async function exportCharactersOcav(options: {
  kind: CharacterKind | 'all'
  folderId?: string | null
  folderName?: string
}): Promise<OcavDownload> {
  const base = await loadBase()
  const allKinds = options.kind === 'all'
  let primary = base.characters.filter(
    (row) => allKinds || (row.entityKind ?? 'character') === options.kind,
  )
  if (options.folderId !== undefined) {
    primary = primary.filter((row) =>
      options.folderId === null ? !row.folderId : row.folderId === options.folderId,
    )
  }
  if (primary.length === 0) throw new Error('当前分类没有可导出的角色')

  const primaryIds = new Set(primary.map((row) => row.id).filter((id): id is number => id !== undefined))
  const relatedCharacterIds = new Set<number>()
  const relatedCountryIds = new Set<number>()
  const relatedEventIds = new Set<number>()
  for (const row of primary) {
    for (const related of row.relatedCharacters ?? []) {
      if (related.characterId && !primaryIds.has(related.characterId)) {
        relatedCharacterIds.add(related.characterId)
      }
    }
    if (row.countryId) relatedCountryIds.add(row.countryId)
    for (const id of row.relatedNations ?? []) relatedCountryIds.add(id)
    for (const id of row.relatedEvents ?? []) relatedEventIds.add(id)
  }

  const contextCharacters = base.characters.filter(
    (row) => row.id !== undefined && relatedCharacterIds.has(row.id),
  )
  const contextCountries = base.countries.filter(
    (row) => row.id !== undefined && relatedCountryIds.has(row.id),
  )
  const contextEvents = base.events.filter(
    (row) => row.id !== undefined && relatedEventIds.has(row.id),
  )

  const characterIds = new Set<number>([
    ...primaryIds,
    ...contextCharacters.map((row) => row.id as number),
  ])
  const countryIds = new Set<number>(contextCountries.map((row) => row.id as number))
  const eventIds = new Set<number>(contextEvents.map((row) => row.id as number))
  const included = new Map<RelationEntityType, Set<number>>([
    ['character', characterIds],
    ['country', countryIds],
    ['event', eventIds],
  ])

  const tagIds = usedTagIds([
    ...(primary as unknown as Array<Record<string, unknown>>),
    ...(contextCharacters as unknown as Array<Record<string, unknown>>),
    ...(contextCountries as unknown as Array<Record<string, unknown>>),
    ...(contextEvents as unknown as Array<Record<string, unknown>>),
  ])
  const tags = base.tags.filter((tag) => tag.id !== undefined && tagIds.has(tag.id))
  const folderIds = new Set(
    primary.map((row) => row.folderId).filter((id): id is string => typeof id === 'string'),
  )
  const folders = loadCharacterFolders()
    .filter((folder) => folderIds.has(folder.id))
    .map((folder) => ({ id: folder.id, name: folder.name }))

  const label = allKinds
    ? '全部角色'
    : options.kind === 'weapon'
      ? '武器'
      : options.kind === 'pet'
        ? '宠物'
        : '角色'
  const folderSuffix = options.folderName ? `-${options.folderName}` : ''
  const file = makeFile({
    kind: 'character',
    scope: allKinds ? 'all-character-kinds' : 'single',
    label: `${label}${folderSuffix}`,
    includes: allKinds ? ALL_CHARACTER_INCLUDES : [options.kind],
    world: { name: base.world.name, description: base.world.description },
    table: 'characters',
    items: primary as unknown as Record<string, unknown>[],
    contextMode: 'create',
    context: {
      characters: contextCharacters,
      events: contextEvents,
      countries: contextCountries,
      worldEntries: [],
      tags,
    },
    refs: collectRefs({ characters: primary }),
    folders,
    relations: serializeRelations(base.relations, included),
  })
  const name = `${safeName(`${label}${folderSuffix}`)}-${safeName(base.world.name)}-${DATE_STAMP()}.ocbak`
  return downloadFile(file, name)
}

// ── 导出：事件 ─────────────────────────────────────────────────────────────

export async function exportEventsOcav(): Promise<OcavDownload> {
  const base = await loadBase()
  if (base.events.length === 0) throw new Error('当前世界观没有可导出的事件')
  const primary = base.events
  const primaryIds = new Set(primary.map((row) => row.id).filter((id): id is number => id !== undefined))
  const characterIds = new Set<number>()
  const countryIds = new Set<number>()
  const relatedEventIds = new Set<number>()
  for (const row of primary) {
    for (const id of row.characters ?? []) characterIds.add(id)
    for (const id of row.countries ?? []) countryIds.add(id)
    if (row.parentEventId) relatedEventIds.add(row.parentEventId)
    for (const relation of row.relations ?? []) relatedEventIds.add(relation.targetId)
  }
  const contextCharacters = base.characters.filter(
    (row) => row.id !== undefined && characterIds.has(row.id) && !primaryIds.has(row.id),
  )
  const contextCountries = base.countries.filter(
    (row) => row.id !== undefined && countryIds.has(row.id),
  )
  const contextEvents = base.events.filter(
    (row) => row.id !== undefined && relatedEventIds.has(row.id) && !primaryIds.has(row.id),
  )
  const included = new Map<RelationEntityType, Set<number>>([
    ['character', new Set(contextCharacters.map((row) => row.id as number))],
    ['country', new Set(contextCountries.map((row) => row.id as number))],
    ['event', new Set([...primaryIds, ...contextEvents.map((row) => row.id as number)])],
  ])
  const tagIds = usedTagIds([
    ...(primary as unknown as Array<Record<string, unknown>>),
    ...(contextCharacters as unknown as Array<Record<string, unknown>>),
    ...(contextCountries as unknown as Array<Record<string, unknown>>),
    ...(contextEvents as unknown as Array<Record<string, unknown>>),
  ])
  const tags = base.tags.filter((tag) => tag.id !== undefined && tagIds.has(tag.id))
  const file = makeFile({
    kind: 'event',
    label: '事件',
    includes: ['event'],
    world: { name: base.world.name, description: base.world.description },
    table: 'events',
    items: primary as unknown as Record<string, unknown>[],
    contextMode: 'create',
    context: {
      characters: contextCharacters,
      events: contextEvents,
      countries: contextCountries,
      worldEntries: [],
      tags,
    },
    refs: collectRefs({ events: primary }),
    folders: [],
    relations: serializeRelations(base.relations, included),
  })
  return downloadFile(
    file,
    `事件-${safeName(base.world.name)}-${DATE_STAMP()}.ocbak`,
  )
}

// ── 导出：国家 ─────────────────────────────────────────────────────────────

export async function exportCountriesOcav(): Promise<OcavDownload> {
  const base = await loadBase()
  if (base.countries.length === 0) throw new Error('当前世界观没有可导出的国家')
  const primary = base.countries
  const primaryIds = new Set(primary.map((row) => row.id).filter((id): id is number => id !== undefined))
  const characterIds = new Set<number>()
  const eventIds = new Set<number>()
  const relatedCountryIds = new Set<number>()
  for (const row of primary) {
    for (const id of row.characters ?? []) characterIds.add(id)
    for (const id of row.events ?? []) eventIds.add(id)
    for (const id of row.relatedEvents ?? []) eventIds.add(id)
    for (const id of row.relatedNations ?? []) relatedCountryIds.add(id)
    if (row.parentId) relatedCountryIds.add(row.parentId)
  }
  const contextCharacters = base.characters.filter(
    (row) => row.id !== undefined && characterIds.has(row.id),
  )
  const contextEvents = base.events.filter(
    (row) => row.id !== undefined && eventIds.has(row.id),
  )
  const contextCountries = base.countries.filter(
    (row) => row.id !== undefined && relatedCountryIds.has(row.id) && !primaryIds.has(row.id),
  )
  const included = new Map<RelationEntityType, Set<number>>([
    ['character', new Set(contextCharacters.map((row) => row.id as number))],
    ['country', new Set([...primaryIds, ...contextCountries.map((row) => row.id as number)])],
    ['event', new Set(contextEvents.map((row) => row.id as number))],
  ])
  const tagIds = usedTagIds([
    ...(primary as unknown as Array<Record<string, unknown>>),
    ...(contextCharacters as unknown as Array<Record<string, unknown>>),
    ...(contextEvents as unknown as Array<Record<string, unknown>>),
    ...(contextCountries as unknown as Array<Record<string, unknown>>),
  ])
  const tags = base.tags.filter((tag) => tag.id !== undefined && tagIds.has(tag.id))
  const file = makeFile({
    kind: 'country',
    label: '国家',
    includes: ['country'],
    world: { name: base.world.name, description: base.world.description },
    table: 'countries',
    items: primary as unknown as Record<string, unknown>[],
    contextMode: 'create',
    context: {
      characters: contextCharacters,
      events: contextEvents,
      countries: contextCountries,
      worldEntries: [],
      tags,
    },
    refs: collectRefs({ countries: primary }),
    folders: [],
    relations: serializeRelations(base.relations, included),
  })
  return downloadFile(
    file,
    `国家-${safeName(base.world.name)}-${DATE_STAMP()}.ocbak`,
  )
}

// ── 导出：世界观词条 ───────────────────────────────────────────────────────

export async function exportWorldEntriesOcav(): Promise<OcavDownload> {
  const base = await loadBase()
  if (base.worldEntries.length === 0) throw new Error('当前世界观没有可导出的词条')
  const primary = base.worldEntries
  const primaryIds = new Set(primary.map((row) => row.id).filter((id): id is number => id !== undefined))
  const refs: OcavRef[] = []
  const relatedEntryIds = new Set<number>()
  const relatedCharacterIds = new Set<number>()
  const relatedCountryIds = new Set<number>()
  const relatedEventIds = new Set<number>()
  for (const row of primary) {
    if (row.parentId) relatedEntryIds.add(row.parentId)
    for (const reference of row.references ?? []) {
      if (reference.targetType === 'world' && reference.targetId !== undefined) {
        relatedEntryIds.add(reference.targetId)
      } else if (reference.targetType === 'character' && reference.targetId !== undefined) {
        relatedCharacterIds.add(reference.targetId)
      } else if (reference.targetType === 'country' && reference.targetId !== undefined) {
        relatedCountryIds.add(reference.targetId)
      } else if (reference.targetType === 'event' && reference.targetId !== undefined) {
        relatedEventIds.add(reference.targetId)
      }
    }
  }
  const contextEntries = base.worldEntries.filter(
    (row) => row.id !== undefined && relatedEntryIds.has(row.id) && !primaryIds.has(row.id),
  )
  refs.push(
    ...collectRefs({
      characters: base.characters.filter(
        (row) => row.id !== undefined && relatedCharacterIds.has(row.id),
      ),
      events: base.events.filter((row) => row.id !== undefined && relatedEventIds.has(row.id)),
      countries: base.countries.filter(
        (row) => row.id !== undefined && relatedCountryIds.has(row.id),
      ),
      worldEntries: [...primary, ...contextEntries],
    }),
  )
  const tagIds = usedTagIds(primary as unknown as Array<Record<string, unknown>>)
  const tags = base.tags.filter((tag) => tag.id !== undefined && tagIds.has(tag.id))
  const file = makeFile({
    kind: 'world-entry',
    label: '世界观',
    includes: ['worldEntry'],
    world: { name: base.world.name, description: base.world.description },
    table: 'worldEntries',
    items: primary as unknown as Record<string, unknown>[],
    contextMode: 'link-only',
    context: { ...emptyContext(), tags },
    refs,
    folders: [],
    relations: [],
  })
  return downloadFile(
    file,
    `世界观-${safeName(base.world.name)}-${DATE_STAMP()}.ocbak`,
  )
}

// ── 导出：自定义分类 ───────────────────────────────────────────────────────

export async function exportCustomSectionOcav(sectionId: string): Promise<OcavDownload> {
  const section = readVisibleCustomSections().find((item) => item.id === sectionId)
  if (!section) throw new Error('找不到要导出的自定义分类')
  const base = await loadBase()
  const refs: OcavRef[] = []
  const characterIds = new Set<number>([...(section.characterIds ?? [])])
  const countryIds = new Set<number>([...(section.countryIds ?? [])])
  const eventIds = new Set<number>([...(section.eventIds ?? [])])
  const entryIds = new Set<number>([...(section.worldEntryIds ?? [])])
  for (const entry of section.entries) {
    for (const id of entry.characterIds ?? []) characterIds.add(id)
    for (const id of entry.countryIds ?? []) countryIds.add(id)
    for (const id of entry.eventIds ?? []) eventIds.add(id)
    for (const id of entry.worldEntryIds ?? []) entryIds.add(id)
  }
  refs.push(...collectRefs({
    characters: base.characters.filter((row) => row.id !== undefined && characterIds.has(row.id)),
    events: base.events.filter((row) => row.id !== undefined && eventIds.has(row.id)),
    countries: base.countries.filter((row) => row.id !== undefined && countryIds.has(row.id)),
    worldEntries: base.worldEntries.filter((row) => row.id !== undefined && entryIds.has(row.id)),
  }))
  const file = makeFile({
    kind: 'custom-section',
    label: section.name,
    includes: ['customSection'],
    world: { name: base.world.name, description: base.world.description },
    table: 'customSections',
    items: [section as unknown as Record<string, unknown>],
    contextMode: 'link-only',
    context: emptyContext(),
    refs,
    folders: [],
    relations: [],
  })
  return downloadFile(
    file,
    `${safeName(section.name)}-${safeName(base.world.name)}-${DATE_STAMP()}.ocbak`,
  )
}

// ── 校验 / 自动识别 ────────────────────────────────────────────────────────

const TABLE_KIND: Record<OcavTable, OcavKind> = {
  characters: 'character',
  events: 'event',
  countries: 'country',
  worldEntries: 'world-entry',
  customSections: 'custom-section',
}

function tableIsValid(value: unknown): value is OcavTable {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(TABLE_KIND, value)
  )
}

/** 只根据条目形状判断，不信任 kind/table 标签。 */
function detectTableFromItems(items: Record<string, unknown>[]): OcavTable | null {
  const sample = items[0]
  if (!isRecord(sample)) return null

  // 自定义分类：有 entries 数组 + 分类名。
  if (Array.isArray(sample.entries) && typeof sample.name === 'string') {
    return 'customSections'
  }

  if (typeof sample.title === 'string') {
    if (
      typeof sample.time === 'string' ||
      typeof sample.summary === 'string' ||
      typeof sample.location === 'string' ||
      typeof sample.isMajor === 'boolean' ||
      Array.isArray(sample.characters) ||
      Array.isArray(sample.countries) ||
      Array.isArray(sample.relations) ||
      typeof sample.parentEventId !== 'undefined'
    ) {
      return 'events'
    }
    if (
      typeof sample.category === 'string' ||
      typeof sample.isConcept === 'boolean' ||
      Array.isArray(sample.references) ||
      typeof sample.order === 'number'
    ) {
      return 'worldEntries'
    }
    return null
  }

  if (typeof sample.name === 'string') {
    if (
      typeof sample.system === 'string' ||
      typeof sample.geography === 'string' ||
      typeof sample.culture === 'string' ||
      typeof sample.flagUrl === 'string' ||
      Array.isArray(sample.characters) ||
      Array.isArray(sample.events)
    ) {
      return 'countries'
    }
    if (
      typeof sample.entityKind === 'string' ||
      typeof sample.avatarUrl === 'string' ||
      typeof sample.bio === 'string' ||
      Array.isArray(sample.aliases) ||
      Array.isArray(sample.relatedCharacters) ||
      typeof sample.lifeStory === 'string'
    ) {
      return 'characters'
    }
    return null
  }

  return null
}

export function isOcavPayload(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.format === 'oc-editor-ocav') return true
  // 兼容文件头被清理过、但 payload.items 仍然完整的分类备份。
  return isRecord(value.payload) && Array.isArray(value.payload.items)
}

export function validateOcav(value: unknown): { file: OcavFile; summary: OcavSummary } {
  if (!isRecord(value)) throw new Error('无效的 .ocbak：文件不是 JSON 对象')
  if (value.format !== undefined && value.format !== 'oc-editor-ocav') {
    throw new Error('不是 OC editor 的 .ocbak 文件')
  }
  if (value.version !== undefined && value.version !== 1) {
    throw new Error(`不支持的 .ocbak 版本：${String(value.version)}，仅支持 1`)
  }

  const payload = value.payload
  if (!isRecord(payload)) throw new Error('分类备份缺少 payload')
  const items = recordArray(payload.items)
  if (items.length === 0) throw new Error('分类备份中没有可导入的数据')
  if (items.length !== (Array.isArray(payload.items) ? payload.items.length : 0)) {
    throw new Error('分类备份的 payload.items 含有无效条目')
  }

  // 软件内部判断：优先看条目的实际形状，其次看 payload.table，最后才看
  // kind 提示。这样即使文件头写错，也不会把角色写进国家表。
  const shapeTable = detectTableFromItems(items)
  const declaredTable = tableIsValid(payload.table) ? payload.table : null
  const kindHint =
    typeof value.kind === 'string' &&
    Object.prototype.hasOwnProperty.call(KIND_TABLE, value.kind)
      ? (value.kind as OcavKind)
      : null
  const table = shapeTable ?? declaredTable ?? (kindHint ? KIND_TABLE[kindHint] : null)
  if (!table) {
    throw new Error('无法判断这个 .ocbak 属于角色、事件、国家还是世界观')
  }
  const typedKind = TABLE_KIND[table]

  const sample = items[0]
  if (typedKind === 'character' && typeof sample.name !== 'string') {
    throw new Error('文件内容看起来是角色，但条目缺少 name 字段')
  }
  if (typedKind === 'event' && typeof sample.title !== 'string') {
    throw new Error('文件内容看起来是事件，但条目缺少 title 字段')
  }
  if (typedKind === 'country' && typeof sample.name !== 'string') {
    throw new Error('文件内容看起来是国家，但条目缺少 name 字段')
  }
  if (typedKind === 'world-entry' && typeof sample.title !== 'string') {
    throw new Error('文件内容看起来是世界观词条，但条目缺少 title 字段')
  }
  if (
    typedKind === 'custom-section' &&
    (typeof sample.name !== 'string' || !Array.isArray(sample.entries))
  ) {
    throw new Error('文件内容看起来是自定义分类，但条目缺少 name / entries 字段')
  }

  const context = isRecord(payload.context) ? payload.context : {}
  const contextCharacters = recordArray(context.characters)
  const contextEvents = recordArray(context.events)
  const contextCountries = recordArray(context.countries)
  const contextWorldEntries = recordArray(context.worldEntries)
  const relationRows = recordArray(value.relations)
  const refs = recordArray(payload.refs)
  const world = isRecord(value.world) ? value.world : null
  const meta = isRecord(value.meta) ? value.meta : {}
  const includes = stringArray(meta.includes)

  const file: OcavFile = {
    format: 'oc-editor-ocav',
    version: 1,
    kind: typedKind,
    scope: value.scope === 'all-character-kinds' ? 'all-character-kinds' : 'single',
    exportedAt: text(value.exportedAt, new Date().toISOString()),
    app: 'OC editor',
    world: world
      ? { name: text(world.name, '未命名世界观'), description: text(world.description) }
      : null,
    payload: {
      table: table as OcavTable,
      items,
      contextMode: payload.contextMode === 'link-only' ? 'link-only' : 'create',
      context: {
        characters: contextCharacters as unknown as Character[],
        events: contextEvents as unknown as Event[],
        countries: contextCountries as unknown as Country[],
        worldEntries: contextWorldEntries as unknown as WorldEntry[],
        tags: recordArray(context.tags) as unknown as Tag[],
      },
      refs: refs as unknown as OcavRef[],
      folders: recordArray(payload.folders) as unknown as Array<{ id: string; name: string }>,
    },
    relations: relationRows as unknown as OcavRelation[],
    meta: {
      label: text(meta.label, KIND_LABEL[typedKind]),
      count: items.length,
      contextCount:
        contextCharacters.length +
        contextEvents.length +
        contextCountries.length +
        contextWorldEntries.length +
        refs.length,
      relationCount: relationRows.length,
      includes,
    },
  }

  const summary: OcavSummary = {
    kind: typedKind,
    table: table as OcavTable,
    kindLabel:
      typedKind === 'character' && file.scope === 'all-character-kinds'
        ? '全部角色（角色 + 武器 + 宠物）'
        : KIND_LABEL[typedKind],
    label: file.meta.label,
    count: file.meta.count,
    contextCount: file.meta.contextCount,
    relationCount: file.meta.relationCount,
    worldName: file.world?.name ?? '',
    includes: includes.length > 0 ? includes : [typedKind],
  }
  return { file, summary }
}

// ── 导入：实体规范化 ───────────────────────────────────────────────────────

function normalizeCharacter(raw: Record<string, unknown>, worldId: number, now: number): Record<string, unknown> {
  const { id: _id, ...rest } = raw
  void _id
  return {
    ...rest,
    worldId,
    name: text(rest.name, '未命名角色'),
    entityKind: rest.entityKind === 'weapon' || rest.entityKind === 'pet' ? rest.entityKind : 'character',
    accentColor: text(rest.accentColor) || undefined,
    customFields: Array.isArray(rest.customFields) ? rest.customFields : [],
    folderId: typeof rest.folderId === 'string' ? rest.folderId : null,
    hiddenFields: stringArray(rest.hiddenFields),
    animationUrl: text(rest.animationUrl),
    animationType: rest.animationType === 'image' ? 'image' : 'video',
    aliases: stringArray(rest.aliases),
    race: text(rest.race),
    element: text(rest.element),
    occupation: text(rest.occupation),
    nationalityLegacy: text(rest.nationalityLegacy),
    countryId: undefined,
    height: text(rest.height),
    birthday: text(rest.birthday),
    bio: text(rest.bio),
    lifeStory: text(rest.lifeStory),
    avatarUrl: text(rest.avatarUrl),
    qAvatarUrl: text(rest.qAvatarUrl),
    headerUrl: text(rest.headerUrl),
    relationships: [],
    relatedCharacters: [],
    relatedNations: [],
    relatedNationLabels: {},
    relatedEvents: [],
    relatedEventLabels: {},
    gallery: Array.isArray(rest.gallery) ? rest.gallery : [],
    avatars: Array.isArray(rest.avatars) ? rest.avatars : [],
    tags: numberArray(rest.tags),
    createdAt: numberValue(rest.createdAt, now),
    updatedAt: numberValue(rest.updatedAt, now),
    deleted: false,
    _syncStatus: 'pending',
    _lastModified: now,
  }
}

function normalizeEvent(raw: Record<string, unknown>, worldId: number, now: number): Record<string, unknown> {
  const { id: _id, ...rest } = raw
  void _id
  return {
    ...rest,
    worldId,
    title: text(rest.title, '未命名事件'),
    time: text(rest.time),
    endTime: text(rest.endTime),
    location: text(rest.location),
    summary: text(rest.summary),
    content: text(rest.content),
    characters: [],
    countries: [],
    relations: [],
    parentEventId: null,
    tags: numberArray(rest.tags),
    images: Array.isArray(rest.images) ? rest.images : [],
    headerUrl: text(rest.headerUrl),
    isMajor: boolValue(rest.isMajor),
    createdAt: numberValue(rest.createdAt, now),
    updatedAt: numberValue(rest.updatedAt, now),
    deleted: false,
    _syncStatus: 'pending',
    _lastModified: now,
  }
}

function normalizeCountry(raw: Record<string, unknown>, worldId: number, now: number): Record<string, unknown> {
  const { id: _id, ...rest } = raw
  void _id
  return {
    ...rest,
    worldId,
    name: text(rest.name, '未命名国家'),
    accentColor: text(rest.accentColor) || undefined,
    parentId: null,
    description: text(rest.description),
    system: text(rest.system),
    geography: text(rest.geography),
    culture: text(rest.culture),
    flagUrl: text(rest.flagUrl),
    headerUrl: text(rest.headerUrl),
    characters: [],
    events: [],
    relatedNations: [],
    relatedNationLabels: {},
    relatedEvents: [],
    relatedEventLabels: {},
    tags: numberArray(rest.tags),
    createdAt: numberValue(rest.createdAt, now),
    updatedAt: numberValue(rest.updatedAt, now),
    deleted: false,
    _syncStatus: 'pending',
    _lastModified: now,
  }
}

function normalizeWorldEntry(raw: Record<string, unknown>, worldId: number, now: number): Record<string, unknown> {
  const { id: _id, ...rest } = raw
  void _id
  return {
    ...rest,
    worldId,
    title: text(rest.title, '未命名词条'),
    content: text(rest.content),
    category: text(rest.category, 'concept'),
    parentId: null,
    order: numberValue(rest.order, 0),
    isConcept: boolValue(rest.isConcept),
    references: [],
    tags: numberArray(rest.tags),
    createdAt: numberValue(rest.createdAt, now),
    updatedAt: numberValue(rest.updatedAt, now),
    deleted: false,
    _syncStatus: 'pending',
    _lastModified: now,
  }
}

type Normalizer = (raw: Record<string, unknown>, worldId: number, now: number) => Record<string, unknown>

interface MergeOutcome {
  map: Map<number, number>
  added: number
  skipped: number
  overwritten: number
  contextAdded: number
  touched: Array<{ id: number; raw: Record<string, unknown> }>
}

async function mergeEntityTable(
  table: Table<Record<string, unknown>, number>,
  records: Record<string, unknown>[],
  nameField: 'name' | 'title',
  strategy: MergeStrategy,
  isContext: boolean,
  worldId: number,
  now: number,
  normalize: Normalizer,
): Promise<MergeOutcome> {
  const outcome: MergeOutcome = {
    map: new Map(),
    added: 0,
    skipped: 0,
    overwritten: 0,
    contextAdded: 0,
    touched: [],
  }
  if (records.length === 0) return outcome

  const existingRows = (await table.toArray()).filter((row) => !boolValue(row.deleted))
  const activeRows = filterByActiveWorld(
    existingRows as unknown as Array<{ worldId?: number }>,
  ) as unknown as Record<string, unknown>[]
  const byName = new Map<string, Record<string, unknown>>()
  for (const row of activeRows) {
    const name = text(row[nameField]).trim().toLowerCase()
    if (name) byName.set(name, row)
  }

  for (const raw of records) {
    const oldId = numberValue(raw.id, -1)
    const normalized = normalize(raw, worldId, now)
    const name = text(normalized[nameField]).trim().toLowerCase()
    const existing = name ? byName.get(name) : undefined

    if (isContext) {
      if (oldId >= 0 && outcome.map.has(oldId)) continue
      if (existing && typeof existing.id === 'number') {
        if (oldId >= 0) outcome.map.set(oldId, existing.id)
        continue
      }
      const key = await table.add({ ...normalized } as never)
      const newId = Number(key)
      if (oldId >= 0) outcome.map.set(oldId, newId)
      outcome.contextAdded += 1
      outcome.touched.push({ id: newId, raw })
      continue
    }

    if (existing && typeof existing.id === 'number') {
      if (strategy === 'skip') {
        if (oldId >= 0) outcome.map.set(oldId, existing.id)
        outcome.skipped += 1
        continue
      }
      if (strategy === 'overwrite') {
        const merged: Record<string, unknown> = {
          ...existing,
          ...normalized,
          id: existing.id,
          worldId,
          deleted: false,
          updatedAt: now,
          _syncStatus: 'pending',
          _lastModified: now,
        }
        // 覆盖同名条目时保留本地已有的关系投影；导入文件里的关系会在
        // insertRelations 之后补进来。否则文件里没带到的旧关系会被清空。
        for (const field of [
          'countryId',
          'relatedCharacters',
          'relatedNations',
          'relatedNationLabels',
          'relatedEvents',
          'relatedEventLabels',
          'characters',
          'events',
          'relations',
        ]) {
          if (field in existing) merged[field] = existing[field]
        }
        await table.put(merged as never)
        if (oldId >= 0) outcome.map.set(oldId, existing.id)
        outcome.overwritten += 1
        outcome.touched.push({ id: existing.id, raw })
        continue
      }
    }

    // skip 策略遇到不存在的记录，以及 keep-both，都创建新记录。
    const key = await table.add({ ...normalized } as never)
    const newId = Number(key)
    if (oldId >= 0) outcome.map.set(oldId, newId)
    outcome.added += 1
    outcome.touched.push({ id: newId, raw })
  }

  return outcome
}

// ── 导入：标签 / 引用重写 ──────────────────────────────────────────────────

async function mapTags(records: Record<string, unknown>[], now: number): Promise<Map<number, number>> {
  const mapping = new Map<number, number>()
  if (records.length === 0) return mapping
  const existing = await db.tags.toArray()
  const byName = new Map(existing.map((tag) => [tag.name.trim().toLowerCase(), tag]))
  for (const raw of records) {
    const oldId = numberValue(raw.id, -1)
    if (oldId < 0) continue
    const name = text(raw.name).trim()
    if (!name) continue
    const current = byName.get(name.toLowerCase())
    if (current?.id !== undefined) {
      mapping.set(oldId, current.id)
      continue
    }
    const newId = await db.tags.add({
      name,
      category: text(raw.category, '自定义'),
      color: text(raw.color, '#8C877E'),
    })
    mapping.set(oldId, newId)
    byName.set(name.toLowerCase(), { id: newId, name, category: text(raw.category, '自定义'), color: text(raw.color, '#8C877E') })
  }
  void now
  return mapping
}

function mapNumber(value: unknown, mapping: Map<number, number>): number | undefined {
  if (typeof value !== 'number') return undefined
  return mapping.get(value)
}

function mapNumberArray(value: unknown, mapping: Map<number, number>): number[] {
  return numberArray(value)
    .map((id) => mapping.get(id))
    .filter((id): id is number => id !== undefined)
}

function remapLabelRecord(
  value: unknown,
  mapping: Map<number, number>,
): Record<number, string> {
  if (!isRecord(value)) return {}
  const result: Record<number, string> = {}
  for (const [key, label] of Object.entries(value)) {
    const numeric = Number(key)
    const mapped = mapping.get(numeric)
    if (mapped !== undefined && typeof label === 'string') result[mapped] = label
  }
  return result
}

function remapDocument(value: unknown, maps: Record<'character' | 'event' | 'country' | 'world', Map<number, number>>): unknown {
  if (Array.isArray(value)) return value.map((item) => remapDocument(item, maps))
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'attrs' && isRecord(item)) {
      const attrs: Record<string, unknown> = { ...item }
      const entityType = attrs.entityType
      const rawId = attrs.id
      if (
        (entityType === 'character' || entityType === 'event' || entityType === 'country' || entityType === 'world') &&
        (typeof rawId === 'string' || typeof rawId === 'number')
      ) {
        const numeric = Number(rawId)
        const mapped = maps[entityType].get(numeric)
        if (mapped !== undefined) attrs.id = String(mapped)
      }
      result[key] = attrs
      continue
    }
    result[key] = remapDocument(item, maps)
  }
  return result
}

// ── 导入：关系 ─────────────────────────────────────────────────────────────

interface RelationPlan {
  sourceType: RelationEntityType
  sourceId: number
  targetType: RelationEntityType
  targetId: number
  kind: RelationKind
  label: string
  directed: boolean
  color?: string
  arrow?: 'none' | 'forward' | 'reverse' | 'both'
  forceUnique: boolean
}

function buildRelationPlans(
  relations: OcavRelation[],
  maps: Record<'character' | 'event' | 'country', Map<number, number>>,
): RelationPlan[] {
  const plans: RelationPlan[] = []
  const used = new Set<string>()
  for (const relation of relations) {
    const sourceMap = maps[relation.sourceType]
    const targetMap = maps[relation.targetType]
    const sourceId = sourceMap.get(relation.sourceId)
    const targetId = targetMap.get(relation.targetId)
    if (sourceId === undefined || targetId === undefined) continue
    const base = relationId(relation.sourceType, sourceId, relation.targetType, targetId)
    const forceUnique = used.has(base) || Boolean(relation.id?.includes('#'))
    used.add(base)
    plans.push({
      sourceType: relation.sourceType,
      sourceId,
      targetType: relation.targetType,
      targetId,
      kind: relation.kind,
      label: text(relation.label, '相关'),
      directed: boolValue(relation.directed, true),
      color: typeof relation.color === 'string' ? relation.color : undefined,
      arrow:
        relation.arrow === 'none' ||
        relation.arrow === 'forward' ||
        relation.arrow === 'reverse' ||
        relation.arrow === 'both'
          ? relation.arrow
          : undefined,
      forceUnique,
    })
  }
  return plans
}

async function insertRelations(
  plans: RelationPlan[],
  strategy: MergeStrategy,
  worldId: number,
  now: number,
): Promise<number> {
  let inserted = 0
  for (const plan of plans) {
    const base = relationId(plan.sourceType, plan.sourceId, plan.targetType, plan.targetId)
    const existing = await db.relations.get(base)
    let id = base
    let shouldWrite = true

    if (existing && !existing.deleted) {
      if (plan.forceUnique) {
        id = `${base}#${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      } else if (strategy === 'overwrite') {
        id = existing.id
      } else if (existing.label !== plan.label && plan.kind === 'character') {
        id = `${base}#${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      } else {
        id = existing.id
        shouldWrite = false
      }
    } else if (plan.forceUnique) {
      id = `${base}#${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    }

    if (!shouldWrite) {
      // 本地已有同一条关系：不覆盖标签，但补一次投影，避免旧数据只有
      // relations 表、没有实体面板投影时关系图漏边。
      if (existing) await applyRelationProjection(existing)
      continue
    }
    while (id !== base && (await db.relations.get(id))) {
      id = `${base}#${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    }
    const record: RelationRecord = {
      id,
      worldId,
      sourceType: plan.sourceType,
      sourceId: plan.sourceId,
      targetType: plan.targetType,
      targetId: plan.targetId,
      kind: plan.kind,
      label: plan.label.trim() || '相关',
      directed: plan.directed,
      color: plan.color,
      arrow: plan.arrow,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deleted: false,
    }
    await db.relations.put(record)
    await applyRelationProjection(record)
    inserted += 1
  }
  return inserted
}

// ── 导入：自定义分类 ───────────────────────────────────────────────────────

function normalizeCustomSection(raw: Record<string, unknown>, worldId: number): {
  section: Record<string, unknown>
  entryIds: Set<string>
} {
  const entries = recordArray(raw.entries).map((entry) => ({
    ...entry,
    id: text(entry.id, `entry-${crypto.randomUUID?.() ?? Date.now()}`),
    name: text(entry.name, '新条目'),
    note: text(entry.note),
    headerUrl: text(entry.headerUrl),
    avatarUrl: text(entry.avatarUrl),
    gallery: stringArray(entry.gallery),
    characterIds: numberArray(entry.characterIds),
    countryIds: numberArray(entry.countryIds),
    eventIds: numberArray(entry.eventIds),
    worldEntryIds: numberArray(entry.worldEntryIds),
    relatedEntryIds: stringArray(entry.relatedEntryIds),
    characterLinks: isRecord(entry.characterLinks) ? entry.characterLinks : {},
    countryLinks: isRecord(entry.countryLinks) ? entry.countryLinks : {},
    eventLinks: isRecord(entry.eventLinks) ? entry.eventLinks : {},
    entryLinks: isRecord(entry.entryLinks) ? entry.entryLinks : {},
  }))
  const entryIds = new Set(entries.map((entry) => text(entry.id)))
  return {
    section: {
      ...raw,
      id: text(raw.id, `custom-${Date.now()}`),
      worldId,
      name: text(raw.name, '新分类'),
      description: text(raw.description),
      entries,
      scopedEdges: recordArray(raw.scopedEdges).filter(
        (edge) => entryIds.has(text(edge.source)) && entryIds.has(text(edge.target)),
      ),
      characterIds: numberArray(raw.characterIds),
      countryIds: numberArray(raw.countryIds),
      eventIds: numberArray(raw.eventIds),
      worldEntryIds: numberArray(raw.worldEntryIds),
      relatedSectionIds: [],
      edgeLabels: isRecord(raw.edgeLabels) ? raw.edgeLabels : {},
    },
    entryIds,
  }
}

function remapCustomSection(
  section: Record<string, unknown>,
  maps: Record<'character' | 'event' | 'country' | 'world', Map<number, number>>,
): Record<string, unknown> {
  const entries = recordArray(section.entries).map((entry) => {
    const related = stringArray(entry.relatedEntryIds)
    const entryLinks = isRecord(entry.entryLinks) ? entry.entryLinks : {}
    const nextLinks: Record<string, unknown> = {}
    for (const id of related) {
      if (entryLinks[id]) nextLinks[id] = entryLinks[id]
    }
    return {
      ...entry,
      characterIds: mapNumberArray(entry.characterIds, maps.character),
      countryIds: mapNumberArray(entry.countryIds, maps.country),
      eventIds: mapNumberArray(entry.eventIds, maps.event),
      worldEntryIds: mapNumberArray(entry.worldEntryIds, maps.world),
      relatedEntryIds: related,
      characterLinks: remapLabelRecord(entry.characterLinks, maps.character),
      countryLinks: remapLabelRecord(entry.countryLinks, maps.country),
      eventLinks: remapLabelRecord(entry.eventLinks, maps.event),
      entryLinks: nextLinks,
    }
  })
  return {
    ...section,
    entries,
    characterIds: mapNumberArray(section.characterIds, maps.character),
    countryIds: mapNumberArray(section.countryIds, maps.country),
    eventIds: mapNumberArray(section.eventIds, maps.event),
    worldEntryIds: mapNumberArray(section.worldEntryIds, maps.world),
  }
}

function refMaps(
  refs: OcavRef[],
  base: {
    characters: Character[]
    events: Event[]
    countries: Country[]
    worldEntries: WorldEntry[]
  },
): Record<'character' | 'event' | 'country' | 'world', Map<number, number>> {
  const maps = {
    character: new Map<number, number>(),
    event: new Map<number, number>(),
    country: new Map<number, number>(),
    world: new Map<number, number>(),
  }
  const byName = {
    character: new Map(base.characters.map((row) => [row.name.trim().toLowerCase(), row.id])),
    event: new Map(base.events.map((row) => [row.title.trim().toLowerCase(), row.id])),
    country: new Map(base.countries.map((row) => [row.name.trim().toLowerCase(), row.id])),
    world: new Map(base.worldEntries.map((row) => [row.title.trim().toLowerCase(), row.id])),
  }
  for (const ref of refs) {
    const id = byName[ref.type]?.get(ref.name.trim().toLowerCase())
    if (id !== undefined) maps[ref.type].set(ref.id, id)
  }
  return maps
}

// ── 导入主流程 ─────────────────────────────────────────────────────────────

export async function importOcav(
  value: unknown,
  strategy: MergeStrategy,
  queryClient?: QueryClient,
): Promise<OcavImportResult> {
  const { file, summary } = validateOcav(value)
  if (strategy === 'replace') {
    throw new Error('.ocbak 分类导入不支持“清空全部数据”；请使用跳过、覆盖或保留两者')
  }
  const worldId = getActiveWorldId()
  if (worldId === null) throw new Error('请先选择一个世界观，再导入 .ocbak')
  const now = Date.now()
  const folderMap =
    file.kind === 'character'
      ? importCharacterFolders(file.payload.folders)
      : new Map<string, string>()

  const notify = (): void => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('data-updated'))
      window.dispatchEvent(new Event('oc-relations-changed'))
    }
    queryClient?.invalidateQueries()
  }

  if (file.kind === 'custom-section') {
    const base = await loadBase()
    const maps = refMaps(file.payload.refs, base)
    const { section } = normalizeCustomSection(file.payload.items[0], worldId)
    const remapped = remapCustomSection(section, maps)
    const outcome = importCustomSectionForOcav(
      remapped as unknown as Parameters<typeof importCustomSectionForOcav>[0],
      strategy,
    )
    notify()
    return {
      kind: file.kind,
      kindLabel: summary.kindLabel,
      label: summary.label,
      added: outcome === 'added' ? 1 : 0,
      skipped: outcome === 'skipped' ? 1 : 0,
      overwritten: outcome === 'overwritten' ? 1 : 0,
      relations: 0,
      contextAdded: 0,
    }
  }

  const characterMaps = new Map<number, number>()
  const eventMaps = new Map<number, number>()
  const countryMaps = new Map<number, number>()
  const worldEntryMaps = new Map<number, number>()

  const primaryRecords = file.payload.items
  const context = file.payload.context

  const table = file.payload.table
  if (table === 'characters') {
    const primary = await mergeEntityTable(
      db.characters as unknown as Table<Record<string, unknown>, number>,
      primaryRecords,
      'name',
      strategy,
      false,
      worldId,
      now,
      normalizeCharacter,
    )
    const contextCharacters = file.payload.contextMode === 'create'
      ? await mergeEntityTable(
          db.characters as unknown as Table<Record<string, unknown>, number>,
          context.characters as unknown as Record<string, unknown>[],
          'name',
          strategy,
          true,
          worldId,
          now,
          normalizeCharacter,
        )
      : { map: new Map<number, number>(), added: 0, skipped: 0, overwritten: 0, contextAdded: 0, touched: [] }
    for (const [key, value] of contextCharacters.map) characterMaps.set(key, value)
    for (const [key, value] of primary.map) characterMaps.set(key, value)
    const countryOutcome = await mergeEntityTable(
      db.countries as unknown as Table<Record<string, unknown>, number>,
      context.countries as unknown as Record<string, unknown>[],
      'name',
      strategy,
      true,
      worldId,
      now,
      normalizeCountry,
    )
    const eventOutcome = await mergeEntityTable(
      db.events as unknown as Table<Record<string, unknown>, number>,
      context.events as unknown as Record<string, unknown>[],
      'title',
      strategy,
      true,
      worldId,
      now,
      normalizeEvent,
    )
    for (const [key, value] of countryOutcome.map) countryMaps.set(key, value)
    for (const [key, value] of eventOutcome.map) eventMaps.set(key, value)

    const tagMap = await mapTags(context.tags as unknown as Record<string, unknown>[], now)
    const maps = { character: characterMaps, event: eventMaps, country: countryMaps, world: worldEntryMaps }
    await remapTouchedCharacters(primary.touched, maps, tagMap, folderMap, now)
    await remapTouchedCharacters(contextCharacters.touched, maps, tagMap, folderMap, now)
    await remapTouchedCountries(countryOutcome.touched, maps, tagMap, now)
    await remapTouchedEvents(eventOutcome.touched, maps, tagMap, now)
    const relationPlans = buildRelationPlans(file.relations, { character: characterMaps, event: eventMaps, country: countryMaps })
    const relations = await insertRelations(relationPlans, strategy, worldId, now)
    await syncRelationsFromEntities()
    notify()
    return {
      kind: file.kind,
      kindLabel: summary.kindLabel,
      label: summary.label,
      added: primary.added,
      skipped: primary.skipped,
      overwritten: primary.overwritten,
      relations,
      contextAdded: contextCharacters.contextAdded + countryOutcome.contextAdded + eventOutcome.contextAdded,
    }
  }

  if (table === 'events') {
    const primary = await mergeEntityTable(
      db.events as unknown as Table<Record<string, unknown>, number>,
      primaryRecords,
      'title',
      strategy,
      false,
      worldId,
      now,
      normalizeEvent,
    )
    for (const [key, value] of primary.map) eventMaps.set(key, value)
    const contextChars = await mergeEntityTable(
      db.characters as unknown as Table<Record<string, unknown>, number>,
      context.characters as unknown as Record<string, unknown>[],
      'name',
      strategy,
      true,
      worldId,
      now,
      normalizeCharacter,
    )
    const contextCountries = await mergeEntityTable(
      db.countries as unknown as Table<Record<string, unknown>, number>,
      context.countries as unknown as Record<string, unknown>[],
      'name',
      strategy,
      true,
      worldId,
      now,
      normalizeCountry,
    )
    const contextEvents = await mergeEntityTable(
      db.events as unknown as Table<Record<string, unknown>, number>,
      context.events as unknown as Record<string, unknown>[],
      'title',
      strategy,
      true,
      worldId,
      now,
      normalizeEvent,
    )
    for (const [key, value] of contextChars.map) characterMaps.set(key, value)
    for (const [key, value] of contextCountries.map) countryMaps.set(key, value)
    for (const [key, value] of contextEvents.map) eventMaps.set(key, value)
    const tagMap = await mapTags(context.tags as unknown as Record<string, unknown>[], now)
    const maps = { character: characterMaps, event: eventMaps, country: countryMaps, world: worldEntryMaps }
    await remapTouchedEvents(primary.touched, maps, tagMap, now)
    await remapTouchedEvents(contextEvents.touched, maps, tagMap, now)
    await remapTouchedCharacters(contextChars.touched, maps, tagMap, folderMap, now)
    await remapTouchedCountries(contextCountries.touched, maps, tagMap, now)
    const relationPlans = buildRelationPlans(file.relations, { character: characterMaps, event: eventMaps, country: countryMaps })
    const relations = await insertRelations(relationPlans, strategy, worldId, now)
    await syncRelationsFromEntities()
    notify()
    return {
      kind: file.kind,
      kindLabel: summary.kindLabel,
      label: summary.label,
      added: primary.added,
      skipped: primary.skipped,
      overwritten: primary.overwritten,
      relations,
      contextAdded: contextChars.contextAdded + contextCountries.contextAdded + contextEvents.contextAdded,
    }
  }

  if (table === 'countries') {
    const primary = await mergeEntityTable(
      db.countries as unknown as Table<Record<string, unknown>, number>,
      primaryRecords,
      'name',
      strategy,
      false,
      worldId,
      now,
      normalizeCountry,
    )
    for (const [key, value] of primary.map) countryMaps.set(key, value)
    const contextChars = await mergeEntityTable(
      db.characters as unknown as Table<Record<string, unknown>, number>,
      context.characters as unknown as Record<string, unknown>[],
      'name',
      strategy,
      true,
      worldId,
      now,
      normalizeCharacter,
    )
    const contextEvents = await mergeEntityTable(
      db.events as unknown as Table<Record<string, unknown>, number>,
      context.events as unknown as Record<string, unknown>[],
      'title',
      strategy,
      true,
      worldId,
      now,
      normalizeEvent,
    )
    const contextCountries = await mergeEntityTable(
      db.countries as unknown as Table<Record<string, unknown>, number>,
      context.countries as unknown as Record<string, unknown>[],
      'name',
      strategy,
      true,
      worldId,
      now,
      normalizeCountry,
    )
    for (const [key, value] of contextChars.map) characterMaps.set(key, value)
    for (const [key, value] of contextEvents.map) eventMaps.set(key, value)
    for (const [key, value] of contextCountries.map) countryMaps.set(key, value)
    const tagMap = await mapTags(context.tags as unknown as Record<string, unknown>[], now)
    const maps = { character: characterMaps, event: eventMaps, country: countryMaps, world: worldEntryMaps }
    await remapTouchedCountries(primary.touched, maps, tagMap, now)
    await remapTouchedCountries(contextCountries.touched, maps, tagMap, now)
    await remapTouchedCharacters(contextChars.touched, maps, tagMap, folderMap, now)
    await remapTouchedEvents(contextEvents.touched, maps, tagMap, now)
    const relationPlans = buildRelationPlans(file.relations, { character: characterMaps, event: eventMaps, country: countryMaps })
    const relations = await insertRelations(relationPlans, strategy, worldId, now)
    await syncRelationsFromEntities()
    notify()
    return {
      kind: file.kind,
      kindLabel: summary.kindLabel,
      label: summary.label,
      added: primary.added,
      skipped: primary.skipped,
      overwritten: primary.overwritten,
      relations,
      contextAdded: contextChars.contextAdded + contextEvents.contextAdded + contextCountries.contextAdded,
    }
  }

  // world-entry
  const base = await loadBase()
  const refsMaps = refMaps(file.payload.refs, base)
  const maps = {
    character: new Map<number, number>(refsMaps.character),
    event: new Map<number, number>(refsMaps.event),
    country: new Map<number, number>(refsMaps.country),
    world: new Map<number, number>(refsMaps.world),
  }
  const primary = await mergeEntityTable(
    db.worldEntries as unknown as Table<Record<string, unknown>, number>,
    primaryRecords,
    'title',
    strategy,
    false,
    worldId,
    now,
    normalizeWorldEntry,
  )
  for (const [key, value] of primary.map) maps.world.set(key, value)
  const tagMap = await mapTags(context.tags as unknown as Record<string, unknown>[], now)
  await remapTouchedWorldEntries(primary.touched, maps, tagMap, now)
  notify()
  return {
    kind: file.kind,
    kindLabel: summary.kindLabel,
    label: summary.label,
    added: primary.added,
    skipped: primary.skipped,
    overwritten: primary.overwritten,
    relations: 0,
    contextAdded: 0,
  }
}

// ── 导入：逐表字段重写 ─────────────────────────────────────────────────────

async function remapTouchedCharacters(
  touched: Array<{ id: number; raw: Record<string, unknown> }>,
  maps: Record<'character' | 'event' | 'country' | 'world', Map<number, number>>,
  tagMap: Map<number, number>,
  folderMap: Map<string, string>,
  now: number,
): Promise<void> {
  for (const item of touched) {
    const existing = await db.characters.get(item.id)
    if (!existing) continue
    const raw = item.raw
    const rawFolderId = typeof raw.folderId === 'string' ? raw.folderId : null
    const folderId = rawFolderId ? (folderMap.get(rawFolderId) ?? null) : existing.folderId ?? null
    await db.characters.update(item.id, {
      tags: mapNumberArray(raw.tags, tagMap),
      folderId,
      document: remapDocument(raw.document, maps),
      updatedAt: now,
      _syncStatus: 'pending',
      _lastModified: now,
    })
  }
}

async function remapTouchedEvents(
  touched: Array<{ id: number; raw: Record<string, unknown> }>,
  maps: Record<'character' | 'event' | 'country' | 'world', Map<number, number>>,
  tagMap: Map<number, number>,
  now: number,
): Promise<void> {
  for (const item of touched) {
    const existing = await db.events.get(item.id)
    if (!existing) continue
    const raw = item.raw
    await db.events.update(item.id, {
      tags: mapNumberArray(raw.tags, tagMap),
      parentEventId: mapNumber(raw.parentEventId, maps.event) ?? null,
      document: remapDocument(raw.document, maps),
      updatedAt: now,
      _syncStatus: 'pending',
      _lastModified: now,
    })
  }
}

async function remapTouchedCountries(
  touched: Array<{ id: number; raw: Record<string, unknown> }>,
  maps: Record<'character' | 'event' | 'country' | 'world', Map<number, number>>,
  tagMap: Map<number, number>,
  now: number,
): Promise<void> {
  for (const item of touched) {
    const existing = await db.countries.get(item.id)
    if (!existing) continue
    const raw = item.raw
    await db.countries.update(item.id, {
      tags: mapNumberArray(raw.tags, tagMap),
      parentId: mapNumber(raw.parentId, maps.country) ?? null,
      document: remapDocument(raw.document, maps),
      updatedAt: now,
      _syncStatus: 'pending',
      _lastModified: now,
    })
  }
}

async function remapTouchedWorldEntries(
  touched: Array<{ id: number; raw: Record<string, unknown> }>,
  maps: Record<'character' | 'event' | 'country' | 'world', Map<number, number>>,
  tagMap: Map<number, number>,
  now: number,
): Promise<void> {
  for (const item of touched) {
    const existing = await db.worldEntries.get(item.id)
    if (!existing) continue
    const raw = item.raw
    const references = recordArray(raw.references)
      .map((reference) => {
        const targetType = text(reference.targetType)
        const mapped = mapNumber(reference.targetId, maps[targetType as keyof typeof maps] ?? new Map())
        if (mapped === undefined) return null
        return { targetType, targetId: mapped }
      })
      .filter((reference): reference is { targetType: string; targetId: number } => reference !== null)
    await db.worldEntries.update(item.id, {
      tags: mapNumberArray(raw.tags, tagMap),
      parentId: mapNumber(raw.parentId, maps.world) ?? null,
      references,
      document: remapDocument(raw.document, maps),
      updatedAt: now,
      _syncStatus: 'pending',
      _lastModified: now,
    })
  }
}


