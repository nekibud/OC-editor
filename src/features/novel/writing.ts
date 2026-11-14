export interface WritingNode {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: WritingNode[]
}

export function novelFontCss(family?: string): string {
  return family?.trim() ? `${JSON.stringify(family.trim())}, serif` : '"Noto Serif SC", "Songti SC", "SimSun", serif'
}

/** 只整理正文段落；保留内联格式、标题、图片、列表等结构。 */
export function formatNovelDocument(document: WritingNode): WritingNode {
  const copy = JSON.parse(JSON.stringify(document)) as WritingNode
  const blocks: WritingNode[] = []
  for (const block of copy.content ?? []) {
    if (block.type !== 'paragraph') { blocks.push(block); continue }
    const lines: WritingNode[][] = [[]]
    for (const inline of block.content ?? []) {
      if (inline.type === 'hardBreak') lines.push([])
      else lines[lines.length - 1].push(inline)
    }
    for (const line of lines) {
      while (line.length && line[0].type === 'text') {
        line[0].text = (line[0].text ?? '').replace(/^[\s\u3000]+/u, '')
        if (line[0].text) break
        line.shift()
      }
      if (!line.length) continue
      blocks.push({ ...block, content: [{ type: 'text', text: '\u3000\u3000' }, ...line] })
    }
  }
  const spaced: WritingNode[] = []
  for (const block of blocks) {
    if (block.type === 'paragraph' && spaced[spaced.length - 1]?.type === 'paragraph') spaced.push({ type: 'paragraph' })
    spaced.push(block)
  }
  return { ...copy, content: spaced.length ? spaced : [{ type: 'paragraph' }] }
}
