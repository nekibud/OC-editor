export const DEFAULT_GRAPH_VISIBILITY = { showCharacters: true, showEvents: false, showCountries: false } as const

interface NodeCategory {
  entityType?: unknown
  entityKind?: unknown
  customSectionId?: unknown
  categoryKind?: unknown
}

export function graphNodeIsVisible(
  data: NodeCategory,
  flags: { showCharacters: boolean; showEvents: boolean; showCountries: boolean },
  enabledSections: ReadonlySet<string>,
  presets: { weapon?: string; pet?: string },
): boolean {
  if (data.entityType === 'character') {
    if (data.entityKind === 'weapon' || data.entityKind === 'pet') {
      const section = presets[data.entityKind]
      return Boolean(section && enabledSections.has(section))
    }
    return flags.showCharacters
  }
  const category = data.entityType === 'custom' ? data.categoryKind : data.entityType
  if (category === 'character') return flags.showCharacters
  if (category === 'event') return flags.showEvents
  if (category === 'country') return flags.showCountries
  if (typeof data.customSectionId === 'string') return enabledSections.has(data.customSectionId)
  return true
}
