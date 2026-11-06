import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_RELATION_COLOR,
  resolveRelationColor,
  relationColorAppearance,
} from '../src/features/relations/style.ts'

test('arbitrary six-digit colors are accepted and normalized', () => {
  for (const value of ['#014A7D', '#C9E8A1', '#93A0B7', '#ff007a']) {
    assert.equal(resolveRelationColor(value), value.toUpperCase())
  }
})

test('saved legacy colors remain readable after the palette changes', () => {
  for (const color of ['#B36651', '#C68D44', '#8FA36B', '#5E8B74', '#6A8FA8', '#7C7BA8',
    '#9C6B7D', '#A77B62', '#6E8B8B', '#8B7BA8', '#B08A5A', '#7A7A72']) {
    assert.equal(resolveRelationColor(color), color)
  }
  for (const value of [null, undefined, 'url(example)', {}]) {
    assert.equal(resolveRelationColor(value), DEFAULT_RELATION_COLOR)
  }
})

function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}

test('black and white keep their requested text/line color with readable label backgrounds', () => {
  for (const color of ['#000000', '#FFFFFF']) {
    const appearance = relationColorAppearance(color)
    assert.equal(appearance.color, color)
    assert.ok(appearance.outline)
    const a = luminance(color)
    const b = luminance(appearance.labelBackground)
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5)
  }
  assert.equal(relationColorAppearance('#D84D4D').labelBackground, undefined)
})
