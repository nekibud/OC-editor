'use client'

import { useEffect, useCallback, useState } from 'react'
import { db } from '@/lib/db'
import { filterByActiveWorld } from '@/lib/world-scope'

export interface AlbumEntry {
  url: string
  sourceName: string
  sourceType: string
  sourceId: number
  category: string
}

export function useAlbumData() {
  const [entries, setEntries] = useState<AlbumEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const result: AlbumEntry[] = []

    const characters = filterByActiveWorld(await db.characters.toArray()).filter((c) => !c.deleted)
    for (const c of characters) {
      if (c.avatarUrl) {
        result.push({ url: c.avatarUrl, sourceName: c.name, sourceType: 'character', sourceId: c.id!, category: 'avatar' })
      }
      if (c.qAvatarUrl) {
        result.push({ url: c.qAvatarUrl, sourceName: c.name, sourceType: 'character', sourceId: c.id!, category: 'qAvatar' })
      }
      if (Array.isArray(c.avatars)) {
        for (const av of c.avatars) {
          const url = typeof av === 'string' ? av : av.url
          if (url) result.push({ url, sourceName: c.name, sourceType: 'character', sourceId: c.id!, category: 'fullbody' })
        }
      }
      if (c.headerUrl) {
        result.push({ url: c.headerUrl, sourceName: c.name, sourceType: 'character', sourceId: c.id!, category: 'header' })
      }
      if (Array.isArray(c.gallery)) {
        for (const g of c.gallery) {
          const url = typeof g === 'string' ? g : g.url
          if (url) result.push({ url, sourceName: c.name, sourceType: 'character', sourceId: c.id!, category: 'gallery' })
        }
      }
    }

    const events = filterByActiveWorld(await db.events.toArray()).filter((e) => !e.deleted)
    for (const e of events) {
      if (e.headerUrl) {
        result.push({ url: e.headerUrl, sourceName: e.title, sourceType: 'event', sourceId: e.id!, category: 'header' })
      }
      if (Array.isArray(e.images)) {
        for (const img of e.images) {
          const url = typeof img === 'string' ? img : img.url
          if (url) result.push({ url, sourceName: e.title, sourceType: 'event', sourceId: e.id!, category: 'gallery' })
        }
      }
    }

    const countries = filterByActiveWorld(await db.countries.toArray()).filter((c) => !c.deleted)
    for (const c of countries) {
      if (c.flagUrl) {
        result.push({ url: c.flagUrl, sourceName: c.name, sourceType: 'country', sourceId: c.id!, category: 'flag' })
      }
      if (c.headerUrl) {
        result.push({ url: c.headerUrl, sourceName: c.name, sourceType: 'country', sourceId: c.id!, category: 'header' })
      }
    }

    setEntries(result)
    return result
  }, [])

  useEffect(() => {
    setLoading(true)
    void load().then(() => setLoading(false))
  }, [load])

  useEffect(() => {
    const reload = (): void => {
      void load()
    }
    window.addEventListener('data-updated', reload)
    window.addEventListener('oc-world-changed', reload)
    window.addEventListener('oc-albums-changed', reload)
    return () => {
      window.removeEventListener('data-updated', reload)
      window.removeEventListener('oc-world-changed', reload)
      window.removeEventListener('oc-albums-changed', reload)
    }
  }, [load])

  return { entries, loading, refresh: load }
}

/** 从相册移除一张图片引用；不删除其他条目仍在使用的文件。 */
export async function removeAlbumEntry(entry: AlbumEntry): Promise<void> {
  if (entry.sourceType === 'character') {
    const character = await db.characters.get(entry.sourceId)
    if (!character) return
    if (entry.category === 'avatar') await db.characters.update(character.id!, { avatarUrl: '' })
    else if (entry.category === 'qAvatar') await db.characters.update(character.id!, { qAvatarUrl: '' })
    else if (entry.category === 'header') await db.characters.update(character.id!, { headerUrl: '' })
    else if (entry.category === 'fullbody') {
      const avatars = (character.avatars ?? []).filter((item) => (typeof item === 'string' ? item : item.url) !== entry.url)
      await db.characters.update(character.id!, { avatars })
    } else if (entry.category === 'gallery') {
      const gallery = (character.gallery ?? []).filter((item) => (typeof item === 'string' ? item : item.url) !== entry.url)
      await db.characters.update(character.id!, { gallery })
    }
  } else if (entry.sourceType === 'event') {
    const event = await db.events.get(entry.sourceId)
    if (!event) return
    if (entry.category === 'header') await db.events.update(event.id!, { headerUrl: '' })
    else if (entry.category === 'gallery') {
      const images = (event.images ?? []).filter((item) => (typeof item === 'string' ? item : item.url) !== entry.url)
      await db.events.update(event.id!, { images })
    }
  } else if (entry.sourceType === 'country') {
    const country = await db.countries.get(entry.sourceId)
    if (!country) return
    if (entry.category === 'flag') await db.countries.update(country.id!, { flagUrl: '' })
    else if (entry.category === 'header') await db.countries.update(country.id!, { headerUrl: '' })
  }
  window.dispatchEvent(new Event('data-updated'))
  window.dispatchEvent(new Event('oc-albums-changed'))
}
