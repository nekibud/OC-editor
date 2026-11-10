import assert from 'node:assert/strict'
import test from 'node:test'
import { formatNovelDocument, novelFontCss } from '../src/features/novel/writing.ts'

test('formatting indents paragraphs, keeps one blank paragraph and preserves marks and other blocks', () => {
  const bold = { type: 'text', text: '第一段', marks: [{ type: 'bold' }] }
  const image = { type: 'imageBlock', attrs: { src: 'data:image/png;base64,test' } }
  const heading = { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] }
  const input = { type: 'doc', content: [heading, { type: 'paragraph', content: [{ type: 'text', text: '   ' }, bold] }, { type: 'paragraph' }, { type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: '　 第二段' }] }, image] }
  const before = JSON.stringify(input)
  const result = formatNovelDocument(input)
  assert.deepEqual(result.content[0], heading)
  assert.deepEqual(result.content[1].content, [{ type: 'text', text: '　　' }, bold])
  assert.deepEqual(result.content[2], { type: 'paragraph' })
  assert.equal(result.content[3].content.map(node => node.text).join(''), '　　第二段')
  assert.deepEqual(result.content[4], image)
  assert.equal(JSON.stringify(input), before)
  assert.deepEqual(formatNovelDocument(result), result)
})

test('hard line breaks become paragraphs, blank documents remain editable and font names stay quoted', () => {
  const result = formatNovelDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲' }, { type: 'hardBreak' }, { type: 'text', text: '乙', marks: [{ type: 'italic' }] }] }] })
  assert.equal(result.content.length, 3)
  assert.equal(result.content[2].content[1].marks[0].type, 'italic')
  assert.deepEqual(formatNovelDocument({ type: 'doc', content: [] }).content, [{ type: 'paragraph' }])
  assert.equal(novelFontCss('Microsoft YaHei'), '"Microsoft YaHei", serif')
  assert.equal(novelFontCss('A" B'), '"A\\" B", serif')
})
