'use client'

import { zipFiles } from './archive'
import { getImageUrl } from '@/lib/image-service'
import type { Novel } from './types'
import { parseNovelBlocks, type NovelRun } from './render'

/* --------------------------------------------------------------------------
 * Minimal ZIP writer (stored entries, UTF-8 names). DOCX is a ZIP container,
 * so this keeps Word export dependency-free.
 * -------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
 * WordprocessingML
 * -------------------------------------------------------------------------- */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function textParagraph(text: string, style?: string, indent = false, runs?: NovelRun[]): string {
  const pPr = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    indent ? '<w:ind w:left="420" w:right="420"/>' : '',
  ].join('')
  const content = (runs?.length ? runs : [{ text }]).map((run) => {
    const marks = `${run.bold ? '<w:b/>' : ''}${run.italic ? '<w:i/>' : ''}${run.underline ? '<w:u w:val="single"/>' : ''}${run.strike ? '<w:strike/>' : ''}`
    return `<w:r>${marks ? `<w:rPr>${marks}</w:rPr>` : ''}${run.text.split(/(\n|\t)/).map(part => part === '\n' ? '<w:br/>' : part === '\t' ? '<w:tab/>' : `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`).join('')}</w:r>`
  }).join('')
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`
}

function pageBreak(): string {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
}

function imageParagraph(
  relId: string,
  imageId: number,
  widthPx: number,
  heightPx: number,
): string {
  const maxWidth = 5300000
  const scale = Math.min(1, maxWidth / (widthPx * 9525))
  const cx = Math.round(widthPx * 9525 * scale)
  const cy = Math.round(heightPx * 9525 * scale)
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imageId}" name="Picture ${imageId}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${imageId}" name="image${imageId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Default Extension="gif" ContentType="image/gif"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="SimSun" w:hAnsi="SimSun"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="480" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="2400" w:after="360"/></w:pPr><w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="SimSun"/><w:b/><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="7A6650"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="480" w:after="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="300" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:color w:val="6B5B47"/><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="420"/></w:pPr></w:style>
${[36, 30, 25].map((size, index) => `<w:style w:type="paragraph" w:styleId="BodyHeading${index + 1}"><w:name w:val="Body Heading ${index + 1}"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="360" w:after="180" w:line="336" w:lineRule="auto"/><w:outlineLvl w:val="${index + 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`).join('')}
</w:styles>`

export async function buildNovelDocx(novel: Novel): Promise<Blob> {
  const media: Array<{ name: string; data: Uint8Array }> = []
  const rels: string[] = []
  let imageId = 0
  const paragraphs: string[] = []

  paragraphs.push(textParagraph(novel.title || '未命名小说', 'Title'))
  if (novel.author) paragraphs.push(textParagraph(`作者：${novel.author}`, 'Subtitle'))
  if (novel.synopsis.trim()) {
    for (const line of novel.synopsis.split(/\n+/)) {
      if (line.trim()) paragraphs.push(textParagraph(line.trim(), 'Subtitle'))
    }
  }

  for (const chapter of novel.chapters) {
    paragraphs.push(pageBreak())
    paragraphs.push(textParagraph(chapter.title || '新章节', 'Heading1'))
    const blocks = parseNovelBlocks(chapter.content)
    for (const block of blocks) {
      if (block.kind === 'image' && block.src) {
        try {
          const resolved = getImageUrl(block.src, 'avatar')
          const response = await fetch(resolved)
          const blob = await response.blob()
          const bytes = new Uint8Array(await blob.arrayBuffer())
          const mime = blob.type.includes('jpeg') ? 'jpeg' : blob.type.includes('gif') ? 'gif' : 'png'
          imageId += 1
          const fileName = `image${imageId}.${mime}`
          media.push({ name: `word/media/${fileName}`, data: bytes })
          const relId = `rIdImg${imageId}`
          rels.push(
            `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/>`,
          )
          const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
            const image = new Image()
            image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
            image.onerror = () => resolve({ width: 800, height: 600 })
            image.src = resolved
          })
          paragraphs.push(imageParagraph(relId, imageId, dimensions.width, dimensions.height))
        } catch {
          // Missing/corrupt images are skipped; text still exports.
        }
        continue
      }
      const text = block.text ?? ''
      if (!text.trim() && block.kind !== 'paragraph') continue
      if (block.kind === 'heading') paragraphs.push(textParagraph(text, `BodyHeading${block.headingLevel ?? 1}`, false, block.runs))
      else if (block.kind === 'quote') paragraphs.push(textParagraph(text, 'Quote', true, block.runs))
      else if (block.kind === 'list') paragraphs.push(textParagraph(`• ${text}`, 'ListParagraph', false, [{ text: '• ' }, ...(block.runs ?? [{ text }])]))
      else paragraphs.push(textParagraph(text, undefined, false, block.runs))
    }
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${rels.join('')}
</Relationships>`

  const encoder = new TextEncoder()
  return zipFiles([
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
    { name: 'word/document.xml', data: encoder.encode(document) },
    { name: 'word/styles.xml', data: encoder.encode(novel.fontFamily?.trim() ? STYLES.replaceAll('SimSun', escapeXml(novel.fontFamily.trim())) : STYLES) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(documentRels) },
    ...media,
  ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
}

export async function downloadNovelDocx(novel: Novel): Promise<void> {
  const blob = await buildNovelDocx(novel)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${(novel.title || '小说').replace(/[\\/:*?"<>|]/g, '-')}.docx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}
