import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import { loadNodePositions, saveNodePositions } from '../src/features/relations/layout-storage.ts'

const values = new Map()
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
}
beforeEach(() => { values.clear(); globalThis.window = { localStorage: storage } })

test('saving a filtered graph preserves hidden nodes and isolates focus scopes', () => {
  saveNodePositions('main', { a: { x: 100, y: 80 }, b: { x: -40, y: 30 } })
  saveNodePositions('main', { a: { x: 120, y: 90 } })
  saveNodePositions('node:a', { a: { x: 0, y: 0 } })
  assert.deepEqual(loadNodePositions('main'), { a: { x: 120, y: 90 }, b: { x: -40, y: 30 } })
  assert.deepEqual(loadNodePositions('node:a'), { a: { x: 0, y: 0 } })
})

test('legacy main positions are merged on first save; auto-arrange explicitly clears them', () => {
  storage.setItem('oc-relation-node-positions', JSON.stringify({ hidden: { x: 3, y: 4 } }))
  saveNodePositions('main', { visible: { x: 5, y: 6 } })
  assert.equal(loadNodePositions('main').hidden.x, 3)
  saveNodePositions('main', {}, 'replace')
  assert.deepEqual(loadNodePositions('main'), {})
  assert.deepEqual(loadNodePositions('node:missing'), {})
})

test('corrupt and non-finite coordinates do not break loading or saving', () => {
  storage.setItem('oc-relation-node-positions:main', '{broken')
  assert.deepEqual(loadNodePositions('main'), {})
  saveNodePositions('main', { bad: { x: Infinity, y: NaN }, text: { x: '2', y: 1 }, ok: { x: 0, y: -1 } })
  assert.deepEqual(loadNodePositions('main'), { ok: { x: 0, y: -1 } })
  storage.setItem('oc-relation-node-positions:main', '[]')
  assert.deepEqual(loadNodePositions('main'), {})
  globalThis.window = undefined
  assert.deepEqual(loadNodePositions('main'), {})
  assert.doesNotThrow(() => saveNodePositions('main', {}))
})
