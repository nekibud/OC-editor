'use client'

import { useState, useEffect } from 'react'
import { db } from '@/lib/db'
import { syncReferenceLabels } from '@/lib/reference-sync'
import { parseDocumentValue } from '@/lib/document-format'

type EntityType = 'character' | 'event' | 'country' | 'worldEntry'

export function useDocument(entityId: number, entityType: EntityType) {
  const [document, setDocument] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        let record: { document?: unknown } | undefined
        switch (entityType) {
          case 'character':
            record = await db.characters.get(entityId)
            break
          case 'event':
            record = await db.events.get(entityId)
            break
          case 'country':
            record = await db.countries.get(entityId)
            break
          case 'worldEntry':
            record = await db.worldEntries.get(entityId)
            break
        }
        if (cancelled) return
        if (!record) {
          setError('记录不存在')
          return
        }
        // 旧版本可能把 JSON 存成字符串；必须解成对象再交给 Tiptap，
        // 否则编辑器会把 JSON 当 HTML 文本，重启后格式全乱。
        const doc = parseDocumentValue(record.document)
        if (doc) {
          const synced = await syncReferenceLabels(doc)
          if (!cancelled) setDocument(synced)
        } else if (typeof record.document === 'string' && record.document.trim()) {
          // 历史版本可能存 HTML；交给 Tiptap 按 HTML 解析。
          if (!cancelled) setDocument(record.document)
        } else {
          if (!cancelled) setDocument(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [entityId, entityType])

  return { document, loading, error }
}
