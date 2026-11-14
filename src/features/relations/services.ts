import { db } from '@/lib/db'
import {
  activeWorldIdForWrite,
  belongsToActiveWorld,
  filterByActiveWorld,
} from '@/lib/world-scope'
import type {
  Character,
  Country,
  Event,
  RelatedCharacter,
  RelationEntityType,
  RelationKind,
  RelationRecord,
} from '@/types'
import { characterCountry, countryColor } from '@/features/countries/colors'
import type { GraphEdge, GraphNode } from './types'
import type { RelationArrow } from './style'
import { migrateLegacyRelationStyles } from './legacy-style-migration'

const MANAGED_KINDS: RelationKind[] = [
  'character',
  'membership',
  'event-character',
  'event-country',
  'event-event',
  'nation',
]

const DEFAULT_LABELS: Record<RelationKind, string> = {
  character: '相关',
  membership: '属于',
  'event-character': '参与',
  'event-country': '发生于',
  'event-event': '相关',
  nation: '关系',
  custom: '相关',
}

export function relationId(
  sourceType: RelationEntityType,
  sourceId: number,
  targetType: RelationEntityType,
  targetId: number,
): string {
  return `${sourceType}:${sourceId}->${targetType}:${targetId}`
}

export function inferRelationKind(
  sourceType: RelationEntityType,
  targetType: RelationEntityType,
): RelationKind {
  if (sourceType === 'character' && targetType === 'character') return 'character'
  if (sourceType === 'country' && targetType === 'country') return 'nation'
  if (sourceType === 'event' && targetType === 'event') return 'event-event'
  if (sourceType === 'event' || targetType === 'event') {
    if (sourceType === 'character' || targetType === 'character') return 'event-character'
    return 'event-country'
  }
  return 'membership'
}

function normalizeEndpoints(
  sourceType: RelationEntityType,
  sourceId: number,
  targetType: RelationEntityType,
  targetId: number,
  kind: RelationKind,
): {
  sourceType: RelationEntityType
  sourceId: number
  targetType: RelationEntityType
  targetId: number
} {
  let nextSourceType = sourceType
  let nextTargetType = targetType
  let nextSourceId = sourceId
  let nextTargetId = targetId

  // 事件边统一为 event → character/country；角色归属统一为 character → country。
  if (kind === 'event-character' || kind === 'event-country') {
    if (sourceType !== 'event') {
      nextSourceType = targetType
      nextTargetType = sourceType
      nextSourceId = targetId
      nextTargetId = sourceId
    }
  } else if (kind === 'membership') {
    if (sourceType !== 'character') {
      nextSourceType = targetType
      nextTargetType = sourceType
      nextSourceId = targetId
      nextTargetId = sourceId
    }
  } else if (kind === 'nation' || kind === 'character' || kind === 'event-event') {
    if (nextSourceId > nextTargetId) {
      const swapId = nextSourceId
      nextSourceId = nextTargetId
      nextTargetId = swapId
    }
  }

  return {
    sourceType: nextSourceType,
    sourceId: nextSourceId,
    targetType: nextTargetType,
    targetId: nextTargetId,
  }
}

async function readEntities(): Promise<{
  characters: Character[]
  countries: Country[]
  events: Event[]
}> {
  const [charactersRaw, countriesRaw, eventsRaw] = await Promise.all([
    db.characters.toArray(),
    db.countries.toArray(),
    db.events.toArray(),
  ])
  return {
    characters: filterByActiveWorld(charactersRaw).filter((item) => !item.deleted),
    countries: filterByActiveWorld(countriesRaw).filter((item) => !item.deleted),
    events: filterByActiveWorld(eventsRaw).filter((item) => !item.deleted),
  }
}

function collectProjectedRelations(
  characters: Character[],
  countries: Country[],
  events: Event[],
): Map<string, RelationRecord> {
  const now = Date.now()
  const characterIds = new Set(characters.map((item) => item.id).filter((id): id is number => id !== undefined))
  const countryIds = new Set(countries.map((item) => item.id).filter((id): id is number => id !== undefined))
  const rows = new Map<string, RelationRecord>()

  const add = (
    sourceType: RelationEntityType,
    sourceId: number | undefined,
    targetType: RelationEntityType,
    targetId: number | undefined,
    kind: RelationKind,
    label: string,
    existingId?: string,
  ): void => {
    if (
      sourceId === undefined ||
      targetId === undefined ||
      (sourceType === targetType && sourceId === targetId)
    ) {
      return
    }
    const normalized = normalizeEndpoints(sourceType, sourceId, targetType, targetId, kind)
    const id =
      existingId ??
      relationId(sourceType, normalized.sourceId, targetType, normalized.targetId)
    if (rows.has(id)) return
    rows.set(id, {
      id,
      sourceType,
      sourceId: normalized.sourceId,
      targetType,
      targetId: normalized.targetId,
      kind,
      label: label.trim() || DEFAULT_LABELS[kind],
      directed: kind !== 'nation' && kind !== 'character',
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
  }

  for (const character of characters) {
    if (character.id === undefined) continue
    for (const related of character.relatedCharacters ?? []) {
      if (related.characterId && characterIds.has(related.characterId)) {
        add(
          'character',
          character.id,
          'character',
          related.characterId,
          'character',
          related.relation,
          related.relationId,
        )
      }
    }
    if (character.countryId && countryIds.has(character.countryId)) {
      add(
        'character',
        character.id,
        'country',
        character.countryId,
        'membership',
        character.relatedNationLabels?.[character.countryId] ?? DEFAULT_LABELS.membership,
      )
    }
    for (const nationId of character.relatedNations ?? []) {
      if (countryIds.has(nationId)) {
        add(
          'character',
          character.id,
          'country',
          nationId,
          'membership',
          character.relatedNationLabels?.[nationId] ?? DEFAULT_LABELS.membership,
        )
      }
    }
    for (const eventId of character.relatedEvents ?? []) {
      if (events.some((event) => event.id === eventId)) {
        add(
          'event',
          eventId,
          'character',
          character.id,
          'event-character',
          character.relatedEventLabels?.[eventId] ?? DEFAULT_LABELS['event-character'],
        )
      }
    }
  }

  for (const country of countries) {
    if (country.id === undefined) continue
    for (const nationId of country.relatedNations ?? []) {
      if (countryIds.has(nationId)) {
        add(
          'country',
          country.id,
          'country',
          nationId,
          'nation',
          country.relatedNationLabels?.[nationId] ?? DEFAULT_LABELS.nation,
        )
      }
    }
    for (const characterId of country.characters ?? []) {
      if (characterIds.has(characterId)) {
        add('character', characterId, 'country', country.id, 'membership', DEFAULT_LABELS.membership)
      }
    }
    for (const eventId of country.relatedEvents ?? []) {
      if (events.some((event) => event.id === eventId)) {
        add(
          'event',
          eventId,
          'country',
          country.id,
          'event-country',
          country.relatedEventLabels?.[eventId] ?? DEFAULT_LABELS['event-country'],
        )
      }
    }
    for (const eventId of country.events ?? []) {
      if (events.some((event) => event.id === eventId)) {
        add(
          'event',
          eventId,
          'country',
          country.id,
          'event-country',
          country.relatedEventLabels?.[eventId] ?? DEFAULT_LABELS['event-country'],
        )
      }
    }
  }

  for (const event of events) {
    if (event.id === undefined) continue
    for (const related of event.relations ?? []) {
      if (events.some((item) => item.id === related.targetId)) {
        add(
          'event',
          event.id,
          'event',
          related.targetId,
          'event-event',
          related.relation,
        )
      }
    }
    for (const characterId of event.characters ?? []) {
      if (characterIds.has(characterId)) {
        add('event', event.id, 'character', characterId, 'event-character', DEFAULT_LABELS['event-character'])
      }
    }
    for (const countryId of event.countries ?? []) {
      if (countryIds.has(countryId)) {
        add('event', event.id, 'country', countryId, 'event-country', DEFAULT_LABELS['event-country'])
      }
    }
  }

  return rows
}

/**
 * 在「相关人物」投影里定位一条关系。
 * 新数据用 relationId 精确匹配（同一对角色可以有多条关系）；
 * 旧数据没有 relationId，用「对端 id + 标签」兜底匹配。
 */
function findCharacterProjection(
  list: RelatedCharacter[] | undefined,
  relation: RelationRecord,
  otherId: number,
): RelatedCharacter | undefined {
  const items = list ?? []
  const byId = items.find((item) => item.relationId === relation.id)
  if (byId) return byId
  return items.find(
    (item) => !item.relationId && item.characterId === otherId && item.relation === relation.label,
  )
}

function isSameCharacterProjection(
  item: RelatedCharacter,
  relation: RelationRecord,
  otherId: number,
): boolean {
  if (item.relationId) return item.relationId === relation.id
  return item.characterId === otherId && item.relation === relation.label
}

function removeCharacterProjection(
  list: RelatedCharacter[] | undefined,
  relation: RelationRecord,
  otherId: number,
): RelatedCharacter[] {
  const items = list ?? []
  if (items.some((item) => item.relationId === relation.id)) {
    return items.filter((item) => item.relationId !== relation.id)
  }
  // 旧投影没有 relationId：只删掉标签匹配的那一条，同对的其他关系保留。
  let removed = false
  return items.filter((item) => {
    if (removed) return true
    if (!item.relationId && item.characterId === otherId && item.relation === relation.label) {
      removed = true
      return false
    }
    return true
  })
}

function relationIsOneSided(
  relation: RelationRecord,
  characterById: Map<number, Character>,
  countryById: Map<number, Country>,
  eventById: Map<number, Event>,
): boolean {
  if (relation.kind === 'character') {
    const source = characterById.get(relation.sourceId)
    const target = characterById.get(relation.targetId)
    if (!source || !target || source.id === undefined || target.id === undefined) return false
    const sourceLink = findCharacterProjection(source.relatedCharacters, relation, target.id)
    const targetLink = findCharacterProjection(target.relatedCharacters, relation, source.id)
    return (
      !sourceLink ||
      !targetLink ||
      sourceLink.relation !== relation.label ||
      targetLink.relation !== relation.label
    )
  }

  if (relation.kind === 'membership') {
    const character = characterById.get(relation.sourceId)
    const country = countryById.get(relation.targetId)
    if (!character || !country) return false
    return (
      !(character.relatedNations ?? []).includes(country.id!) ||
      !(country.characters ?? []).includes(character.id!) ||
      character.relatedNationLabels?.[country.id!] !== relation.label
    )
  }

  if (relation.kind === 'event-character') {
    const event = eventById.get(relation.sourceId)
    const character = characterById.get(relation.targetId)
    if (!event || !character) return false
    return (
      !(event.characters ?? []).includes(character.id!) ||
      !(character.relatedEvents ?? []).includes(event.id!) ||
      character.relatedEventLabels?.[event.id!] !== relation.label
    )
  }

  if (relation.kind === 'event-country') {
    const event = eventById.get(relation.sourceId)
    const country = countryById.get(relation.targetId)
    if (!event || !country) return false
    return (
      !(event.countries ?? []).includes(country.id!) ||
      !(country.relatedEvents ?? []).includes(event.id!) ||
      country.relatedEventLabels?.[event.id!] !== relation.label
    )
  }

  if (relation.kind === 'nation') {
    const source = countryById.get(relation.sourceId)
    const target = countryById.get(relation.targetId)
    if (!source || !target) return false
    return (
      !(source.relatedNations ?? []).includes(target.id!) ||
      !(target.relatedNations ?? []).includes(source.id!) ||
      source.relatedNationLabels?.[target.id!] !== relation.label ||
      target.relatedNationLabels?.[source.id!] !== relation.label
    )
  }

  if (relation.kind === 'event-event') {
    const source = eventById.get(relation.sourceId)
    const target = eventById.get(relation.targetId)
    if (!source || !target) return false
    const sourceLink = (source.relations ?? []).find((item) => item.targetId === target.id)
    const targetLink = (target.relations ?? []).find((item) => item.targetId === source.id)
    return (
      !sourceLink ||
      !targetLink ||
      sourceLink.relation !== relation.label ||
      targetLink.relation !== relation.label
    )
  }

  return false
}

export interface RelationSyncResult {
  relations: RelationRecord[]
  /** 本次是否修复了实体面板里的投影（会写库）。 */
  changed: boolean
}

/**
 * 将旧实体数组中的关系投影合并进 relations 表。
 * 数组仍然可以在旧面板中编辑；这里把它们作为输入，写回唯一真相源。
 *
 * 注意：这里只做幂等修复，不再广播 data-updated 事件。
 * 以往在修复后广播会让 useGraphData 立刻重新同步，同一对角色存在多条关系时
 * 每次同步都判定「缺一边」→ 写库 → 广播 → 再同步，形成无限刷屏。
 */
export async function syncRelationsFromEntities(): Promise<RelationSyncResult> {
  const entities = await readEntities()
  const projected = collectProjectedRelations(entities.characters, entities.countries, entities.events)
  const existing = new Map((await db.relations.toArray()).map((relation) => [relation.id, relation]))
  const now = Date.now()
  const changes: RelationRecord[] = []
  let changed = false

  const characterById = new Map(entities.characters.map((item) => [item.id!, item]))
  const countryById = new Map(entities.countries.map((item) => [item.id!, item]))
  const eventById = new Map(entities.events.map((item) => [item.id!, item]))
  for (const relation of projected.values()) {
    if (!relationIsOneSided(relation, characterById, countryById, eventById)) continue
    const canonical = existing.get(relation.id)
    const wrote = await applyProjectionAdd({
      ...relation,
      label: canonical && !canonical.deleted ? canonical.label : relation.label,
    })
    if (wrote) changed = true
  }

  for (const relation of projected.values()) {
    const current = existing.get(relation.id)
    if (!current) {
      changes.push(relation)
      continue
    }
    // Canonical relation is the shared label authority. Panel edits update it
    // through syncRelationLabelFromEntity; graph edits update it directly.
    const nextLabel =
      current && !current.deleted
        ? current.label
        : relation.label || current.label
    if (
      current.deleted ||
      current.label !== nextLabel ||
      current.kind !== relation.kind ||
      current.directed !== relation.directed ||
      current.worldId === undefined
    ) {
      changes.push({
        ...current,
        worldId: current.worldId ?? activeWorldIdForWrite(),
        label: nextLabel,
        kind: relation.kind,
        directed: relation.directed,
        deleted: false,
        updatedAt: now,
      })
    }
  }

  // 已从面板移除的旧关系同步软删除；custom 边不在此清理，避免误删图编辑创建的关系。
  // 新创建的边可能比数组投影晚 1-2 帧落库，给 3 秒宽限，避免“刚连线就被同步删掉”。
  const inWorldEntityKey = new Set<string>([
    ...entities.characters.map((item) => `character-${item.id}`),
    ...entities.countries.map((item) => `country-${item.id}`),
    ...entities.events.map((item) => `event-${item.id}`),
  ])
  const relationInScope = (relation: RelationRecord): boolean => {
    if (relation.worldId !== undefined && !belongsToActiveWorld(relation)) return false
    return (
      inWorldEntityKey.has(`${relation.sourceType}-${relation.sourceId}`) &&
      inWorldEntityKey.has(`${relation.targetType}-${relation.targetId}`)
    )
  }
  for (const current of existing.values()) {
    if (projected.has(current.id) || current.deleted) continue
    if (!MANAGED_KINDS.includes(current.kind)) continue
    if (!relationInScope(current)) continue
    if (now - current.updatedAt < 3000) continue
    changes.push({ ...current, deleted: true, updatedAt: now })
  }

  if (changes.length > 0) {
    await db.relations.bulkPut(changes)
  }

  if (typeof window !== 'undefined') {
    await migrateLegacyRelationStyles(window.localStorage, async (id, style) => {
      const relation = await db.relations.get(id)
      if (!relation || relation.deleted) return false
      await db.relations.update(id, style)
      return true
    })
  }

  return { relations: [...projected.values()], changed }
}

function uniquePush<T>(values: T[] | undefined, value: T): T[] {
  const list = values ? [...values] : []
  if (!list.includes(value)) list.push(value)
  return list
}

function uniqueRemove<T>(values: T[] | undefined, value: T): T[] {
  return (values ?? []).filter((item) => item !== value)
}

function withoutKey(record: Record<number, string> | undefined, key: number): Record<number, string> {
  const next = { ...(record ?? {}) }
  delete next[key]
  return next
}

/** 写库前比较，内容没变就不写；否则 liveQuery 会因空写一直刷新。 */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function upsertCharacterProjection(
  list: RelatedCharacter[] | undefined,
  relation: RelationRecord,
  otherId: number,
  otherName: string,
): RelatedCharacter[] {
  const items = [...(list ?? [])]
  const index = items.findIndex((item) => isSameCharacterProjection(item, relation, otherId))
  const next: RelatedCharacter = {
    relationId: relation.id,
    characterId: otherId,
    name: otherName,
    relation: relation.label,
  }
  if (index >= 0) items[index] = next
  else items.push(next)
  return items
}

/** 把一条关系写回实体面板的投影字段；返回是否真的写库。 */
async function applyProjectionAdd(relation: RelationRecord): Promise<boolean> {
  const { characters, countries, events } = await readEntities()
  const characterById = new Map(characters.map((item) => [item.id, item]))
  const countryById = new Map(countries.map((item) => [item.id, item]))
  const eventById = new Map(events.map((item) => [item.id, item]))
  const now = Date.now()
  const writes: Promise<unknown>[] = []

  if (relation.kind === 'character') {
    const source = characterById.get(relation.sourceId)
    const target = characterById.get(relation.targetId)
    if (source?.id !== undefined && target?.id !== undefined) {
      const nextSource = upsertCharacterProjection(
        source.relatedCharacters,
        relation,
        target.id,
        target.name,
      )
      const nextTarget = upsertCharacterProjection(
        target.relatedCharacters,
        relation,
        source.id,
        source.name,
      )
      if (!sameJson(source.relatedCharacters, nextSource)) {
        writes.push(
          db.characters.update(source.id, {
            relatedCharacters: nextSource,
            updatedAt: now,
            _syncStatus: 'pending',
          }),
        )
      }
      if (!sameJson(target.relatedCharacters, nextTarget)) {
        writes.push(
          db.characters.update(target.id, {
            relatedCharacters: nextTarget,
            updatedAt: now,
            _syncStatus: 'pending',
          }),
        )
      }
    }
  } else if (relation.kind === 'membership') {
    const character = characterById.get(relation.sourceId)
    const country = countryById.get(relation.targetId)
    if (character?.id !== undefined && country?.id !== undefined) {
      const nextNations = uniquePush(character.relatedNations, country.id)
      const nextLabels = {
        ...(character.relatedNationLabels ?? {}),
        [country.id]: relation.label,
      }
      const nextCountryCharacters = uniquePush(country.characters, character.id)
      if (
        character.countryId !== country.id ||
        !sameJson(character.relatedNations, nextNations) ||
        !sameJson(character.relatedNationLabels, nextLabels)
      ) {
        writes.push(
          db.characters.update(character.id, {
            countryId: country.id,
            relatedNations: nextNations,
            relatedNationLabels: nextLabels,
            updatedAt: now,
            _syncStatus: 'pending',
          }),
        )
      }
      if (!sameJson(country.characters, nextCountryCharacters)) {
        writes.push(
          db.countries.update(country.id, {
            characters: nextCountryCharacters,
            updatedAt: now,
            _syncStatus: 'pending',
          }),
        )
      }
    }
  } else if (relation.kind === 'event-character') {
    const event = eventById.get(relation.sourceId)
    const character = characterById.get(relation.targetId)
    if (event?.id !== undefined && character?.id !== undefined) {
      const nextEventCharacters = uniquePush(event.characters, character.id)
      const nextEvents = uniquePush(character.relatedEvents, event.id)
      const nextLabels = {
        ...(character.relatedEventLabels ?? {}),
        [event.id]: relation.label,
      }
      if (!sameJson(event.characters, nextEventCharacters)) {
        writes.push(
          db.events.update(event.id, {
            characters: nextEventCharacters,
            updatedAt: now,
            _syncStatus: 'pending',
          }),
        )
      }
      if (
        !sameJson(character.relatedEvents, nextEvents) ||
        !sameJson(character.relatedEventLabels, nextLabels)
      ) {
        writes.push(
          db.characters.update(character.id, {
            relatedEvents: nextEvents,
            relatedEventLabels: nextLabels,
            updatedAt: now,
            _syncStatus: 'pending',
          }),
        )
      }
    }
  } else if (
    relation.kind === 'event-event' ||
    (relation.sourceType === 'event' && relation.targetType === 'event')
  ) {
    const source = eventById.get(relation.sourceId)
    const target = eventById.get(relation.targetId)
    const upsert = (
      list: Event['relations'],
      targetId: number,
      label: string,
    ): Event['relations'] => {
      const items = [...(list ?? [])]
      const index = items.findIndex((item) => item.targetId === targetId)
      const next = { targetId, relation: label }
      if (index >= 0) items[index] = next
      else items.push(next)
      return items
    }
    if (source?.id !== undefined && target?.id !== undefined) {
      const nextSource = upsert(source.relations, target.id, relation.label)
      const nextTarget = upsert(target.relations, source.id, relation.label)
      if (!sameJson(source.relations, nextSource)) {
        writes.push(
          db.events.update(source.id, {
            relations: nextSource,
            updatedAt: now,
            _syncStatus: 'pending',
          }),
        )
      }
      if (!sameJson(target.relations, nextTarget)) {
        writes.push(
          db.events.update(target.id, {
            relations: nextTarget,
            updatedAt: now,
            _syncStatus: 'pending',
          }),
        )
      }
    }
  } else if (relation.kind === 'event-country') {
    const event = eventById.get(relation.sourceId)
    const country = countryById.get(relation.targetId)
    if (event?.id !== undefined && country?.id !== undefined) {
      const nextEventCountries = uniquePush(event.countries, country.id)
      const nextCountryEvents = uniquePush(country.relatedEvents, event.id)
      const nextLabels = {
        ...(country.relatedEventLabels ?? {}),
        [event.id]: relation.label,
      }
      if (!sameJson(event.countries, nextEventCountries)) {
        writes.push(
          db.events.update(event.id, {
            countries: nextEventCountries,
            updatedAt: now,
            _syncStatus: 'pending',
          }),
        )
      }
      if (
        !sameJson(country.relatedEvents, nextCountryEvents) ||
        !sameJson(country.relatedEventLabels, nextLabels)
      ) {
        writes.push(
          db.countries.update(country.id, {
            relatedEvents: nextCountryEvents,
            relatedEventLabels: nextLabels,
            updatedAt: now,
            _syncStatus: 'pending',
          }),
        )
      }
    }
  } else if (relation.kind === 'nation') {
    const source = countryById.get(relation.sourceId)
    const target = countryById.get(relation.targetId)
    if (source?.id !== undefined && target?.id !== undefined) {
      const nextSourceNations = uniquePush(source.relatedNations, target.id)
      const nextSourceLabels = {
        ...(source.relatedNationLabels ?? {}),
        [target.id]: relation.label,
      }
      const nextTargetNations = uniquePush(target.relatedNations, source.id)
      const nextTargetLabels = {
        ...(target.relatedNationLabels ?? {}),
        [source.id]: relation.label,
      }
      if (
        !sameJson(source.relatedNations, nextSourceNations) ||
        !sameJson(source.relatedNationLabels, nextSourceLabels)
      ) {
        writes.push(
          db.countries.update(source.id, {
            relatedNations: nextSourceNations,
            relatedNationLabels: nextSourceLabels,
            updatedAt: now,
            _syncStatus: 'pending',
          }),
        )
      }
      if (
        !sameJson(target.relatedNations, nextTargetNations) ||
        !sameJson(target.relatedNationLabels, nextTargetLabels)
      ) {
        writes.push(
          db.countries.update(target.id, {
            relatedNations: nextTargetNations,
            relatedNationLabels: nextTargetLabels,
            updatedAt: now,
            _syncStatus: 'pending',
          }),
        )
      }
    }
  }

  if (writes.length === 0) return false
  await Promise.all(writes)
  return true
}

async function applyProjectionRemove(relation: RelationRecord): Promise<void> {
  const { characters, countries, events } = await readEntities()
  const characterById = new Map(characters.map((item) => [item.id, item]))
  const countryById = new Map(countries.map((item) => [item.id, item]))
  const eventById = new Map(events.map((item) => [item.id, item]))
  const now = Date.now()

  if (relation.kind === 'character') {
    const source = characterById.get(relation.sourceId)
    const target = characterById.get(relation.targetId)
    if (source?.id !== undefined && target?.id !== undefined) {
      const nextSource = removeCharacterProjection(source.relatedCharacters, relation, target.id)
      const nextTarget = removeCharacterProjection(target.relatedCharacters, relation, source.id)
      if (!sameJson(source.relatedCharacters, nextSource)) {
        await db.characters.update(source.id, {
          relatedCharacters: nextSource,
          updatedAt: now,
          _syncStatus: 'pending',
        })
      }
      if (!sameJson(target.relatedCharacters, nextTarget)) {
        await db.characters.update(target.id, {
          relatedCharacters: nextTarget,
          updatedAt: now,
          _syncStatus: 'pending',
        })
      }
    }
  } else if (relation.kind === 'membership') {
    const character = characterById.get(relation.sourceId)
    const country = countryById.get(relation.targetId)
    if (character?.id !== undefined) {
      await db.characters.update(character.id, {
        countryId: character.countryId === country?.id ? undefined : character.countryId,
        relatedNations: uniqueRemove(character.relatedNations, country?.id ?? -1),
        relatedNationLabels: withoutKey(character.relatedNationLabels, country?.id ?? -1),
        updatedAt: now,
        _syncStatus: 'pending',
      })
    }
    if (country?.id !== undefined) {
      await db.countries.update(country.id, {
        characters: uniqueRemove(country.characters, relation.sourceId),
        updatedAt: now,
        _syncStatus: 'pending',
      })
    }
  } else if (relation.kind === 'event-character') {
    const event = eventById.get(relation.sourceId)
    const character = characterById.get(relation.targetId)
    if (event?.id !== undefined) {
      await db.events.update(event.id, {
        characters: uniqueRemove(event.characters, relation.targetId),
        updatedAt: now,
        _syncStatus: 'pending',
      })
    }
    if (character?.id !== undefined) {
      await db.characters.update(character.id, {
        relatedEvents: uniqueRemove(character.relatedEvents, relation.sourceId),
        relatedEventLabels: withoutKey(character.relatedEventLabels, relation.sourceId),
        updatedAt: now,
        _syncStatus: 'pending',
      })
    }
  } else if (
    relation.kind === 'event-event' ||
    (relation.sourceType === 'event' && relation.targetType === 'event')
  ) {
    const source = eventById.get(relation.sourceId)
    const target = eventById.get(relation.targetId)
    const remove = (list: Event['relations'], targetId: number): Event['relations'] =>
      (list ?? []).filter((item) => item.targetId !== targetId)
    if (source?.id !== undefined) {
      await db.events.update(source.id, {
        relations: remove(source.relations, relation.targetId),
        updatedAt: now,
        _syncStatus: 'pending',
      })
    }
    if (target?.id !== undefined) {
      await db.events.update(target.id, {
        relations: remove(target.relations, relation.sourceId),
        updatedAt: now,
        _syncStatus: 'pending',
      })
    }
  } else if (relation.kind === 'event-country') {
    const event = eventById.get(relation.sourceId)
    const country = countryById.get(relation.targetId)
    if (event?.id !== undefined) {
      await db.events.update(event.id, {
        countries: uniqueRemove(event.countries, relation.targetId),
        updatedAt: now,
        _syncStatus: 'pending',
      })
    }
    if (country?.id !== undefined) {
      await db.countries.update(country.id, {
        relatedEvents: uniqueRemove(country.relatedEvents, relation.sourceId),
        relatedEventLabels: withoutKey(country.relatedEventLabels, relation.sourceId),
        updatedAt: now,
        _syncStatus: 'pending',
      })
    }
  } else if (relation.kind === 'nation') {
    const source = countryById.get(relation.sourceId)
    const target = countryById.get(relation.targetId)
    if (source?.id !== undefined) {
      await db.countries.update(source.id, {
        relatedNations: uniqueRemove(source.relatedNations, relation.targetId),
        relatedNationLabels: withoutKey(source.relatedNationLabels, relation.targetId),
        updatedAt: now,
        _syncStatus: 'pending',
      })
    }
    if (target?.id !== undefined) {
      await db.countries.update(target.id, {
        relatedNations: uniqueRemove(target.relatedNations, relation.sourceId),
        relatedNationLabels: withoutKey(target.relatedNationLabels, relation.sourceId),
        updatedAt: now,
        _syncStatus: 'pending',
      })
    }
  }
}

function notifyRelationsChanged(): void {
  window.dispatchEvent(new Event('oc-relations-changed'))
  window.dispatchEvent(new Event('data-updated'))
}

/**
 * When a legacy entity panel changes a relation label, keep the canonical
 * relation table in step. The entity projection is already written by the
 * caller; this only updates the shared label used by the graph.
 */
export async function syncRelationLabelFromEntity(
  kind: RelationKind,
  sourceType: RelationEntityType,
  sourceId: number,
  targetType: RelationEntityType,
  targetId: number,
  label: string,
  explicitId?: string,
): Promise<void> {
  if (sourceType === targetType && sourceId === targetId) return
  const normalized = normalizeEndpoints(sourceType, sourceId, targetType, targetId, kind)
  const id =
    explicitId ??
    relationId(
      normalized.sourceType,
      normalized.sourceId,
      normalized.targetType,
      normalized.targetId,
    )
  const current = await db.relations.get(id)
  if (!current || current.deleted) return
  const nextLabel = label.trim() || DEFAULT_LABELS[kind]
  if (current.label === nextLabel) return
  await db.relations.update(id, { label: nextLabel, updatedAt: Date.now() })
}

export async function updateRelationLabel(id: string, label: string): Promise<void> {
  const relation = await db.relations.get(id)
  if (!relation) return
  const nextLabel = label.trim() || DEFAULT_LABELS[relation.kind]
  await db.relations.update(id, { label: nextLabel, updatedAt: Date.now(), deleted: false })
  await applyProjectionAdd({ ...relation, label: nextLabel })
  notifyRelationsChanged()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('data-updated'))
  }
}

/** 更新关系线颜色/箭头，标签与连线共用同一个颜色。 */
export async function updateRelationStyle(
  id: string,
  patch: { color?: string; arrow?: RelationArrow },
): Promise<void> {
  const relation = await db.relations.get(id)
  if (!relation) return
  const updates: Partial<RelationRecord> = { updatedAt: Date.now() }
  if (patch.color !== undefined) updates.color = patch.color
  if (patch.arrow !== undefined) updates.arrow = patch.arrow
  await db.relations.update(id, updates)
  notifyRelationsChanged()
}

export async function deleteRelation(id: string): Promise<void> {
  const relation = await db.relations.get(id)
  if (!relation) return
  await db.relations.update(id, { deleted: true, updatedAt: Date.now() })
  await applyProjectionRemove(relation)
  notifyRelationsChanged()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('data-updated'))
  }
}

export async function createRelation(input: {
  sourceType: RelationEntityType
  sourceId: number
  targetType: RelationEntityType
  targetId: number
  kind?: RelationKind
  label?: string
  /** 角色之间允许同一对节点存在多条关系；其他类型仍保持一对一。 */
  allowDuplicate?: boolean
}): Promise<RelationRecord | null> {
  if (input.sourceType === input.targetType && input.sourceId === input.targetId) return null
  const kind = input.kind ?? inferRelationKind(input.sourceType, input.targetType)
  const normalized = normalizeEndpoints(
    input.sourceType,
    input.sourceId,
    input.targetType,
    input.targetId,
    kind,
  )
  const now = Date.now()
  const baseId = relationId(
    normalized.sourceType,
    normalized.sourceId,
    normalized.targetType,
    normalized.targetId,
  )
  const existing = await db.relations.get(baseId)
  let id = baseId
  if (existing && !existing.deleted) {
    const canDuplicate =
      Boolean(input.allowDuplicate) && kind === 'character' &&
      normalized.sourceType === 'character' && normalized.targetType === 'character'
    if (!canDuplicate) return existing
    id = `${baseId}#${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`
  }
  const record: RelationRecord = {
    id,
    worldId: activeWorldIdForWrite(),
    sourceType: normalized.sourceType,
    sourceId: normalized.sourceId,
    targetType: normalized.targetType,
    targetId: normalized.targetId,
    kind,
    label: input.label?.trim() || DEFAULT_LABELS[kind],
    directed: kind !== 'nation' && kind !== 'character',
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
  await db.relations.put(record)
  await applyProjectionAdd(record)
  notifyRelationsChanged()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('data-updated'))
  }
  return record
}

export async function buildGraphData(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  // 只读：liveQuery 内不能写 Dexie。实体数组与 canonical relations 在内存中合并，
  // 使面板编辑立即可见；持久化由 useGraphData 在写事务外调用 syncRelationsFromEntities。
  const [charactersRaw, eventsRaw, countriesRaw, relationsRaw] = await Promise.all([
    db.characters.toArray(),
    db.events.toArray(),
    db.countries.toArray(),
    db.relations.toArray(),
  ])
  const characters = filterByActiveWorld(charactersRaw).filter((item) => !item.deleted)
  const events = filterByActiveWorld(eventsRaw).filter((item) => !item.deleted)
  const countries = filterByActiveWorld(countriesRaw).filter((item) => !item.deleted)
  const relations = relationsRaw.filter(
    (item) => !item.deleted && (item.worldId === undefined || belongsToActiveWorld(item)),
  )
  const projected = collectProjectedRelations(characters, countries, events)
  const mergedRelations = new Map(projected)
  for (const relation of relations) {
    const current = mergedRelations.get(relation.id)
    // 有投影时以实体数组/标签映射为准；样式（颜色/箭头）始终以 canonical 为准。
    if (!current) mergedRelations.set(relation.id, relation)
    else {
      mergedRelations.set(relation.id, {
        ...current,
        directed: relation.directed,
        color: relation.color,
        arrow: relation.arrow,
      })
    }
  }
  const edgesSource = [...mergedRelations.values()]

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const nodeIds = new Set<string>()

  function addNode(
    id: string,
    label: string,
    type: RelationEntityType,
    entityId: number,
    subtitle?: string,
  ): void {
    if (nodeIds.has(id)) return
    nodeIds.add(id)
    nodes.push({
      id,
      type: `${type}Node`,
      position: { x: 0, y: 0 },
      data: { id, label, entityType: type, entityId, subtitle },
    })
  }

  for (const character of characters) {
    if (character.id === undefined) continue
    const id = `character-${character.id}`
    addNode(id, character.name, 'character', character.id, character.aliases?.join('、') || undefined)
    const node = nodes.find((item) => item.id === id)
    if (node) {
      const data = node.data as Record<string, unknown>
      data.avatarUrl = character.avatarUrl
      data.qAvatarUrl = character.qAvatarUrl ?? ''
      data.accentColor = character.accentColor ?? ''
      const country = characterCountry(character, countries)
      data.countryColor = country ? countryColor(country) : undefined
      data.countryName = country?.name
      data.entityKind = character.entityKind ?? 'character'
    }
  }
  for (const event of events) {
    if (event.id === undefined) continue
    const id = `event-${event.id}`
    addNode(id, event.title, 'event', event.id, event.time)
    const node = nodes.find((item) => item.id === id)
    if (node) {
      const data = node.data as Record<string, unknown>
      data.imageUrl = event.headerUrl || event.images?.[0]?.url || ''
    }
  }
  for (const country of countries) {
    if (country.id === undefined) continue
    const id = `country-${country.id}`
    addNode(id, country.name, 'country', country.id)
    const node = nodes.find((item) => item.id === id)
    if (node) {
      const data = node.data as Record<string, unknown>
      data.flagUrl = country.flagUrl ?? ''
      data.accentColor = country.accentColor ?? ''
    }
  }

  for (const relation of edgesSource) {
    const source = `${relation.sourceType}-${relation.sourceId}`
    const target = `${relation.targetType}-${relation.targetId}`
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue
    edges.push({
      id: relation.id,
      source,
      target,
      type: 'relationEdge',
      data: {
        relation: relation.label,
        relationId: relation.id,
        kind: relation.kind,
        directed: relation.directed,
        color: relation.color,
        arrow: relation.arrow,
      },
    })
  }

  return { nodes, edges }
}
