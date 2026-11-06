import assert from 'node:assert/strict'
import test from 'node:test'
import { migrateLegacyRelationStyles } from '../src/features/relations/legacy-style-migration.ts'

test('legacy custom colors and arrows migrate once and never override later edits', async () => {
  const values = new Map([
    ['oc-studio-relation-edge-colors', JSON.stringify({ one: '#abcdef', later: '#123456', invalid: 'red' })],
    ['oc-studio-relation-edge-arrows', JSON.stringify({ one: 'both', invalid: 'invalid' })],
  ])
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const rows = new Map([['one', {}]])
  const apply = async (id, style) => { if (!rows.has(id)) return false; rows.set(id, { ...rows.get(id), ...style }); return true }
  assert.equal(await migrateLegacyRelationStyles(storage, apply), 1)
  assert.deepEqual(rows.get('one'), { color: '#ABCDEF', arrow: 'both' })
  rows.set('one', { color: '#FFFFFF', arrow: 'none' })
  rows.set('later', {})
  assert.equal(await migrateLegacyRelationStyles(storage, apply), 1)
  assert.deepEqual(rows.get('one'), { color: '#FFFFFF', arrow: 'none' })
  assert.deepEqual(rows.get('later'), { color: '#123456' })
  assert.equal(await migrateLegacyRelationStyles(storage, apply), 0)
  assert.ok(values.has('oc-studio-relation-edge-colors'))
})

test('invalid legacy storage is ignored and failed writes remain retryable', async () => {
  const values = new Map([['oc-studio-relation-edge-colors', '{bad']])
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  assert.equal(await migrateLegacyRelationStyles(storage, async () => { throw Error('should not run') }), 0)
  values.set('oc-studio-relation-edge-colors', '{"one":"#123456"}')
  await assert.rejects(migrateLegacyRelationStyles(storage, async () => { throw Error('disk full') }), /disk full/)
  assert.ok(!values.has('oc-studio-relation-style-migration-v1'))
  assert.equal(await migrateLegacyRelationStyles(storage, async () => true), 1)
})
