import { db } from '@/lib/db'
import { loadCharacterFolders, saveCharacterFolders } from '@/features/characters/folders'
import { parseCharacterFolders, planCharacterFolderImport } from '@/features/characters/folder-backup'
import { getActiveWorldId, getLegacyWorldId } from '@/lib/world-scope'
import type { QueryClient } from '@tanstack/react-query'
import type { Table } from 'dexie'

interface ImportPayload {
  version: 1 | 2
  exportedAt?: string
  data: {
    characters: unknown[]
    events: unknown[]
    countries: unknown[]
    worldEntries: unknown[]
    tags: unknown[]
    maps?: unknown[]
    characterFolders?: unknown[]
    worlds?: unknown[]
  }
}

export interface ImportSummary {
  characters: number
  events: number
  countries: number
  worldEntries: number
  tags: number
  maps: number
}

export type MergeStrategy = 'skip' | 'overwrite' | 'keep-both' | 'replace'

export interface ImportResult {
  added: number
  skipped: number
  overwritten: number
}

const TABLE_CONFIG: Array<{
  key: 'characters' | 'events' | 'countries' | 'worldEntries' | 'tags' | 'maps'
  table: Table<Record<string, unknown>, number>
  nameField: string
}> = [
  { key: 'characters', table: db.characters as unknown as Table<Record<string, unknown>, number>, nameField: 'name' },
  { key: 'events', table: db.events as unknown as Table<Record<string, unknown>, number>, nameField: 'title' },
  { key: 'countries', table: db.countries as unknown as Table<Record<string, unknown>, number>, nameField: 'name' },
  { key: 'worldEntries', table: db.worldEntries as unknown as Table<Record<string, unknown>, number>, nameField: 'title' },
  { key: 'tags', table: db.tags as unknown as Table<Record<string, unknown>, number>, nameField: 'name' },
  { key: 'maps', table: db.maps as unknown as Table<Record<string, unknown>, number>, nameField: 'name' },
]

/**
 * 备份里的世界按名称对齐到本地：同名复用，缺失则新建。
 * 返回「备份世界 id → 本地世界 id」的映射。
 */
async function resolveImportedWorlds(incoming: unknown[]): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  if (incoming.length === 0) return map
  const local = (await db.worlds.toArray()).filter((world) => !world.deleted)
  const now = Date.now()
  for (const item of incoming) {
    if (item === null || typeof item !== 'object') continue
    const world = item as { id?: unknown; name?: unknown; description?: unknown }
    const name = typeof world.name === 'string' ? world.name.trim() : ''
    if (!name) continue
    const existing = local.find((entry) => entry.name === name)
    if (existing?.id !== undefined) {
      if (typeof world.id === 'number') map.set(world.id, existing.id)
      continue
    }
    const id = await db.worlds.add({
      name,
      description: typeof world.description === 'string' ? world.description : '',
      order: local.length,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    local.push({
      id,
      name,
      description: typeof world.description === 'string' ? world.description : '',
      order: local.length,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    if (typeof world.id === 'number') map.set(world.id, id)
  }
  return map
}

function remapRecordWorldId(
  row: unknown,
  worldMap: Map<number, number>,
  fallback: number | undefined,
): unknown {
  if (row === null || typeof row !== 'object') return row
  const { worldId, ...rest } = row as Record<string, unknown>
  if (typeof worldId === 'number' && worldMap.has(worldId)) {
    return { ...rest, worldId: worldMap.get(worldId) }
  }
  if (fallback !== undefined) return { ...rest, worldId: fallback }
  return rest
}

export function validateImportData(json: unknown): ImportSummary {
  if (json === null || typeof json !== 'object') {
    throw new Error('无效的数据格式：数据不是 JSON 对象')
  }

  const payload = json as Record<string, unknown>

  if (payload.version !== 1 && payload.version !== 2) {
    throw new Error(`不支持的版本：${String(payload.version)}，仅支持 version 1 或 2`)
  }

  const data = payload.data as Record<string, unknown> | undefined
  if (!data || typeof data !== 'object') {
    throw new Error('缺少 data 字段')
  }

  const tables = ['characters', 'events', 'countries', 'worldEntries', 'tags'] as const

  for (const table of tables) {
    if (!Array.isArray(data[table])) {
      throw new Error(`缺少 data.${table} 数组`)
    }
  }
  if (data.maps !== undefined && !Array.isArray(data.maps)) {
    throw new Error('data.maps 必须是数组')
  }

  parseCharacterFolders(data.characterFolders)

  return {
    characters: (data.characters as unknown[]).length,
    events: (data.events as unknown[]).length,
    countries: (data.countries as unknown[]).length,
    worldEntries: (data.worldEntries as unknown[]).length,
    tags: (data.tags as unknown[]).length,
    maps: Array.isArray(data.maps) ? data.maps.length : 0,
  }
}

const REMOTE_URL_FIELDS = new Set([
  'url',
  'src',
  'avatarUrl',
  'qAvatarUrl',
  'headerUrl',
  'flagUrl',
])

/**
 * 隐私硬约束：导入数据中任何图片字段的外部 URL 都清空。
 * 保留 data:/blob:/相对路径；不会把远程资源带进渲染流程。
 */
export function stripRemoteUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripRemoteUrls(item))
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(source)) {
      if (
        typeof item === 'string' &&
        REMOTE_URL_FIELDS.has(key) &&
        /^(https?:)?\/\//i.test(item.trim())
      ) {
        result[key] = ''
      } else {
        result[key] = stripRemoteUrls(item)
      }
    }
    return result
  }
  return value
}

async function processTableMerge(
  table: Table<Record<string, unknown>, number>,
  records: unknown[],
  strategy: MergeStrategy,
  nameField: string,
): Promise<{ added: number; skipped: number; overwritten: number }> {
  if (records.length === 0) return { added: 0, skipped: 0, overwritten: 0 }

  if (strategy === 'keep-both') {
    const toAdd = records.map((r) => {
      const { id: _id, ...rest } = r as Record<string, unknown>
      void _id
      return rest
    })
    await table.bulkAdd(toAdd as never[])
    return { added: toAdd.length, skipped: 0, overwritten: 0 }
  }

  const existingRecords = await table.toArray()
  const existingByName = new Map<string, Record<string, unknown>>()
  // 同名合并只在同一世界观内进行，避免导入把别的世界的同名条目覆盖掉。
  const incomingWorldIds = new Set(
    records
      .map((record) => (record as { worldId?: unknown }).worldId)
      .filter((worldId): worldId is number => typeof worldId === 'number'),
  )

  for (const item of existingRecords) {
    const itemWorldId = (item as { worldId?: unknown }).worldId
    if (
      incomingWorldIds.size > 0 &&
      typeof itemWorldId === 'number' &&
      !incomingWorldIds.has(itemWorldId)
    ) {
      continue
    }
    const name = item[nameField]
    if (typeof name === 'string') {
      existingByName.set(name.toLowerCase().trim(), item)
    }
  }

  let added = 0
  let skipped = 0
  let overwritten = 0

  const toAdd: unknown[] = []

  for (const rawRecord of records) {
    const rec = rawRecord as Record<string, unknown>
    const name = rec[nameField]

    if (typeof name !== 'string') {
      const { id: _id, ...rest } = rec
      void _id
      toAdd.push(rest)
      added++
      continue
    }

    const key = name.toLowerCase().trim()
    const existing = existingByName.get(key)

    if (existing) {
      if (strategy === 'overwrite') {
        const { id: _importId, ...importData } = rec
        void _importId
        await table.put({ ...importData, id: existing.id } as Record<string, unknown>)
        overwritten++
      } else {
        skipped++
      }
    } else {
      const { id: _id, ...rest } = rec
      void _id
      toAdd.push(rest)
      added++
    }
  }

  if (toAdd.length > 0) {
    await table.bulkAdd(toAdd as never[])
  }

  return { added, skipped, overwritten }
}

export async function importData(
  json: unknown,
  strategy: MergeStrategy,
  queryClient?: QueryClient,
): Promise<ImportResult> {
  validateImportData(json)
  const sanitized = stripRemoteUrls(json) as ImportPayload
  const records = sanitized.data
  const maps = Array.isArray(records.maps) ? records.maps : []
  const worlds = Array.isArray(records.worlds) ? records.worlds : []
  const worldMap = await resolveImportedWorlds(worlds)
  const fallbackWorldId = getActiveWorldId() ?? getLegacyWorldId() ?? undefined
  const withWorld = (items: unknown[]): unknown[] =>
    items.map((item) => remapRecordWorldId(item, worldMap, fallbackWorldId))
  const folderPlan = planCharacterFolderImport(
    loadCharacterFolders(true).map(folder => ({ ...folder, worldId: folder.worldId ?? getLegacyWorldId() ?? undefined })),
    parseCharacterFolders(records.characterFolders).map(folder => remapRecordWorldId(folder, worldMap, fallbackWorldId) as typeof folder),
    records.characters,
    strategy,
  )
  const characters = withWorld(folderPlan.characters)
  const events = withWorld(records.events)
  const countries = withWorld(records.countries)
  const worldEntries = withWorld(records.worldEntries)
  const mapRecords = withWorld(maps)

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('oc-worlds-changed'))
  }

  if (strategy === 'replace') {
    await db.characters.clear()
    await db.events.clear()
    await db.countries.clear()
    await db.worldEntries.clear()
    await db.tags.clear()
    await db.maps.clear()

    await Promise.all([
      characters.length > 0 ? db.characters.bulkAdd(characters as never[]) : Promise.resolve(),
      events.length > 0 ? db.events.bulkAdd(events as never[]) : Promise.resolve(),
      countries.length > 0 ? db.countries.bulkAdd(countries as never[]) : Promise.resolve(),
      worldEntries.length > 0 ? db.worldEntries.bulkAdd(worldEntries as never[]) : Promise.resolve(),
      records.tags.length > 0 ? db.tags.bulkAdd(records.tags as never[]) : Promise.resolve(),
      mapRecords.length > 0 ? db.maps.bulkAdd(mapRecords as never[]) : Promise.resolve(),
    ])

    const total =
      characters.length +
      events.length +
      countries.length +
      worldEntries.length +
      records.tags.length +
      mapRecords.length
    saveCharacterFolders(folderPlan.folders, true)
    queryClient?.invalidateQueries()
    return { added: total, skipped: 0, overwritten: 0 }
  }

  let totalAdded = 0
  let totalSkipped = 0
  let totalOverwritten = 0

  for (const config of TABLE_CONFIG) {
    const items = (config.key === 'maps'
      ? mapRecords
      : config.key === 'tags'
        ? records.tags
        : config.key === 'characters'
          ? characters
          : config.key === 'events'
            ? events
            : config.key === 'countries'
              ? countries
              : worldEntries) as unknown[]
    const result = await processTableMerge(config.table, items, strategy, config.nameField)
    totalAdded += result.added
    totalSkipped += result.skipped
    totalOverwritten += result.overwritten
  }

  saveCharacterFolders(folderPlan.folders, true)
  queryClient?.invalidateQueries()

  return { added: totalAdded, skipped: totalSkipped, overwritten: totalOverwritten }
}
