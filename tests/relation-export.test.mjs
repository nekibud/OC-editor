import assert from 'node:assert/strict'
import test from 'node:test'
import { exportEdgeGeometry, graphJpegPdf, GRAPH_EXPORT_BACKGROUNDS } from '../src/features/relations/export-layout.ts'

test('straight exports ignore saved bows and place labels and arrows on the straight segment', () => {
  for (const cubic of [true, false]) {
    const edge = exportEdgeGeometry({ x: -10, y: 20 }, { x: 90, y: 80 }, { style: 'straight', cubic, control: { u1: .2, v1: 700, u2: .8, v2: -700 }, offset: 400, parallelCount: 3 })
    assert.equal(edge.path, 'M -10 20 L 90 80')
    assert.deepEqual(edge.label, { x: 40, y: 50 })
    assert.deepEqual(edge.endFrom, { x: -10, y: 20 })
    assert.equal(edge.bounds.length, 2)
  }
})

test('curve exports preserve edited cubic controls, custom quadratic offsets and parallel lanes', () => {
  const cubic = exportEdgeGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, { style: 'bezier', cubic: true, control: { u1: .2, v1: -80, u2: .8, v2: 200 } })
  assert.equal(cubic.path, 'M 0 0 C 20 -80 80 200 100 0')
  assert.deepEqual(cubic.label, { x: 50, y: 45 })
  assert.deepEqual(cubic.endFrom, { x: 80, y: 200 })
  const quadratic = exportEdgeGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, { style: 'bezier', cubic: false, offset: -120, parallelCount: 2, parallelIndex: 1 })
  assert.equal(quadratic.path, 'M 0 0 Q 50 -102 100 0')
  assert.deepEqual(quadratic.label, { x: 50, y: -51 })
})

test('PDF byte offsets survive binary JPEG data and huge graphs fit the PDF page limit', async () => {
  const jpeg = new Uint8Array([255, 216, 128, 0, 10, 255, 217])
  const blob = graphJpegPdf(jpeg, 100, 50, 200_000, 100_000), bytes = new Uint8Array(await blob.arrayBuffer()), ascii = Buffer.from(bytes).toString('latin1')
  assert.equal(blob.type, 'application/pdf')
  assert.ok(ascii.startsWith('%PDF-1.4'))
  const box = ascii.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)
  assert.ok(Math.abs(Number(box[1]) - 14400) < .001)
  assert.ok(Math.abs(Number(box[2]) - 7200) < .001)
  assert.ok(ascii.includes('/Count 1'))
  const offset = Number(ascii.match(/startxref\n(\d+)/)[1])
  assert.equal(ascii.slice(offset, offset + 4), 'xref')
  const entries = ascii.slice(offset).split('\n').slice(3, 8)
  for (let index = 0; index < entries.length; index++) assert.ok(ascii.slice(Number(entries[index].slice(0, 10))).startsWith(`${index + 1} 0 obj`))
  assert.equal(GRAPH_EXPORT_BACKGROUNDS.length, 4)
})
