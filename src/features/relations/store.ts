'use client'

import { create } from 'zustand'

const EDGE_CONTROLS_KEY = 'oc-editor-relation-edge-controls'
const UI_STATE_KEY = 'oc-editor-relation-ui'

export interface EdgeControls {
  /** 第一个控制点：沿线位置 0..1 */
  u1: number
  /** 第一个控制点：相对连线的法向偏移 */
  v1: number
  /** 第二个控制点：沿线位置 0..1 */
  u2: number
  /** 第二个控制点：相对连线的法向偏移 */
  v2: number
}

interface PersistedUiState {
  showCharacters: boolean
  showEvents: boolean
  showCountries: boolean
  edgeStyle: 'bezier' | 'straight'
}

function loadEdgeControls(): Record<string, EdgeControls> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(EDGE_CONTROLS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, EdgeControls>) : {}
  } catch {
    return {}
  }
}

function saveEdgeControls(controls: Record<string, EdgeControls>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(EDGE_CONTROLS_KEY, JSON.stringify(controls))
  } catch {
    // ignore quota errors
  }
}

/** 关系图的筛选/线型是用户看到的“格式”，必须跨重启保留。 */
function loadUiState(): PersistedUiState {
  const fallback: PersistedUiState = {
    showCharacters: true,
    showEvents: true,
    showCountries: true,
    edgeStyle: 'bezier',
  }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(UI_STATE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PersistedUiState>
    return {
      showCharacters: typeof parsed.showCharacters === 'boolean' ? parsed.showCharacters : true,
      showEvents: typeof parsed.showEvents === 'boolean' ? parsed.showEvents : true,
      showCountries: typeof parsed.showCountries === 'boolean' ? parsed.showCountries : true,
      edgeStyle: parsed.edgeStyle === 'straight' ? 'straight' : 'bezier',
    }
  } catch {
    return fallback
  }
}

function saveUiState(state: PersistedUiState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(UI_STATE_KEY, JSON.stringify(state))
  } catch {
    // ignore quota errors
  }
}

interface RelationUiState extends PersistedUiState {
  edgeControls: Record<string, EdgeControls>
  setEdgeControl: (id: string, controls: EdgeControls) => void
  setShowCharacters: (visible: boolean) => void
  setShowEvents: (visible: boolean) => void
  setShowCountries: (visible: boolean) => void
  setEdgeStyle: (style: 'bezier' | 'straight') => void
}

const initialUi = loadUiState()

function snapshotUi(state: PersistedUiState): PersistedUiState {
  return {
    showCharacters: state.showCharacters,
    showEvents: state.showEvents,
    showCountries: state.showCountries,
    edgeStyle: state.edgeStyle,
  }
}

/**
 * 关系图的跨面板 UI 状态。数据本身仍以 Dexie relations 为唯一真相源；
 * Zustand 只负责筛选/可见性，切换页面后不会丢失。
 */
export const useRelationUiStore = create<RelationUiState>((set) => ({
  ...initialUi,
  edgeControls: loadEdgeControls(),
  setEdgeControl: (id, controls) =>
    set((state) => {
      const edgeControls = { ...state.edgeControls, [id]: controls }
      saveEdgeControls(edgeControls)
      return { edgeControls }
    }),
  setShowCharacters: (showCharacters) =>
    set((state) => {
      saveUiState({ ...snapshotUi(state), showCharacters })
      return { showCharacters }
    }),
  setShowEvents: (showEvents) =>
    set((state) => {
      saveUiState({ ...snapshotUi(state), showEvents })
      return { showEvents }
    }),
  setShowCountries: (showCountries) =>
    set((state) => {
      saveUiState({ ...snapshotUi(state), showCountries })
      return { showCountries }
    }),
  setEdgeStyle: (edgeStyle) =>
    set((state) => {
      saveUiState({ ...snapshotUi(state), edgeStyle })
      return { edgeStyle }
    }),
}))
