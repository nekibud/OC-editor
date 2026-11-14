import assert from 'node:assert/strict'
import test from 'node:test'
import { selectedRelatedKind, replaceRelatedKind, unmatchedEquipmentText } from '../src/features/characters/equipment-links.ts'
import { DEFAULT_GRAPH_VISIBILITY, graphNodeIsVisible } from '../src/features/relations/category-visibility.ts'

test('equipment selectors preserve unrelated people, pets and parallel relationship labels', () => {
  const entries = [{ id: 1, name: '人' }, { id: 2, name: '剑', aliases: ['青剑'], entityKind: 'weapon' }, { id: 3, name: '猫', entityKind: 'pet' }, { id: 4, name: '弓', entityKind: 'weapon' }]
  const links = [{ characterId: 1, name: '人', relation: '朋友' }, { characterId: 2, name: '剑', relation: '持有', relationId: 'one' }, { characterId: 2, name: '剑', relation: '锻造', relationId: 'two' }, { characterId: 3, name: '猫', relation: '伙伴' }]
  const original = JSON.stringify(links)
  assert.deepEqual(selectedRelatedKind(links, entries, 'weapon'), [2])
  assert.deepEqual(replaceRelatedKind(links, entries, 'weapon', [2]).filter(link => link.characterId === 2), links.filter(link => link.characterId === 2))
  const replaced = replaceRelatedKind(links, entries, 'weapon', [4, 4, 3])
  assert.deepEqual(replaced.map(link => link.characterId), [1, 3, 4])
  assert.equal(replaced.at(-1).relation, '持有')
  assert.deepEqual(replaceRelatedKind(links, entries, 'character', []).map(link => link.characterId), [2, 2, 3])
  assert.equal(unmatchedEquipmentText('青剑、旧有描述', entries, [2]), '旧有描述')
  assert.equal(JSON.stringify(links), original)
})

test('fresh graph shows only characters and independently enables equipment and custom sections', () => {
  const enabled = new Set(), presets = { weapon: 'weapons', pet: 'pets' }
  assert.ok(graphNodeIsVisible({ entityType: 'character' }, DEFAULT_GRAPH_VISIBILITY, enabled, presets))
  for (const data of [{ entityType: 'country' }, { entityType: 'event' }, { entityType: 'character', entityKind: 'weapon' }, { entityType: 'character', entityKind: 'pet' }, { entityType: 'custom', customSectionId: 'later-created' }]) assert.equal(graphNodeIsVisible(data, DEFAULT_GRAPH_VISIBILITY, enabled, presets), false)
  enabled.add('weapons')
  assert.ok(graphNodeIsVisible({ entityType: 'character', entityKind: 'weapon' }, { ...DEFAULT_GRAPH_VISIBILITY, showCharacters: false }, enabled, presets))
  assert.equal(graphNodeIsVisible({ entityType: 'character', entityKind: 'pet' }, DEFAULT_GRAPH_VISIBILITY, enabled, presets), false)
  assert.equal(graphNodeIsVisible({ entityType: 'custom', categoryKind: 'country' }, DEFAULT_GRAPH_VISIBILITY, enabled, presets), false)
})
