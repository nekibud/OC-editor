import { db } from '@/lib/db'
import type { World } from '@/types'
import {
  getActiveWorldId,
  getLegacyWorldId,
  markWorldScopeReady,
  setActiveWorldId,
  setLegacyWorldId,
} from '@/lib/world-scope'

const TABLE = 'worlds'

export const WORLDS_CHANGED_EVENT = 'oc-worlds-changed'

function notifyWorldsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(WORLDS_CHANGED_EVENT))
  window.dispatchEvent(new Event('data-updated'))
}

export async function listWorlds(): Promise<World[]> {
  const all = await db.worlds.toArray()
  return all
    .filter((world) => !world.deleted)
    .sort((a, b) => {
      const orderDiff = (a.order ?? 0) - (b.order ?? 0)
      if (orderDiff !== 0) return orderDiff
      return a.createdAt - b.createdAt
    })
}

export async function getWorld(id: number): Promise<World | undefined> {
  return db.worlds.get(id)
}

export interface WorldContentCounts {
  characters: number
  events: number
  countries: number
  entries: number
  maps: number
  relations: number
}

/** 统计某个世界观下的内容数量；用于选择页展示。 */
export async function countWorldContents(worldId: number): Promise<WorldContentCounts> {
  const belongs = (row: { worldId?: number | null; deleted?: boolean }): boolean =>
    !row.deleted && (row.worldId === worldId || row.worldId === undefined || row.worldId === null)
  const [characters, events, countries, entries, maps, relations] = await Promise.all([
    db.characters.toArray(),
    db.events.toArray(),
    db.countries.toArray(),
    db.worldEntries.toArray(),
    db.maps.toArray(),
    db.relations.toArray(),
  ])
  return {
    characters: characters.filter(belongs).length,
    events: events.filter(belongs).length,
    countries: countries.filter(belongs).length,
    entries: entries.filter(belongs).length,
    maps: maps.filter(belongs).length,
    relations: relations.filter(belongs).length,
  }
}

/**
 * 把还没有 worldId 的记录归属到指定世界观。
 * 首次创建世界观时（示例数据、旧版本遗留数据）调用。
 */
export async function claimUnscopedRecords(worldId: number): Promise<void> {
  for (const table of [
    db.characters,
    db.events,
    db.countries,
    db.worldEntries,
    db.periods,
    db.maps,
    db.relations,
  ] as unknown as { toCollection: () => { modify: (fn: (row: { worldId?: number }) => void) => Promise<number> } }[]) {
    await table.toCollection().modify((row) => {
      if (row.worldId === undefined || row.worldId === null) row.worldId = worldId
    })
  }
}

export async function createWorld(input: {
  name: string
  description?: string
  accentColor?: string
}): Promise<World> {
  const name = input.name.trim() || '未命名世界观'
  const now = Date.now()
  const existing = await listWorlds()
  const record: World = {
    name,
    description: input.description?.trim() ?? '',
    accentColor: input.accentColor,
    order: existing.length,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
  const id = await db.worlds.add(record)
  // 第一个世界观接管没有归属的旧数据/示例数据。
  if (existing.length === 0 || getLegacyWorldId() === null) {
    await claimUnscopedRecords(id)
    setLegacyWorldId(id)
  }
  notifyWorldsChanged()
  return { ...record, id }
}

export async function renameWorld(id: number, name: string): Promise<void> {
  const next = name.trim()
  if (!next) return
  await db.worlds.update(id, { name: next, updatedAt: Date.now() })
  notifyWorldsChanged()
}

export async function updateWorld(
  id: number,
  patch: Partial<Pick<World, 'name' | 'description' | 'accentColor' | 'order'>>,
): Promise<void> {
  const updates: Partial<World> = { updatedAt: Date.now() }
  if (patch.name !== undefined && patch.name.trim()) updates.name = patch.name.trim()
  if (patch.description !== undefined) updates.description = patch.description
  if (patch.accentColor !== undefined) updates.accentColor = patch.accentColor
  if (patch.order !== undefined) updates.order = patch.order
  await db.worlds.update(id, updates)
  notifyWorldsChanged()
}

/**
 * 删除世界观：只做软删除，其中的创作内容保留在数据库里，
 * 但不再出现在任何列表中（避免误删整部作品）。
 * 至少保留一个世界观，否则应用会进入“空选择页”。
 */
export async function deleteWorld(id: number): Promise<void> {
  const worlds = await listWorlds()
  if (worlds.length <= 1 && worlds.some((world) => world.id === id)) {
    throw new Error('至少保留一个世界观')
  }
  await db.worlds.update(id, { deleted: true, updatedAt: Date.now() })
  if (getActiveWorldId() === id) {
    const remaining = await listWorlds()
    setActiveWorldId(remaining[0]?.id ?? null)
  }
  notifyWorldsChanged()
}

/**
 * 找出仍然带着 worldId 的内容。用于“世界观行丢失/全部被软删除”时恢复作用域。
 * 只读第一行，避免启动时扫描大库。
 */
async function findContentWorldId(): Promise<number | null> {
  const tables = [db.characters, db.events, db.countries, db.worldEntries, db.periods, db.maps] as unknown as Array<{
    filter: (fn: (row: { worldId?: number; deleted?: boolean }) => boolean) => { first: () => Promise<{ worldId?: number } | undefined> }
  }>
  for (const table of tables) {
    const row = await table.filter((item) => !item.deleted).first()
    if (row?.worldId !== undefined && row.worldId !== null) return row.worldId
  }
  return null
}

/**
 * 世界观行丢失但内容还在时，不能把界面停在“暂无世界观”诱导用户新建。
 * 先恢复被软删除的世界；再不行，就用内容里残留的 worldId 补一行。
 */
async function recoverWorldScope(): Promise<boolean> {
  const all = await db.worlds.toArray()
  const deleted = all.filter((world) => world.deleted && world.id !== undefined)
  if (deleted.length > 0) {
    const now = Date.now()
    await Promise.all(
      deleted.map((world) => db.worlds.update(world.id as number, { deleted: false, updatedAt: now })),
    )
    return true
  }

  const worldId = await findContentWorldId()
  if (worldId === null) return false
  const now = Date.now()
  await db.worlds.add({
    id: worldId,
    name: '恢复的世界观',
    description: '检测到已有角色/事件/地图等内容，但世界观记录丢失，已自动恢复。',
    order: 0,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  })
  await claimUnscopedRecords(worldId)
  return true
}

/**
 * 启动时确定作用域：加载世界观、校验上次选择、记录默认世界观。
 * 正常情况由选择页决定进入哪个世界观；只有检测到“内容还在、世界观行丢了”
 * 时才自动恢复并进入，避免用户误以为数据被清空后又新建一个空世界。
 */
export async function resolveWorldScope(): Promise<{ worlds: World[]; active: World | null }> {
  let worlds = await listWorlds()
  let recovered = false
  if (worlds.length === 0) {
    recovered = await recoverWorldScope()
    if (recovered) worlds = await listWorlds()
  }

  setLegacyWorldId(worlds[0]?.id ?? null)
  const storedId = getActiveWorldId()
  let active = storedId === null ? null : worlds.find((world) => world.id === storedId) ?? null
  if (!active && recovered && worlds[0]?.id !== undefined) {
    active = worlds[0]
    setActiveWorldId(active.id as number)
  }
  if (storedId !== null && !active) setActiveWorldId(null)
  markWorldScopeReady()
  return { worlds, active }
}

export { TABLE as WORLDS_TABLE }
