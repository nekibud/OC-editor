import assert from 'node:assert/strict'
import test from 'node:test'
import { trimChapterLeadingBlanks } from '../src/features/novel/import-whitespace.ts'

test('leading EPUB indentation and empty editor paragraphs are removed without touching the remaining source', () => {
  const body = '<p>　　<strong>甲  乙</strong></p>\n<p>　　</p>\n<p>正文</p>\n'
  for (const prefix of ['\n\n    \n      \n        \n          \n', '<p></p>', '<p>\n\n    \n      \n        \n          \n</p>', '<p><strong><span> &nbsp;&#160;&#xA0;&#10;\u200b</span></strong><br/></p>\n', '<br><br/>\n']) {
    assert.equal(trimChapterLeadingBlanks(prefix + body), body)
    assert.equal(trimChapterLeadingBlanks(trimChapterLeadingBlanks(prefix + body)), body)
  }
})

test('leading images, tables, headings, indentation and meaningful symbols remain intact', () => {
  for (const body of ['<div data-type="image-block" src="data:image/png;base64,AAA"></div><p>文</p>', '<p><img src="x"></p>', '<table><tr><td></td></tr></table>', '<h1>小标题</h1><p>文</p>', '<p>　　正文</p><p></p>', '　　正文', '<p>&amp;nbsp;</p>', '<p><span data-text="&gt;">字</span></p>']) assert.equal(trimChapterLeadingBlanks(body), body)
  assert.equal(trimChapterLeadingBlanks('<p></p><p><img src="x"></p>'), '<p><img src="x"></p>')
  assert.equal(trimChapterLeadingBlanks(' \n<p><br/></p>'), '<p></p>')
})
