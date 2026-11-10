/** Blank markup is removed only at the chapter boundary, never between paragraphs. */
function blankText(text: string): boolean {
  return !text.replace(/&nbsp;|&#(?:\d+|x[\da-f]+);/gi, entity => {
    if (entity.toLowerCase() === '&nbsp;') return '\u00a0'
    const hex = entity[2].toLowerCase() === 'x'
    const code = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10)
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  }).replace(/[\s\u200b\ufeff]/g, '')
}

const TAG_ATTRIBUTES = String.raw`(?:[^<>"']|"[^"]*"|'[^']*')*`
const EMPTY_PARAGRAPH = new RegExp(`^<p\\b${TAG_ATTRIBUTES}>([\\s\\S]*?)<\\/p\\s*>`, 'i')
const INLINE_MARKS = new RegExp(`<\\/?(?:strong|em|u|s|span|b|i|del|strike)\\b${TAG_ATTRIBUTES}>`, 'gi')
const BREAKS = new RegExp(`<br\\b${TAG_ATTRIBUTES}>`, 'gi')

export function trimChapterLeadingBlanks(html: string): string {
  let rest = html
  while (rest) {
    const comment = /^<!--[\s\S]*?-->/.exec(rest)
    if (comment) { rest = rest.slice(comment[0].length); continue }
    const text = /^[^<]+/.exec(rest)
    if (text && blankText(text[0])) { rest = rest.slice(text[0].length); continue }
    const paragraph = EMPTY_PARAGRAPH.exec(rest)
    if (paragraph && blankText(paragraph[1].replace(INLINE_MARKS, '').replace(BREAKS, ''))) { rest = rest.slice(paragraph[0].length); continue }
    const lineBreak = new RegExp(`^<br\\b${TAG_ATTRIBUTES}>`, 'i').exec(rest)
    if (lineBreak) { rest = rest.slice(lineBreak[0].length); continue }
    break
  }
  return rest || '<p></p>'
}
