import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeHexColor, getColorMemory, setColorMemorySlot, COLOR_MEMORY_KEY, subscribeColorMemory } from '../src/lib/color-memory.ts'

test('arbitrary HEX colors normalize without accepting CSS expressions', () => {
  assert.equal(normalizeHexColor('#a34f87'), '#A34F87')
  assert.equal(normalizeHexColor('#3ad'), '#33AADD')
  for (const value of ['', '#12', 'red', 'url(test)', '#12345678', null]) assert.equal(normalizeHexColor(value), undefined)
})

test('ten shared slots retain arbitrary colors, allow replacement and clearing, and notify subscribers', () => {
  const values = new Map(), events = new EventTarget()
  globalThis.window = {
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
  }
  let notices = 0
  const unsubscribe = subscribeColorMemory(() => notices++)
  assert.equal(getColorMemory().length, 10)
  for (let index = 0; index < 10; index++) setColorMemorySlot(index, '#' + (0x103050 + index * 1024).toString(16))
  assert.equal(getColorMemory().filter(Boolean).length, 10)
  assert.equal(getColorMemory(), getColorMemory())
  setColorMemorySlot(9, '#abcdef')
  assert.equal(JSON.parse(values.get(COLOR_MEMORY_KEY))[9], '#ABCDEF')
  setColorMemorySlot(9, null)
  assert.equal(getColorMemory()[9], null)
  assert.equal(notices, 12)
  assert.throws(() => setColorMemorySlot(10, '#112233'))
  assert.throws(() => setColorMemorySlot(-1, '#112233'))
  values.set(COLOR_MEMORY_KEY, '{broken')
  assert.deepEqual(getColorMemory(), Array(10).fill(null))
  unsubscribe()
})
