import assert from 'node:assert/strict'
import test from 'node:test'
import { countryColor, characterCountry, isCountryMembershipEdge } from '../src/features/countries/colors.ts'

const countries = [
  { id: 1, name: '天界', accentColor: '#946AC3', deleted: false },
  { id: 2, name: '妖界', accentColor: '#286449', deleted: false },
]

test('arbitrary country colors and saved legacy colors remain valid', () => {
  for (const value of ['#014A7D', '#C9E8A1', '#93A0B7', '#ff007a', '#B36651']) {
    assert.equal(countryColor({ accentColor: value }), value)
  }
  assert.equal(countryColor({ accentColor: 'url(invalid)' }), '#8A8A8A')
})

test('roles sharing their primary country use the same color and follow later country edits', () => {
  const roles = [{ countryId: 1, nationalityLegacy: '' }, { countryId: 1, nationalityLegacy: '旧名称' }]
  for (const role of roles) assert.equal(countryColor(characterCountry(role, countries)), '#946AC3')
  const updated = countries.map((country) => country.id === 1 ? { ...country, accentColor: '#305DA8' } : country)
  for (const role of roles) assert.equal(countryColor(characterCountry(role, updated)), '#305DA8')
  assert.equal(countries[0].accentColor, '#946AC3')
})

test('country ID wins over a legacy name; legacy names only match a unique active country', () => {
  assert.equal(characterCountry({ countryId: 2, nationalityLegacy: '天界' }, countries).id, 2)
  assert.equal(characterCountry({ nationalityLegacy: ' 天界 ' }, countries).id, 1)
  assert.equal(characterCountry({ nationalityLegacy: '天界' }, [...countries, { id: 3, name: '天界' }]), undefined)
  assert.equal(characterCountry({ countryId: 1, nationalityLegacy: '' }, [{ ...countries[0], deleted: true }]), undefined)
  assert.equal(characterCountry({ nationalityLegacy: '' }, countries), undefined)
})

test('only country membership is hidden; character, event and country relations remain visible', () => {
  assert.equal(isCountryMembershipEdge({ kind: 'membership' }), true)
  for (const kind of ['character', 'event-country', 'nation', 'custom']) {
    assert.equal(isCountryMembershipEdge({ kind }), false)
  }
  assert.equal(isCountryMembershipEdge(undefined), false)
})
