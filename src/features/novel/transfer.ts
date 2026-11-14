'use client'

import { getImageUrl } from '@/lib/image-service'
import { zipFiles, readBookArchive } from './archive'
import { makeChapter, type Novel, type NovelChapter } from './types'
import { novelFontCss } from './writing'
import { trimChapterLeadingBlanks } from './import-whitespace'

export type ImportedNovel = Omit<Novel, 'id' | 'createdAt' | 'updatedAt'>
const encoder = new TextEncoder()
export const escapeBookXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const xml = (text: string): Document => {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('文档内容损坏，无法解析。')
  return doc
}
const elements = (node: Document | Element, name: string): Element[] => Array.from(node.getElementsByTagNameNS('*', name))
const first = (node: Document | Element, name: string): Element | undefined => elements(node, name)[0]
const attr = (node: Element | undefined, name: string): string => node ? Array.from(node.attributes).find(a => a.localName === name)?.value ?? '' : ''
const textFile = (files: Map<string, Uint8Array>, name: string): string => {
  const bytes = files.get(name)
  if (!bytes) throw new Error(`文档缺少文件：${name}`)
  return new TextDecoder().decode(bytes)
}
function bookPath(base: string, href: string): string {
  const url = new URL(href, 'https://book.invalid/' + base)
  if (url.origin !== 'https://book.invalid') return ''
  return decodeURIComponent(url.pathname.slice(1))
}
function imageData(bytes: Uint8Array, mime: string): string {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(mime)) throw new Error('图片格式暂不支持。')
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
  return `data:${mime};base64,${btoa(parts.join(''))}`
}
const imageMime = (name: string): string => /\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.gif$/i.test(name) ? 'image/gif' : /\.webp$/i.test(name) ? 'image/webp' : 'image/png'

/** Only editor-supported, non-executable markup crosses an import boundary. */
function cleanBookNode(node: Node, resolveImage: (src: string) => string = () => ''): string {
  if (node.nodeType === 3) {
    const value = node.textContent ?? '', parent = node.parentElement
    // EPUB indentation between block elements is source formatting, not body text.
    // Keep whitespace within paragraphs and between inline marks (e.g. two spaces).
    if (!value.trim() && parent && /^(body|div|section|article|main|blockquote|ul|ol)$/i.test(parent.localName)) {
      const block = (sibling: ChildNode | null): boolean => sibling?.nodeType === 1 && /^(p|h[1-6]|div|section|article|main|blockquote|ul|ol|li|hr)$/i.test((sibling as Element).localName)
      if (!node.previousSibling || !node.nextSibling || block(node.previousSibling) || block(node.nextSibling)) return ''
    }
    return escapeBookXml(value)
  }
  if (node.nodeType !== 1) return ''
  const el = node as Element, tag = el.localName.toLowerCase()
  if (['script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'audio', 'video'].includes(tag)) return ''
  if (tag === 'img' || el.getAttribute('data-type') === 'image-block') {
    const src = resolveImage(el.getAttribute('src') ?? '')
    return src ? `<div data-type="image-block" src="${escapeBookXml(src)}"></div>` : ''
  }
  const children = Array.from(el.childNodes).map(child => cleanBookNode(child, resolveImage)).join('')
  if (tag === 'br') return '<br/>'
  const mapped = ({ b: 'strong', i: 'em', del: 's', strike: 's' } as Record<string, string>)[tag] ?? tag
  let content = children
  const style = el.getAttribute('style') ?? ''
  if (!['strong', 'em', 'u', 's'].includes(mapped)) {
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) content = `<strong>${content}</strong>`
    if (/font-style\s*:\s*italic/i.test(style)) content = `<em>${content}</em>`
    if (/text-decoration[^:]*\s*:[^;]*underline/i.test(style)) content = `<u>${content}</u>`
    if (/text-decoration[^:]*\s*:[^;]*line-through/i.test(style)) content = `<s>${content}</s>`
  }
  if (['p', 'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'strong', 'em', 'u', 's'].includes(mapped)) return `<${mapped}>${content}</${mapped}>`
  return content
}

function chapter(title: string, content: string): NovelChapter {
  // Image blocks inside source paragraphs must become valid sibling blocks first;
  // otherwise the editor's HTML parser can manufacture a new empty first paragraph.
  const template = document.createElement('template')
  template.innerHTML = content
  return { ...makeChapter(title), content: trimChapterLeadingBlanks(template.innerHTML) }
}
const isChapterTitle = (text: string): boolean => !/^(?:　| {2,}|\t)/.test(text) && /^(?:第[零〇一二三四五六七八九十百千万两\d]+[章节卷回部篇]|(?:序章|序言|楔子|引子|尾声|后记|番外)(?:\s|[：:、.．]|$)|chapter\s+\d+\b)/i.test(text.trim()) && text.trim().length <= 100

export function importNovelText(text: string, title: string): ImportedNovel {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  let author = ''
  if (lines[0]?.trim() === title) { lines.shift(); if (/^作者[：:]/.test(lines[0] ?? '')) author = lines.shift()!.replace(/^作者[：:]\s*/, '') }
  const chapters: NovelChapter[] = []; let name = '正文', body: string[] = []
  const push = (): void => { if (body.some(line => line.trim()) || name !== '正文') chapters.push(chapter(name, body.map(line => `<p>${escapeBookXml(line)}</p>`).join(''))); body = [] }
  for (const line of lines) { if (isChapterTitle(line)) { push(); name = line.trim() } else body.push(line) }
  push()
  return { title, author, synopsis: '', chapters: chapters.length ? chapters : [chapter('正文', '<p></p>')] }
}

export function novelPlainText(novel: Novel): string {
  const read = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? ''
    if (node.nodeType !== 1) return ''
    const el = node as Element, tag = el.localName.toLowerCase()
    if (['img', 'script', 'style'].includes(tag) || el.getAttribute('data-type') === 'image-block') return ''
    if (tag === 'br') return '\n'
    const value = Array.from(el.childNodes).map(read).join('')
    return value + (/^(p|h[1-6]|li|blockquote)$/.test(tag) ? '\n' : '')
  }
  return `${novel.title}\n${novel.author ? `作者：${novel.author}\n` : ''}\n` + novel.chapters.map(ch => {
    const doc = new DOMParser().parseFromString(ch.content, 'text/html')
    return `${ch.title}\n${Array.from(doc.body.childNodes).map(read).join('')}`
  }).join('\n\n')
}

export function downloadBook(blob: Blob, title: string, extension: string): void {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = `${(title || '小说').replace(/[\\/:*?"<>|]/g, '-')}.${extension}`
  document.body.appendChild(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}
export function downloadNovelTxt(novel: Novel): void {
  downloadBook(new Blob(['\uFEFF', novelPlainText(novel).replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' }), novel.title, 'txt')
}

export async function buildNovelEpub(novel: Novel): Promise<Blob> {
  const files: Array<{ name: string; data: Uint8Array }> = [], manifest: string[] = [], spine: string[] = [], links: string[] = []
  const add = (name: string, value: string): void => { files.push({ name, data: encoder.encode(value) }) }
  const images = new Map<string, string>()
  const addImage = async (src: string): Promise<string> => {
    if (images.has(src)) return images.get(src)!
    const response = await fetch(getImageUrl(src, 'avatar'))
    if (!response.ok) throw new Error('有图片无法读取，请重新添加后导出。')
    const blob = await response.blob()
    if (!/^image\/(png|jpeg|gif|webp)$/.test(blob.type)) throw new Error('EPUB 插图支持 PNG、JPEG、GIF 和 WebP，请先转换此图片。')
    const id = `image${images.size + 1}`, name = `images/${id}.${blob.type.split('/')[1]}`
    files.push({ name: `EPUB/${name}`, data: new Uint8Array(await blob.arrayBuffer()) })
    manifest.push(`<item id="${id}" href="${name}" media-type="${blob.type}"${src === novel.coverUrl ? ' properties="cover-image"' : ''}/>`)
    images.set(src, name); return name
  }
  const xhtml = (title: string, body: string): string => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN"><head><title>${escapeBookXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`
  // OCF requires the first ZIP entry to be uncompressed and exactly this value.
  add('mimetype', 'application/epub+zip')
  add('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  let cover = ''
  if (novel.coverUrl) cover = `<p><img src="${await addImage(novel.coverUrl)}" alt="封面"/></p>`
  add('EPUB/title.xhtml', xhtml(novel.title, `${cover}<h1>${escapeBookXml(novel.title)}</h1>${novel.author ? `<p>作者：${escapeBookXml(novel.author)}</p>` : ''}${novel.synopsis ? `<p>${escapeBookXml(novel.synopsis).replace(/\n/g, '<br/>')}</p>` : ''}`))
  manifest.push('<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>'); spine.push('<itemref idref="title"/>')
  for (const [index, ch] of novel.chapters.entries()) {
    const doc = new DOMParser().parseFromString(ch.content, 'text/html')
    for (const image of Array.from(doc.querySelectorAll('img, [data-type="image-block"]'))) {
      const src = image.getAttribute('src')
      if (src) await addImage(src)
    }
    let content = Array.from(doc.body.childNodes).map(node => cleanBookNode(node, src => images.get(src) ?? '')).join('')
    // The editor stores image blocks as divs; EPUB uses real image elements.
    content = content.replace(/<div data-type="image-block" src="([^"]+)"><\/div>/g, '<p><img src="$1" alt="插图"/></p>')
    const name = `chapter-${index + 1}.xhtml`, id = `chapter-${index + 1}`
    add(`EPUB/${name}`, xhtml(ch.title, `<section class="chapter"><h1>${escapeBookXml(ch.title)}</h1>${content}</section>`))
    manifest.push(`<item id="${id}" href="${name}" media-type="application/xhtml+xml"/>`); spine.push(`<itemref idref="${id}"/>`)
    links.push(`<li><a href="${name}">${escapeBookXml(ch.title)}</a></li>`)
  }
  add('EPUB/style.css', `body{font-family:${novelFontCss(novel.fontFamily)};font-size:1em;line-height:2;color:#3b3227;}p{margin:0;min-height:2em;white-space:pre-wrap;}h1,h2,h3{font-family:inherit;line-height:1.4;}h1{font-size:1.5em;}h2{font-size:1.25em;}h3{font-size:1.05em;}img{max-width:100%;height:auto;}strong,b{font-weight:700;}em,i{font-style:italic;}u{text-decoration:underline;}s,del{text-decoration:line-through;}.chapter{break-before:page;page-break-before:always;}blockquote{margin:1em 2em;}`)
  add('EPUB/nav.xhtml', xhtml('目录', `<nav epub:type="toc" id="toc"><h1>目录</h1><ol>${links.join('')}</ol></nav>`))
  manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '<item id="css" href="style.css" media-type="text/css"/>')
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  add('EPUB/package.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:${crypto.randomUUID()}</dc:identifier><dc:title>${escapeBookXml(novel.title)}</dc:title><dc:language>zh-CN</dc:language>${novel.author ? `<dc:creator>${escapeBookXml(novel.author)}</dc:creator>` : ''}<dc:description>${escapeBookXml(novel.synopsis)}</dc:description><meta property="dcterms:modified">${modified}</meta></metadata><manifest>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`)
  return zipFiles(files, 'application/epub+zip')
}

async function readEpub(files: Map<string, Uint8Array>, fallback: string): Promise<ImportedNovel> {
  if (files.has('META-INF/encryption.xml')) {
    const encrypted = xml(textFile(files, 'META-INF/encryption.xml'))
    if (elements(encrypted, 'EncryptedData').some(el => !/idpf.org\/2008\/embedding|ns.adobe.com\/pdf\/enc#RC/.test(attr(first(el, 'EncryptionMethod'), 'Algorithm')))) throw new Error('暂不支持加密的 EPUB。')
  }
  const container = xml(textFile(files, 'META-INF/container.xml')), root = attr(first(container, 'rootfile'), 'full-path')
  const opf = xml(textFile(files, root)), items = elements(opf, 'item')
  const title = first(opf, 'title')?.textContent || fallback, author = first(opf, 'creator')?.textContent || '', synopsis = first(opf, 'description')?.textContent || ''
  const chapters: NovelChapter[] = []; let coverUrl = '', fontFamily = ''
  const image = (base: string, src: string): string => {
    const path = bookPath(base, src), bytes = files.get(path)
    return bytes && /\.(png|jpe?g|gif|webp)$/i.test(path) ? imageData(bytes, imageMime(path)) : ''
  }
  const coverId = attr(elements(opf, 'meta').find(el => attr(el, 'name') === 'cover'), 'content')
  const cover = items.find(el => attr(el, 'properties').split(/\s+/).includes('cover-image') || attr(el, 'id') === coverId)
  if (cover) coverUrl = image(root, attr(cover, 'href'))
  for (const item of items.filter(el => attr(el, 'media-type') === 'text/css')) {
    const path = bookPath(root, attr(item, 'href')); if (!files.has(path)) continue
    const match = /(?:body|html)\s*\{[^}]*font-family\s*:\s*([^;}]+)/i.exec(textFile(files, path))
    if (match) fontFamily = match[1].split(',')[0].trim().replace(/^['"]|['"]$/g, '')
  }
  for (const ref of elements(opf, 'itemref')) {
    if (attr(ref, 'linear') === 'no') continue
    const item = items.find(el => attr(el, 'id') === attr(ref, 'idref'))
    if (!item || attr(item, 'properties').split(/\s+/).includes('nav')) continue
    const path = bookPath(root, attr(item, 'href'))
    const doc = xml(textFile(files, path)), body = first(doc, 'body')
    if (!body) continue
    // Skip a dedicated title/cover page, including our exported title page.
    if (path === bookPath(root, 'title.xhtml') || /(?:^|\/)(?:cover|titlepage)\.[^.]+$/i.test(path)) continue
    const heading = elements(body, 'h1')[0] ?? elements(body, 'h2')[0]
    const name = heading?.textContent?.trim() || first(doc, 'title')?.textContent || `第 ${chapters.length + 1} 章`
    heading?.remove()
    const html = Array.from(body.childNodes).map(node => cleanBookNode(node, src => image(path, src))).join('')
    chapters.push(chapter(name, html))
  }
  if (!chapters.length) throw new Error('EPUB 中没有可导入的正文。')
  return { title, author, synopsis, coverUrl, fontFamily, chapters }
}

function readDocx(files: Map<string, Uint8Array>, fallback: string): ImportedNovel {
  const doc = xml(textFile(files, 'word/document.xml')), body = first(doc, 'body')
  if (!body) throw new Error('Word 文件中没有正文。')
  const styles = files.has('word/styles.xml') ? xml(textFile(files, 'word/styles.xml')) : null
  const styleItems = styles ? elements(styles, 'style') : []
  const properties = (styleId: string, depth = 0): Element[] => {
    const style = styleItems.find(el => attr(el, 'styleId') === styleId)
    return style && depth < 10 ? [...properties(attr(first(style, 'basedOn'), 'val'), depth + 1), style] : []
  }
  const relations = files.has('word/_rels/document.xml.rels') ? xml(textFile(files, 'word/_rels/document.xml.rels')) : null
  const relationship = (id: string): string => {
    const rel = relations && elements(relations, 'Relationship').find(el => attr(el, 'Id') === id)
    if (!rel || attr(rel, 'TargetMode') === 'External') return ''
    const path = bookPath('word/document.xml', attr(rel, 'Target')), bytes = files.get(path)
    return bytes && /\.(png|jpe?g|gif|webp)$/i.test(path) ? imageData(bytes, imageMime(path)) : ''
  }
  const enabled = (nodes: Element[], name: string): boolean => {
    const value = nodes.map(el => first(el, name)).filter(Boolean).at(-1)
    return Boolean(value && !/^(0|false|none|off)$/i.test(attr(value, 'val')))
  }
  let title = fallback, author = '', synopsis = '', name = '正文', content: string[] = []
  const chapters: NovelChapter[] = []
  const push = (): void => {
    const cleaned = trimChapterLeadingBlanks(content.join(''))
    if (cleaned !== '<p></p>' || name !== '正文') chapters.push(chapter(name, cleaned))
    content = []
  }
  const structuredChapters = elements(body, 'p').some(p => {
    const id = attr(first(p, 'pStyle'), 'val')
    return !/^BodyHeading/.test(id) && /(?:heading|标题)\s*1\b/i.test(id + ' ' + properties(id).map(el => attr(first(el, 'name'), 'val')).join(' ')) || attr(first(p, 'outlineLvl'), 'val') === '0'
  })
  const defaults = styles && first(styles, 'docDefaults')
  const fonts = defaults && first(defaults, 'rFonts')
  let fontFamily = attr(fonts || undefined, 'eastAsia') || attr(fonts || undefined, 'ascii')
  for (const p of elements(body, 'p')) {
    const styleId = attr(first(p, 'pStyle'), 'val'), inherited = properties(styleId)
    const styleName = inherited.map(el => attr(first(el, 'name'), 'val')).join(' ')
    const rawText = elements(p, 't').map(el => el.textContent ?? '').join('')
    if (/^Title$/i.test(styleId) || /^(?:title|标题)$/i.test(styleName)) { title = rawText || title; continue }
    if (/^Subtitle$/i.test(styleId) && chapters.length === 0 && !content.length) {
      if (/^作者[：:]/.test(rawText)) author = rawText.replace(/^作者[：:]\s*/, '')
      else synopsis += (synopsis ? '\n' : '') + rawText
      continue
    }
    const level = attr(first(p, 'outlineLvl'), 'val') || attr(inherited.map(el => first(el, 'outlineLvl')).find(Boolean), 'val')
    const heading = !/^BodyHeading/.test(styleId) && (/(?:heading|标题)\s*1\b/i.test(styleId + ' ' + styleName) || level === '0')
    if ((heading || (!structuredChapters && isChapterTitle(rawText))) && rawText.trim()) { push(); name = rawText.trim(); continue }
    // Page breaks are structural, not blank body paragraphs.
    if (!rawText && elements(p, 'br').some(el => attr(el, 'type') === 'page')) continue
    const parts: string[] = []
    for (const run of elements(p, 'r')) {
      const props = [...inherited, ...properties(attr(first(run, 'rStyle'), 'val')), run]
      let text = Array.from(run.childNodes).map(node => {
        if (node.nodeType !== 1) return ''
        const el = node as Element
        return el.localName === 't' ? escapeBookXml(el.textContent ?? '') : el.localName === 'tab' ? '\t' : el.localName === 'br' && attr(el, 'type') !== 'page' ? '<br/>' : ''
      }).join('')
      if (enabled(props, 'b')) text = `<strong>${text}</strong>`
      if (enabled(props, 'i')) text = `<em>${text}</em>`
      if (enabled(props, 'u')) text = `<u>${text}</u>`
      if (enabled(props, 'strike') || enabled(props, 'dstrike')) text = `<s>${text}</s>`
      parts.push(text)
      for (const blip of elements(run, 'blip')) {
        const src = relationship(attr(blip, 'embed'))
        if (src) parts.push(`</p><div data-type="image-block" src="${escapeBookXml(src)}"></div><p>`)
      }
      if (!fontFamily) { const f = first(run, 'rFonts'); fontFamily = attr(f, 'eastAsia') || attr(f, 'ascii') }
    }
    const ind = first(p, 'ind'), firstLine = Number(attr(ind, 'firstLine'))
    const chars = Number(attr(ind, 'firstLineChars'))
    const indent = (chars || firstLine) > 0 ? '　'.repeat(Math.min(20, Math.round(chars ? chars / 100 : firstLine / 240))) : ''
    const bodyLevel = /^BodyHeading([1-3])$/.exec(styleId)?.[1]
    const tag = bodyLevel ? `h${bodyLevel}` : /(?:heading|标题)\s*[23]\b/i.test(styleId + ' ' + styleName) ? 'h2' : 'p'
    content.push(`<${tag}>${indent}${parts.join('')}</${tag}>`)
  }
  push()
  if (!chapters.length) chapters.push(chapter('正文', '<p></p>'))
  if (files.has('docProps/core.xml')) {
    const core = xml(textFile(files, 'docProps/core.xml'))
    title = first(core, 'title')?.textContent?.trim() || title
    author = first(core, 'creator')?.textContent?.trim() || author
  }
  return { title, author, synopsis, fontFamily, chapters }
}

export async function readNovelFile(file: File): Promise<ImportedNovel> {
  if (file.size > 64 * 1024 * 1024) throw new Error('文件超过 64 MB，请拆分后导入。')
  const buffer = await file.arrayBuffer(), title = file.name.replace(/\.[^.]+$/, '') || '导入的小说'
  if (/\.txt$/i.test(file.name)) {
    const bytes = new Uint8Array(buffer); let text: string
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes)
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes)
    else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { text = new TextDecoder('gb18030').decode(bytes) } }
    return importNovelText(text, title)
  }
  if (!/\.(epub|docx)$/i.test(file.name)) throw new Error('请选择 .docx、.txt 或 .epub 文件；旧版 .doc 请先另存为 .docx。')
  const files = await readBookArchive(buffer)
  return /\.epub$/i.test(file.name) ? readEpub(files, title) : readDocx(files, title)
}
