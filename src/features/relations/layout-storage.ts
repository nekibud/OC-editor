export interface NodePosition { x: number; y: number }
export type NodePositions = Record<string, NodePosition>

const NODE_POSITIONS_KEY = 'oc-relation-node-positions'

function validPositions(value: unknown): NodePositions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, point]) =>
    point && typeof point === 'object' &&
    typeof point.x === 'number' && Number.isFinite(point.x) &&
    typeof point.y === 'number' && Number.isFinite(point.y),
  ))
}

export function loadNodePositions(scope: string): NodePositions {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(`${NODE_POSITIONS_KEY}:${scope}`)
      ?? (scope === 'main' ? window.localStorage.getItem(NODE_POSITIONS_KEY) : null)
    return raw ? validPositions(JSON.parse(raw)) : {}
  } catch { return {} }
}

/** 筛选后的可见节点只更新自己的坐标，不抹掉其他节点；自动整理才清空布局。 */
export function saveNodePositions(
  scope: string,
  positions: NodePositions,
  mode: 'merge' | 'replace' = 'merge',
): void {
  if (typeof window === 'undefined') return
  try {
    const previous = mode === 'merge' ? loadNodePositions(scope) : {}
    window.localStorage.setItem(`${NODE_POSITIONS_KEY}:${scope}`, JSON.stringify({
      ...previous,
      ...validPositions(positions),
    }))
  } catch { /* quota exceeded, ignore */ }
}
