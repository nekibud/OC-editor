import assert from 'node:assert/strict'
import test from 'node:test'
import { zipFiles, readBookArchive } from '../src/features/novel/archive.ts'

test('book ZIP round trip keeps entry order and exact UTF-8 content', async () => {
  const blob = zipFiles([{ name: 'mimetype', data: new TextEncoder().encode('application/epub+zip') }, { name: '正文.xhtml', data: new TextEncoder().encode('　　甲  乙\n\n丙') }], 'application/epub+zip')
  const files = await readBookArchive(await blob.arrayBuffer())
  assert.deepEqual([...files.keys()], ['mimetype', '正文.xhtml'])
  assert.equal(new TextDecoder().decode(files.get('正文.xhtml')), '　　甲  乙\n\n丙')
  assert.equal(new DataView(await blob.arrayBuffer()).getUint16(8, true), 0)
})

test('book archives reject corrupt data, password protection and excessive unpacked sizes', async () => {
  const blob = zipFiles([{ name: 'body.xml', data: new TextEncoder().encode('正文') }], 'application/zip')
  const corrupt = new Uint8Array(await blob.arrayBuffer()); corrupt[38] ^= 1
  await assert.rejects(readBookArchive(corrupt.buffer), /校验失败/)
  const encrypted = await blob.arrayBuffer(), flags = new DataView(encrypted)
  let central = 0; while (flags.getUint32(central, true) !== 0x02014b50) central++
  flags.setUint16(central + 8, 1, true)
  await assert.rejects(readBookArchive(encrypted), /加密/)
  const huge = await blob.arrayBuffer(); new DataView(huge).setUint32(central + 24, 200 * 1024 * 1024, true)
  await assert.rejects(readBookArchive(huge), /过大/)
  await assert.rejects(readBookArchive(new Uint8Array(30).buffer), /有效/)
})
