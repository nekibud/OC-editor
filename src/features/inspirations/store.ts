'use client'

import { useEffect, useState } from 'react'
import { activeWorldIdForWrite, belongsToActiveWorld, WORLD_CHANGED_EVENT } from '@/lib/world-scope'
import { liveQuery } from 'dexie'
import { novelDb } from '../novel/store'
import { detachInspiration, inspirationNote, novelNotes } from '../novel/notes'
import { memoText, type Inspiration } from './types'

export function useInspirations() {
  const [items, setItems] = useState<Inspiration[]>([])
  const [loading, setLoading] = useState(true)
  const [worldKey, setWorldKey] = useState(0)
  useEffect(() => {
    const reload = () => setWorldKey(key => key + 1)
    window.addEventListener(WORLD_CHANGED_EVENT, reload)
    return () => window.removeEventListener(WORLD_CHANGED_EVENT, reload)
  }, [])
  useEffect(() => {
    const query = liveQuery(() => novelDb.inspirations.orderBy('updatedAt').reverse().toArray()).subscribe({
      next: rows => { setItems(rows.filter(belongsToActiveWorld)); setLoading(false) }, error: () => setLoading(false),
    })
    return () => query.unsubscribe()
  }, [worldKey])
  return { items, loading }
}

export async function createInspiration(): Promise<string> {
  const id = crypto.randomUUID(), now = Date.now()
  await novelDb.inspirations.add({ id, worldId: activeWorldIdForWrite(), title: '', content: '<p></p>', createdAt: now, updatedAt: now })
  return id
}

export async function saveInspiration(id: string, draft: { title: string; content: string }): Promise<void> {
  await novelDb.transaction('rw', novelDb.inspirations, novelDb.novels, async () => {
    if (!await novelDb.inspirations.get(id)) throw new Error('这条灵感已被删除。')
    await novelDb.inspirations.update(id, { ...draft, updatedAt: Date.now() })
    const novels = await novelDb.novels.toArray()
    for (const novel of novels) {
      const notes = novelNotes(novel)
      if (!notes.some(note => note.inspirationId === id)) continue
      await novelDb.novels.update(novel.id!, { noteItems: notes.map(note => note.inspirationId === id ? { ...note, ...draft, text: memoText(draft.content) } : note), notes: '', updatedAt: Date.now() })
    }
  })
}

export async function deleteInspiration(id: string): Promise<void> {
  await novelDb.transaction('rw', novelDb.inspirations, novelDb.novels, async () => {
    const inspiration = await novelDb.inspirations.get(id)
    if (!inspiration || !belongsToActiveWorld(inspiration)) return
    for (const novel of await novelDb.novels.toArray()) {
      const notes = novelNotes(novel)
      if (notes.some(note => note.inspirationId === id)) await novelDb.novels.update(novel.id!, { noteItems: detachInspiration(notes, inspiration), notes: '', updatedAt: Date.now() })
    }
    await novelDb.inspirations.delete(id)
  })
}

export async function addNovelNote(novelId: number, inspirationId?: string): Promise<string> {
  return novelDb.transaction('rw', novelDb.novels, novelDb.inspirations, async () => {
    const novel = await novelDb.novels.get(novelId)
    if (!belongsToActiveWorld(novel) || !novel) throw new Error('小说不存在。')
    const notes = novelNotes(novel)
    if (inspirationId) {
      const existing = notes.find(note => note.inspirationId === inspirationId)
      if (existing) return existing.id
    }
    const inspiration = inspirationId ? await novelDb.inspirations.get(inspirationId) : undefined
    if (inspirationId && !belongsToActiveWorld(inspiration)) throw new Error('这条灵感已被删除。')
    const note = inspiration ? inspirationNote(inspiration) : { id: crypto.randomUUID(), title: '', text: '', content: '<p></p>' }
    await novelDb.novels.update(novelId, { noteItems: [...notes, note], notes: '', updatedAt: Date.now() })
    return note.id
  })
}

export async function updateNovelNote(novelId: number, noteId: string, draft: { title: string; content: string }): Promise<void> {
  await novelDb.transaction('rw', novelDb.novels, novelDb.inspirations, async () => {
    const novel = await novelDb.novels.get(novelId)
    const note = novel && novelNotes(novel).find(item => item.id === noteId)
    if (!novel || !note) throw new Error('这条笔记已被移除。')
    if (note.inspirationId && await novelDb.inspirations.get(note.inspirationId)) {
      await saveInspiration(note.inspirationId, draft)
    } else {
      await novelDb.novels.update(novelId, { noteItems: novelNotes(novel).map(item => item.id === noteId ? { ...item, ...draft, text: memoText(draft.content) } : item), notes: '', updatedAt: Date.now() })
    }
  })
}

export async function removeNovelNote(novelId: number, noteId: string): Promise<void> {
  await novelDb.transaction('rw', novelDb.novels, async () => {
    const novel = await novelDb.novels.get(novelId)
    if (novel && belongsToActiveWorld(novel)) await novelDb.novels.update(novelId, { noteItems: novelNotes(novel).filter(note => note.id !== noteId), notes: '', updatedAt: Date.now() })
  })
}
