'use client'

import { useCallback, useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import Dexie, { type Table } from 'dexie'
import type { Novel, NovelChapter } from './types'
import type { ImportedNovel } from './transfer'
import { makeChapter } from './types'
import type { Inspiration } from '../inspirations/types'
import {
  activeWorldIdForWrite,
  belongsToActiveWorld,
  WORLD_CHANGED_EVENT,
} from '@/lib/world-scope'

// 数据库名沿用历史值：改名会变成新的空库，旧小说会“消失”。
export const novelDb = new Dexie('OCStudioNovels') as Dexie & {
  novels: Table<Novel, number>
  inspirations: Table<Inspiration, string>
}

novelDb.version(1).stores({
  novels: '++id,updatedAt',
})
novelDb.version(2).stores({ novels: '++id,updatedAt', inspirations: 'id,updatedAt' })

novelDb.version(3).stores({
  novels: '++id,worldId,updatedAt',
  inspirations: 'id,worldId,updatedAt',
})

export function useNovels(): {
  novels: Novel[]
  loading: boolean
  createNovel: (title?: string) => Promise<Novel>
  updateNovel: (id: number, patch: Partial<Novel>) => Promise<void>
  importNovel: (novel: ImportedNovel) => Promise<Novel>
  deleteNovel: (id: number) => Promise<void>
} {
  const [novels, setNovels] = useState<Novel[]>([])
  const [loading, setLoading] = useState(true)
  const [worldKey, setWorldKey] = useState(0)

  useEffect(() => {
    const handler = (): void => setWorldKey((key) => key + 1)
    window.addEventListener(WORLD_CHANGED_EVENT, handler)
    return () => window.removeEventListener(WORLD_CHANGED_EVENT, handler)
  }, [])

  useEffect(() => {
    const subscription = liveQuery(() =>
      novelDb.novels.orderBy('updatedAt').reverse().toArray(),
    ).subscribe({
      next: (rows) => {
        setNovels(rows.filter(belongsToActiveWorld))
        setLoading(false)
      },
      error: () => setLoading(false),
    })
    return () => subscription.unsubscribe()
  }, [worldKey])

  const createNovel = useCallback(async (title = '未命名小说'): Promise<Novel> => {
    const now = Date.now()
    const novel: Novel = {
      worldId: activeWorldIdForWrite(),
      title,
      author: '',
      synopsis: '',
      chapters: [makeChapter('新章节')],
      createdAt: now,
      updatedAt: now,
    }
    const id = await novelDb.novels.add(novel)
    return { ...novel, id }
  }, [])

  const updateNovel = useCallback(async (id: number, patch: Partial<Novel>): Promise<void> => {
    await novelDb.novels.update(id, { ...patch, updatedAt: Date.now() })
  }, [])

  const deleteNovel = useCallback(async (id: number): Promise<void> => {
    await novelDb.novels.delete(id)
  }, [])

  const importNovel = useCallback(async (book: ImportedNovel): Promise<Novel> => {
    const now = Date.now()
    const novel: Novel = { ...book, worldId: activeWorldIdForWrite(), createdAt: now, updatedAt: now }
    const id = await novelDb.novels.add(novel)
    return { ...novel, id }
  }, [])

  return { novels, loading, createNovel, updateNovel, deleteNovel, importNovel }
}

export function saveChapterContent(
  novel: Novel,
  chapterId: string,
  content: string,
): NovelChapter[] {
  return novel.chapters.map((chapter) =>
    chapter.id === chapterId ? { ...chapter, content } : chapter,
  )
}
