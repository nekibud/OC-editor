import type { RelationArrow } from './style'

export interface LegacyRelationStyle { color?: string; arrow?: RelationArrow }
const MIGRATION_KEY = 'oc-studio-relation-style-migration-v1'

function readObject(storage: Pick<Storage, 'getItem'>, key: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch { return {} }
}

/** Import old custom-build preferences once per relation, including scoped edges created later. */
export async function migrateLegacyRelationStyles(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  apply: (id: string, style: LegacyRelationStyle) => Promise<boolean>,
): Promise<number> {
  const colors = readObject(storage, 'oc-studio-relation-edge-colors')
  const arrows = readObject(storage, 'oc-studio-relation-edge-arrows')
  const done = readObject(storage, MIGRATION_KEY)
  let changed = 0
  for (const id of new Set([...Object.keys(colors), ...Object.keys(arrows)])) {
    if (done[id] === true) continue
    const style: LegacyRelationStyle = {}
    const color = colors[id], arrow = arrows[id]
    if (typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)) style.color = color.toUpperCase()
    if (arrow === 'none' || arrow === 'forward' || arrow === 'reverse' || arrow === 'both') style.arrow = arrow
    if (!style.color && !style.arrow) continue
    if (await apply(id, style)) { done[id] = true; changed++ }
  }
  if (changed) storage.setItem(MIGRATION_KEY, JSON.stringify(done))
  return changed
}
