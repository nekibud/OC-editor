import { db } from '@/lib/db'
import { filterByActiveWorld } from '@/lib/world-scope'
import { logOperation } from '@/lib/sync'
import { updateReferencesAfterRename, syncReferenceLabels } from '@/lib/reference-sync'
import type { WorldEntry } from '@/types'
import type { WorldFormData } from './types'

const TABLE = 'worldEntries'

function buildDefaultEntry(data: WorldFormData, overrides: Partial<WorldEntry> = {}): Omit<WorldEntry, 'id'> {
  const now = Date.now()
  return {
    title: data.title,
    content: data.content ?? '',
    category: data.category,
    parentId: data.parentId,
    order: data.order,
    isConcept: data.isConcept,
    references: [],
    tags: data.tags ?? [],
    createdAt: now,
    updatedAt: now,
    deleted: false,
    _syncStatus: 'pending',
    _lastModified: now,
    ...overrides,
  }
}

/**
 * 修复词条层级：父级不存在、父级已删除、自己指向自己、或 A→B→A 的环，
 * 一律退回根级。拖拽到空白处最容易产生这种“还在库里但树里看不见”的记录。
 */
export async function repairEntryHierarchy(): Promise<number> {
  const all = await db.worldEntries.toArray()
  const byId = new Map(all.map((entry) => [entry.id as number, entry]))
  const broken = new Set<number>()
  for (const entry of all) {
    const id = entry.id as number
    const parentId = entry.parentId
    if (parentId === null || parentId === undefined) continue
    if (parentId === id || !byId.has(parentId) || byId.get(parentId)?.deleted) {
      broken.add(id)
      continue
    }
    const seen = new Set<number>([id])
    let cursor: number | null | undefined = parentId
    let guard = 0
    while (cursor !== null && cursor !== undefined) {
      if (seen.has(cursor) || guard++ > all.length) {
        broken.add(id)
        break
      }
      seen.add(cursor)
      cursor = byId.get(cursor)?.parentId
    }
  }
  if (broken.size === 0) return 0
  const now = Date.now()
  await db.worldEntries.bulkUpdate(
    [...broken].map((id) => ({
      key: id,
      changes: { parentId: null, updatedAt: now, _syncStatus: 'pending' as const, _lastModified: now },
    })),
  )
  return broken.size
}

export async function getEntries(): Promise<WorldEntry[]> {
  await repairEntryHierarchy()
  const all = await db.worldEntries.orderBy('title').toArray()
  return filterByActiveWorld(all).filter((e) => !e.deleted)
}

export async function getEntry(id: number): Promise<WorldEntry | undefined> {
  return db.worldEntries.get(id)
}

export async function createEntry(data: WorldFormData): Promise<number> {
  const entry = buildDefaultEntry(data)
  const id = await db.worldEntries.add(entry as WorldEntry)
  await logOperation(TABLE, id, 'title', '', data.title)
  return id
}

async function safeParentId(id: number, parentId: number | null | undefined): Promise<number | null> {
  if (parentId === null || parentId === undefined) return null
  if (parentId === id) return null
  const all = await db.worldEntries.toArray()
  const byId = new Map(all.map((entry) => [entry.id as number, entry]))
  if (!byId.has(parentId) || byId.get(parentId)?.deleted) return null
  let cursor: number | null | undefined = parentId
  let guard = 0
  while (cursor !== null && cursor !== undefined) {
    if (cursor === id || guard++ > all.length) return null
    cursor = byId.get(cursor)?.parentId
  }
  return parentId
}

export async function updateEntry(id: number, data: Partial<WorldFormData>): Promise<void> {
  const existing = await db.worldEntries.get(id)
  if (!existing) throw new Error(`WorldEntry not found: ${id}`)
  const now = Date.now()
  const updates: Partial<WorldEntry> = { updatedAt: now, _syncStatus: 'pending', _lastModified: now }
  type FieldKey = keyof WorldFormData
  const fields: FieldKey[] = ['title', 'content', 'category', 'parentId', 'order', 'isConcept']
  for (const field of fields) {
    let newValue = data[field]
    if (newValue !== undefined) {
      if (field === 'parentId') newValue = (await safeParentId(id, newValue as number | null)) as never
      const oldValue = existing[field] ?? ''
      ;(updates as Record<string, unknown>)[field] = newValue
      await logOperation(TABLE, id, field, String(oldValue), String(newValue ?? ''))
    }
  }

  if (data.tags !== undefined) {
    ;(updates as Record<string, unknown>).tags = data.tags
    await logOperation(
      TABLE,
      id,
      'tags',
      JSON.stringify(existing.tags ?? []),
      JSON.stringify(data.tags),
    )
  }

  if (data.document !== undefined) {
    const synced = await syncReferenceLabels(data.document as Record<string, unknown>)
    ;(updates as Record<string, unknown>).document = synced
  }

  await db.worldEntries.update(id, updates)

  if (data.title !== undefined) {
    updateReferencesAfterRename('world', id, data.title).catch(() => {})
  }
}

export async function deleteEntry(id: number): Promise<void> {
  const now = Date.now()
  await db.worldEntries.update(id, { deleted: true, _syncStatus: 'pending', _lastModified: now })
  await logOperation(TABLE, id, 'deleted', 'false', 'true')
}

export async function saveDocument(id: number, document: unknown): Promise<void> {
  const now = Date.now()
  await db.worldEntries.update(id, {
    document,
    updatedAt: now,
    _syncStatus: 'pending',
    _lastModified: now,
  })
}

export async function saveEntryContent(
  id: number,
  title: string,
  content: string,
): Promise<void> {
  try {
    const now = Date.now()
    // 同时写 document，后续版本/导入器可以直接读结构化 JSON；
    // content 继续保留为 JSON 字符串以兼容旧版 OC Studio。
    let document: unknown
    try {
      document = JSON.parse(content) as unknown
    } catch {
      document = undefined
    }
    await db.worldEntries.update(id, {
      title,
      content,
      ...(document ? { document } : {}),
      updatedAt: now,
      _syncStatus: 'pending',
      _lastModified: now,
    })
  } catch (err) {
    console.error(`[saveEntryContent] 自动保存失败 id=${id}:`, err)
    throw err
  }
}

export async function reorderEntries(
  updates: { id: number; parentId: number | null; order: number }[],
): Promise<void> {
  if (updates.length === 0) return
  const all = await db.worldEntries.toArray()
  const byId = new Map(all.map((entry) => [entry.id as number, entry]))
  const proposed = new Map<number, number | null>()
  for (const entry of all) proposed.set(entry.id as number, entry.parentId ?? null)
  for (const update of updates) proposed.set(update.id, update.parentId)

  // 拖拽到空白处可能造成自指或环；写入前统一修成根级。
  const safeParent = (id: number): number | null => {
    const parentId = proposed.get(id)
    if (parentId === null || parentId === undefined || parentId === id) return null
    if (!byId.has(parentId) || byId.get(parentId)?.deleted) return null
    const seen = new Set<number>([id])
    let cursor: number | null | undefined = parentId
    let guard = 0
    while (cursor !== null && cursor !== undefined) {
      if (seen.has(cursor) || guard++ > all.length) return null
      seen.add(cursor)
      cursor = proposed.get(cursor) ?? byId.get(cursor)?.parentId ?? null
    }
    return parentId
  }

  const now = Date.now()
  await db.transaction('rw', db.worldEntries, async () => {
    for (const update of updates) {
      await db.worldEntries.update(update.id, {
        parentId: safeParent(update.id),
        order: update.order,
        updatedAt: now,
        _syncStatus: 'pending',
        _lastModified: now,
      })
    }
  })
}

export async function renameEntry(id: number, title: string): Promise<void> {
  const now = Date.now()
  await db.worldEntries.update(id, {
    title,
    updatedAt: now,
    _syncStatus: 'pending',
    _lastModified: now,
  })

  updateReferencesAfterRename('world', id, title).catch(() => {})
  await logOperation(TABLE, id, 'title', '', title)
}
