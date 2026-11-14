import type { Character, CharacterKind, RelatedCharacter } from '@/types'

export function selectedRelatedKind(links: RelatedCharacter[], entries: Character[], kind: CharacterKind): number[] {
  const allowed = new Set(entries.filter(entry => (entry.entityKind ?? 'character') === kind).map(entry => entry.id))
  return [...new Set(links.flatMap(link => link.characterId !== undefined && allowed.has(link.characterId) ? [link.characterId] : []))]
}

/** Replacing one selector must preserve people and equipment chosen in other selectors. */
export function replaceRelatedKind(links: RelatedCharacter[], entries: Character[], kind: CharacterKind, ids: number[]): RelatedCharacter[] {
  const allowed = new Map(entries.filter(entry => (entry.entityKind ?? 'character') === kind && entry.id !== undefined).map(entry => [entry.id!, entry]))
  const selected = [...new Set(ids)].filter(id => allowed.has(id))
  const next = links.filter(link => link.characterId === undefined || !allowed.has(link.characterId))
  for (const id of selected) {
    const existing = links.filter(link => link.characterId === id)
    if (existing.length) next.push(...existing)
    else next.push({ characterId: id, name: allowed.get(id)!.name, relation: kind === 'weapon' ? '持有' : kind === 'pet' ? '伙伴' : '' })
  }
  return next
}

export function unmatchedEquipmentText(text: string, entries: Character[], ids: number[]): string {
  const selected = entries.filter(entry => ids.includes(entry.id!))
  const names = new Set(selected.flatMap(entry => [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]))
  return text.split(/[、,，;；\r\n]+/).map(value => value.trim()).filter(value => value && !names.has(value)).join('、')
}
