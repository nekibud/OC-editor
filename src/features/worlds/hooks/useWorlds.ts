'use client'

import { useCallback, useEffect, useState } from 'react'
import type { World } from '@/types'
import { getActiveWorldId, setActiveWorldId } from '@/lib/world-scope'
import {
  WORLDS_CHANGED_EVENT,
  createWorld,
  deleteWorld,
  listWorlds,
  renameWorld,
  resolveWorldScope,
  updateWorld,
} from '../services'

export interface WorldStore {
  worlds: World[]
  activeWorld: World | null
  activeWorldId: number | null
  /** 世界观列表是否加载完成（加载完成前不要渲染主界面）。 */
  ready: boolean
  loading: boolean
  error: string | null
  selectWorld: (id: number) => void
  createWorld: (input: { name: string; description?: string }) => Promise<World>
  renameWorld: (id: number, name: string) => Promise<void>
  updateWorld: (id: number, patch: Partial<Pick<World, 'name' | 'description' | 'accentColor'>>) => Promise<void>
  removeWorld: (id: number) => Promise<void>
  refresh: () => Promise<void>
}

/**
 * 世界观列表 + 当前选择。切换世界观会触发全局刷新（data-updated）。
 */
export function useWorlds(): WorldStore {
  const [worlds, setWorlds] = useState<World[]>([])
  const [activeWorldId, setActiveId] = useState<number | null>(() => getActiveWorldId())
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    let lastError: unknown = null
    // WebView2 从其他窗口切回时，IndexedDB 可能短暂处于恢复/锁定状态；
    // 一次读取失败不能当成“没有世界观”，否则会诱导用户新建空世界。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const { worlds: next, active } = await resolveWorldScope()
        setWorlds(next)
        setActiveId(active?.id ?? null)
        setError(null)
        setReady(true)
        setLoading(false)
        return
      } catch (cause) {
        lastError = cause
        if (attempt < 2) {
          await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)))
        }
      }
    }
    console.error('[useWorlds] 世界观加载失败', lastError)
    setError(lastError instanceof Error ? lastError.message : '世界观加载失败')
    setReady(true)
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const handler = (): void => {
      void (async () => {
        const next = await listWorlds()
        setWorlds(next)
        setActiveId(getActiveWorldId())
      })()
    }
    window.addEventListener(WORLDS_CHANGED_EVENT, handler)
    window.addEventListener('oc-world-changed', handler)
    return () => {
      window.removeEventListener(WORLDS_CHANGED_EVENT, handler)
      window.removeEventListener('oc-world-changed', handler)
    }
  }, [])

  const selectWorld = useCallback((id: number): void => {
    setActiveWorldId(id)
    setActiveId(id)
  }, [])

  const create = useCallback(
    async (input: { name: string; description?: string }): Promise<World> => {
      const world = await createWorld(input)
      setWorlds(await listWorlds())
      return world
    },
    [],
  )

  const rename = useCallback(async (id: number, name: string): Promise<void> => {
    await renameWorld(id, name)
    setWorlds(await listWorlds())
  }, [])

  const update = useCallback(
    async (
      id: number,
      patch: Partial<Pick<World, 'name' | 'description' | 'accentColor'>>,
    ): Promise<void> => {
      await updateWorld(id, patch)
      setWorlds(await listWorlds())
    },
    [],
  )

  const remove = useCallback(async (id: number): Promise<void> => {
    await deleteWorld(id)
    setWorlds(await listWorlds())
    setActiveId(getActiveWorldId())
  }, [])

  return {
    worlds,
    activeWorld: worlds.find((world) => world.id === activeWorldId) ?? null,
    activeWorldId,
    ready,
    loading,
    error,
    selectWorld,
    createWorld: create,
    renameWorld: rename,
    updateWorld: update,
    removeWorld: remove,
    refresh: reload,
  }
}
