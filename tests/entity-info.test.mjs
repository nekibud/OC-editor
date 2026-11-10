import assert from 'node:assert/strict'
import test from 'node:test'
import { getEntityInfoFields, readEntityInfo } from '../src/features/characters/entity-info.ts'

test('weapon and pet presets differ from character traits and preserve existing values', () => {
  assert.equal(getEntityInfoFields('character').length, 0)
  assert.ok(getEntityInfoFields('weapon').some(field => field.label === '材质'))
  assert.ok(getEntityInfoFields('pet').some(field => field.label === '饮食偏好'))
  for (const kind of ['weapon', 'pet']) assert.ok(!getEntityInfoFields(kind).some(field => /性取向|血型|职业/.test(field.label)))
  const pet = { entityKind: 'pet', race: '猫科', gender: '雌', ability: '夜视', entityInfo: { breed: '灵猫', gender: '', custom: '保留' } }
  const before = JSON.stringify(pet), result = readEntityInfo(pet)
  assert.equal(result.species, '猫科')
  assert.equal(result.gender, '')
  assert.equal(result.ability, '夜视')
  assert.equal(result.breed, '灵猫')
  assert.equal(result.custom, '保留')
  assert.equal(JSON.stringify(pet), before)
  const weapon = readEntityInfo({ entityKind: 'weapon', race: '原先的种族内容', weight: '二斤', entityInfo: { material: '玄铁' } })
  assert.equal(weapon.weight, '二斤')
  assert.equal(weapon.material, '玄铁')
  assert.equal(weapon.type, '')
})
