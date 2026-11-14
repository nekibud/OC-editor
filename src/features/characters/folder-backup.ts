import type { CharacterFolder } from './folders'

type FolderMergeStrategy = 'skip' | 'overwrite' | 'keep-both' | 'replace'

/** 旧备份没有此字段；新备份的文件夹必须可由角色的 folderId 引用。 */
export function parseCharacterFolders(value: unknown): CharacterFolder[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('data.characterFolders 必须是数组')
  const ids = new Set<string>()
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' ||
      typeof item.id !== 'string' || !item.id.trim() ||
      typeof item.name !== 'string' || !item.name.trim() || ids.has(item.id)) {
      throw new Error('data.characterFolders 包含无效或重复的文件夹')
    }
    ids.add(item.id)
    return {
      ...(typeof item.worldId === 'number' ? { worldId: item.worldId } : {}),
      id: item.id,
      name: item.name.trim(),
      order: typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : index,
      createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
        ? item.createdAt : 0,
    }
  })
}

export function planCharacterFolderImport(
  current: CharacterFolder[],
  incoming: CharacterFolder[],
  characters: unknown[],
  strategy: FolderMergeStrategy,
): { folders: CharacterFolder[]; characters: unknown[] } {
  const folders = new Map((strategy === 'replace' ? [] : current).map((folder) => [folder.id, folder]))
  const remap = new Map<string, string>()
  // 先占用所有导入 ID，避免生成的新 ID 与稍后的文件夹冲突。
  const occupied = new Set([...folders.keys(), ...incoming.map((folder) => folder.id)])
  for (const folder of incoming) {
    const existing = folders.get(folder.id)
    if (existing && (existing.worldId !== folder.worldId || (strategy === 'keep-both' && existing.name !== folder.name))) {
      let suffix = 1
      let id = `${folder.id}-import-${suffix}`
      while (occupied.has(id)) id = `${folder.id}-import-${++suffix}`
      occupied.add(id)
      remap.set(folder.id, id)
      folders.set(id, { ...folder, id })
    } else if (!existing || strategy === 'overwrite') {
      folders.set(folder.id, folder)
    }
  }
  return {
    folders: [...folders.values()].map((folder, order) => ({ ...folder, order })),
    characters: characters.map((record) => {
      if (!record || typeof record !== 'object') return record
      const character = record as Record<string, unknown>
      const id = typeof character.folderId === 'string' ? remap.get(character.folderId) : undefined
      return id ? { ...character, folderId: id } : character
    }),
  }
}
