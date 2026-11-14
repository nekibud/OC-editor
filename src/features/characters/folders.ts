'use client'

import { useCallback, useEffect, useState } from 'react'
import { activeWorldIdForWrite, belongsToActiveWorld, WORLD_CHANGED_EVENT } from '@/lib/world-scope'
import { db } from '@/lib/db'

/**
 * 角色文件夹。文件夹本身是纯本地元数据（localStorage），
 * 角色通过 Character.folderId 关联；删除文件夹只会把角色移回“未分类”，
 * 绝不会删除角色数据。
 */
export interface CharacterFolder {
  worldId?: number
  id: string
  name: string
  order: number
  createdAt: number
}

const STORAGE_KEY = 'oc-character-folders'
const CHANGE_EVENT = 'oc-character-folders-changed'

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `folder-${crypto.randomUUID()}`
    : `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function loadCharacterFolders(allWorlds = false): CharacterFolder[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
      ?? window.localStorage.getItem('oc-studio-character-folders-v1')
    if (!raw) return []
    const parsed = JSON.parse(raw) as CharacterFolder[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((folder) => folder && typeof folder.id === 'string')
      .map((folder, index) => ({
        worldId: folder.worldId,
        id: folder.id,
        name: String(folder.name || '未命名文件夹'),
        order: typeof folder.order === 'number' ? folder.order : index,
        createdAt: typeof folder.createdAt === 'number' ? folder.createdAt : Date.now(),
      }))
      .filter(folder => allWorlds || belongsToActiveWorld(folder))
      .sort((a, b) => a.order - b.order)
  } catch {
    return []
  }
}

export function saveCharacterFolders(folders: CharacterFolder[], allWorlds = false): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(allWorlds ? folders : [...loadCharacterFolders(true).filter(folder => !belongsToActiveWorld(folder)), ...folders]))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // ignore quota errors
  }
}

async function clearFolderAssignments(folderId: string): Promise<number> {
  const now = Date.now()
  let changed = 0
  await db.characters
    .filter((character) => character.folderId === folderId && belongsToActiveWorld(character))
    .modify((character) => {
      character.folderId = null
      character.updatedAt = now
      character._syncStatus = 'pending'
      changed += 1
    })
  if (changed > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('data-updated'))
  }
  return changed
}

export interface CharacterFolderApi {
  folders: CharacterFolder[]
  createFolder: (name: string) => CharacterFolder
  renameFolder: (id: string, name: string) => void
  deleteFolder: (id: string) => Promise<number>
  moveFolder: (id: string, direction: -1 | 1) => void
}

export function useCharacterFolders(): CharacterFolderApi {
  // 首屏与 SSR 保持一致，挂载后再读取 localStorage，避免水合不一致。
  const [folders, setFolders] = useState<CharacterFolder[]>([])

  useEffect(() => {
    const reload = (): void => setFolders(loadCharacterFolders())
    reload()
    window.addEventListener(CHANGE_EVENT, reload)
    window.addEventListener('storage', reload)
    window.addEventListener(WORLD_CHANGED_EVENT, reload)
    return () => {
      window.removeEventListener(CHANGE_EVENT, reload)
      window.removeEventListener('storage', reload)
      window.removeEventListener(WORLD_CHANGED_EVENT, reload)
    }
  }, [])

  const createFolder = useCallback((name: string): CharacterFolder => {
    const current = loadCharacterFolders()
    const folder: CharacterFolder = {
      worldId: activeWorldIdForWrite(),
      id: makeId(),
      name: name.trim() || '新文件夹',
      order: current.length > 0 ? Math.max(...current.map((item) => item.order)) + 1 : 0,
      createdAt: Date.now(),
    }
    saveCharacterFolders([...current, folder])
    return folder
  }, [])

  const renameFolder = useCallback((id: string, name: string): void => {
    const nextName = name.trim()
    if (!nextName) return
    saveCharacterFolders(
      loadCharacterFolders().map((folder) =>
        folder.id === id ? { ...folder, name: nextName } : folder,
      ),
    )
  }, [])

  const deleteFolder = useCallback(async (id: string): Promise<number> => {
    saveCharacterFolders(loadCharacterFolders().filter((folder) => folder.id !== id))
    return clearFolderAssignments(id)
  }, [])

  const moveFolder = useCallback((id: string, direction: -1 | 1): void => {
    const current = loadCharacterFolders()
    const index = current.findIndex((folder) => folder.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= current.length) return
    const next = [...current]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    saveCharacterFolders(next.map((folder, order) => ({ ...folder, order })))
  }, [])

  return { folders, createFolder, renameFolder, deleteFolder, moveFolder }
}

/** 把一批角色移动到文件夹；folderId 为 null 表示未分类。 */
export async function moveCharactersToFolder(
  characterIds: number[],
  folderId: string | null,
): Promise<void> {
  if (characterIds.length === 0) return
  const now = Date.now()
  await db.transaction('rw', db.characters, async () => {
    await db.characters
      .where('id')
      .anyOf(characterIds)
      .and(character => !character.deleted && belongsToActiveWorld(character))
      .modify((character) => {
        character.folderId = folderId
        character.updatedAt = now
        character._syncStatus = 'pending'
      })
  })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('data-updated'))
  }
}
