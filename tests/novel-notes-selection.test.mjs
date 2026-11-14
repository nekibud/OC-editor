import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { selectNovelChapters } from '../src/features/novel/chapter-selection.ts'
registerHooks({ resolve(specifier, context, next) { try { return next(specifier, context) } catch (error) { if (specifier.startsWith('.') && !specifier.endsWith('.ts')) return next(specifier + '.ts', context); throw error } } })
const { novelNotes, noteHtml, inspirationNote, detachInspiration } = await import('../src/features/novel/notes.ts')
const { memoText } = await import('../src/features/inspirations/types.ts')

test('chapter selection keeps book order, metadata and original chapters without mutation', () => {
  const novel = { title: '书', author: '作者', chapters: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
  assert.equal(selectNovelChapters(novel, null), novel)
  assert.deepEqual(selectNovelChapters(novel, new Set(['c', 'a'])).chapters, [novel.chapters[0], novel.chapters[2]])
  assert.equal(selectNovelChapters(novel, new Set()).chapters.length, 0)
  assert.equal(selectNovelChapters(novel, new Set(['b'])).author, '作者')
  assert.equal(novel.chapters.length, 3)
})

test('old plaintext notes remain literal text and existing note arrays take precedence', () => {
  const notes = novelNotes({ notes: '<b>原文</b> &\n第二行' })
  assert.equal(noteHtml(notes[0]), '<p>&lt;b&gt;原文&lt;/b&gt; &amp;</p><p>第二行</p>')
  assert.equal(memoText(noteHtml(notes[0])), '<b>原文</b> & 第二行')
  assert.equal(memoText('<p>&amp;lt; &lt; &quot;</p>'), '&lt; < "')
  assert.deepEqual(novelNotes({ notes: '旧数据', noteItems: [] }), [])
})

test('deleting a linked inspiration preserves its latest text, title and image as independent notes', () => {
  const inspiration = { id: 'i', title: '想法', content: '<p>原文</p><img src="data:image/png;base64,AAA">' }
  const note = inspirationNote(inspiration), unrelated = { id: 'plain', text: '不变' }
  const result = detachInspiration([note, unrelated], { ...inspiration, title: '最新', content: '<p>最新文字</p><img src="data:image/png;base64,AAA">' })
  assert.equal(result[0].inspirationId, undefined)
  assert.equal(result[0].title, '最新')
  assert.ok(result[0].content.includes('data:image/png'))
  assert.equal(result[0].text, '最新文字')
  assert.equal(result[1], unrelated)
  assert.equal(note.inspirationId, 'i')
})
