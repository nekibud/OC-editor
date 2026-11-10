'use client'

import type { Edge, Node } from '@xyflow/react'
import { resolveImageUrl } from '@/lib/image-service'
import { downloadBlob } from '@/lib/zip'
import { blobFromLocalPath, blobToDataUrl, isTauriRuntime } from '@/lib/local-media'
import { resolveRelationArrow, relationColorAppearance } from './style'
import { GRAPH_EXPORT_BACKGROUNDS, exportEdgeGeometry, graphJpegPdf, type ExportPoint, type ExportEdgeControl, type GraphExportBackground, type GraphExportFormat } from './export-layout'

const FONT = '"Noto Sans SC", "Microsoft YaHei", sans-serif'
const xml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
function nodeRect(node: Node) {
  return { x: node.position.x, y: node.position.y, width: node.measured?.width ?? node.width ?? 120, height: node.measured?.height ?? node.height ?? 96 }
}
function anchorOf(node: Node) {
  const rect = nodeRect(node), type = node.data?.entityType
  const radius = type === 'character' || type === 'country' ? 28 : type === 'event' ? 24 : null
  return { x: rect.x + rect.width / 2, y: rect.y + (radius ?? rect.height / 2), radius, width: rect.width, height: rect.height }
}
function edgePoint(anchor: ReturnType<typeof anchorOf>, toward: ExportPoint): ExportPoint {
  const dx = toward.x - anchor.x, dy = toward.y - anchor.y, distance = Math.hypot(dx, dy)
  if (distance < .001) return { x: anchor.x, y: anchor.y }
  const scale = anchor.radius !== null ? (anchor.radius + 2) / distance : 1 / Math.max(Math.abs(dx) / Math.max(1, anchor.width / 2), Math.abs(dy) / Math.max(1, anchor.height / 2))
  return { x: anchor.x + dx * scale, y: anchor.y + dy * scale }
}
async function imageData(path: string, type: 'avatar' | 'flag' | 'header'): Promise<string | null> {
  if (!path) return null
  try {
    if (isTauriRuntime()) { const blob = await blobFromLocalPath(path); if (blob) return await blobToDataUrl(blob) }
    const src = resolveImageUrl(path, type)
    if (src.startsWith('data:')) return src
    const response = await fetch(src)
    return response.ok ? await blobToDataUrl(await response.blob()) : null
  } catch { return null }
}
function customOffsets(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem('oc-custom-edge-offsets') ?? '{}') ?? {} } catch { return {} }
}
export interface ExportRelationGraphOptions {
  filename?: string
  title?: string
  format?: GraphExportFormat
  background?: GraphExportBackground
  edgeStyle?: 'straight' | 'bezier'
  edgeControls?: Record<string, ExportEdgeControl>
}

/** Build one self-contained vector scene; every format uses these exact paths. */
export async function relationGraphSvg(nodes: Node[], edges: Edge[], options: ExportRelationGraphOptions = {}) {
  nodes = nodes.filter(node => !node.hidden)
  if (!nodes.length) throw new Error('当前关系图为空，无法导出')
  const theme = GRAPH_EXPORT_BACKGROUNDS.find(item => item.value === options.background) ?? GRAPH_EXPORT_BACKGROUNDS[3]
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) throw new Error('无法创建导出画布')
  const measure = (text: string, size: number): number => { ctx.font = `${size}px ${FONT}`; return ctx.measureText(text).width }
  const truncate = (text: string, size: number, width: number): string => { if (measure(text, size) <= width) return text; while (text.length > 1 && measure(text + '…', size) > width) text = text.slice(0, -1); return text + '…' }
  const text = (value: string, x: number, y: number, size: number, color: string, anchor = 'middle'): string => `<text x="${x}" y="${y}" font-family="${xml(FONT)}" font-size="${size}" fill="${xml(color)}" text-anchor="${anchor}" dominant-baseline="middle">${xml(value)}</text>`
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const include = (point: ExportPoint): void => { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y) }
  for (const node of nodes) { const r = nodeRect(node); include(r); include({ x: r.x + r.width, y: r.y + r.height }) }
  const nodeById = new Map(nodes.map(node => [node.id, node])), offsets = customOffsets(), lines: string[] = [], labels: string[] = [], cards: string[] = [], defs: string[] = []
  for (const edge of edges) {
    if (edge.hidden) continue
    const source = nodeById.get(edge.source), target = nodeById.get(edge.target)
    if (!source || !target) continue
    const a = anchorOf(source), b = anchorOf(target), start = edgePoint(a, b), end = edgePoint(b, a)
    const geometry = exportEdgeGeometry(start, end, { style: options.edgeStyle ?? 'bezier', cubic: edge.type === 'relationEdge', control: options.edgeControls?.[edge.id], offset: offsets[edge.id], parallelIndex: Number(edge.data?.parallelIndex ?? 0), parallelCount: Number(edge.data?.parallelCount ?? 1) })
    geometry.bounds.forEach(include)
    const { color, outline, labelBackground } = relationColorAppearance(edge.data?.color)
    const edgeId = xml(edge.id)
    if (outline) lines.push(`<path d="${geometry.path}" fill="none" stroke="${outline}" stroke-width="3.6"/>`)
    lines.push(`<path data-edge-id="${edgeId}" d="${geometry.path}" fill="none" stroke="${color}" stroke-width="1.6"/>`)
    const arrow = resolveRelationArrow(edge.data?.arrow)
    const drawArrow = (tip: ExportPoint, from: ExportPoint): void => {
      const angle = Math.atan2(tip.y - from.y, tip.x - from.x), dx = Math.cos(angle), dy = Math.sin(angle)
      lines.push(`<polygon points="${tip.x},${tip.y} ${tip.x - dx * 9 - dy * 4.95},${tip.y - dy * 9 + dx * 4.95} ${tip.x - dx * 9 + dy * 4.95},${tip.y - dy * 9 - dx * 4.95}" fill="${color}"${outline ? ` stroke="${outline}" stroke-width="1" stroke-linejoin="round"` : ''}/>`)
    }
    if (arrow === 'reverse' || arrow === 'both') drawArrow(start, geometry.startFrom)
    if (arrow === 'forward' || arrow === 'both') drawArrow(end, geometry.endFrom)
    const label = String(edge.data?.label ?? edge.data?.relation ?? edge.label ?? '').trim()
    if (label && edge.data?.hideLabel !== true) {
      const { x, y } = geometry.label, w = measure(label, 11) + 14
      include({ x: x - w / 2, y: y - 10 }); include({ x: x + w / 2, y: y + 10 })
      labels.push(`<g data-edge-label="${edgeId}"><rect x="${x - w / 2}" y="${y - 10}" width="${w}" height="20" rx="4" fill="${labelBackground ?? theme.card}" stroke="${color}" stroke-opacity=".45"/>${text(label, x, y + .5, 11, color)}</g>`)
    }
  }
  const images = await Promise.all(nodes.map(async node => {
    const type = String(node.data?.entityType), path = type === 'character' ? node.data?.qAvatarUrl || node.data?.avatarUrl : type === 'country' ? node.data?.flagUrl : type === 'event' ? node.data?.imageUrl : node.data?.avatarUrl
    return typeof path === 'string' && path ? imageData(path, type === 'country' ? 'flag' : type === 'event' ? 'header' : 'avatar') : null
  }))
  nodes.forEach((node, index) => {
    const rect = nodeRect(node), anchor = anchorOf(node), type = node.data?.entityType, label = String(node.data?.label ?? '')
    const accent = /^#[\da-f]{6}$/i.test(String(node.data?.accentColor)) ? String(node.data.accentColor) : '#8C877E'
    const image = images[index], id = `avatar-${index}`
    const avatar = (x: number, y: number, radius: number): string => {
      defs.push(`<clipPath id="${id}"><circle cx="${x}" cy="${y}" r="${radius}"/></clipPath>`)
      return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${theme.card}" stroke="${theme.line}"/>` + (image ? `<image href="${xml(image)}" x="${x - radius}" y="${y - radius}" width="${radius * 2}" height="${radius * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>` : `<circle cx="${x}" cy="${y}" r="${radius}" fill="${accent}" fill-opacity=".22"/>${text(label.slice(0, 1), x, y, 13, theme.muted)}`)
    }
    if (type === 'custom') {
      cards.push(`<g data-node-id="${xml(node.id)}"><rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="12" fill="${theme.card}" stroke="${node.data?.customKind === 'section' ? accent : theme.line}"/>${image ? avatar(rect.x + 22, rect.y + 22, 13) : ''}${text(truncate(label, 12, rect.width - 16), rect.x + rect.width / 2, rect.y + (image ? 50 : rect.height / 2), 12, theme.ink)}</g>`)
    } else {
      const radius = anchor.radius ?? 24, country = node.data?.countryColor
      const ring = type === 'character' && typeof country === 'string' ? `<circle cx="${anchor.x}" cy="${anchor.y}" r="${radius - 1.5}" fill="none" stroke="${xml(country)}" stroke-width="3"/>` : ''
      cards.push(`<g data-node-id="${xml(node.id)}">${avatar(anchor.x, anchor.y, radius)}${ring}${text(truncate(label, 12, Math.max(96, radius * 3)), anchor.x, anchor.y + radius + 14, 12, theme.ink)}${typeof node.data?.subtitle === 'string' && node.data.subtitle ? text(truncate(node.data.subtitle, 10, Math.max(96, radius * 3)), anchor.x, anchor.y + radius + 30, 10, theme.muted) : ''}</g>`)
    }
  })
  minX -= 90; minY -= 90; maxX += 90; maxY += 90
  const width = Math.max(320, maxX - minX), height = Math.max(240, maxY - minY)
  const title = options.title ? text(options.title, minX + 24, minY + 30, 16, theme.ink, 'start') : ''
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}"><title>${xml(options.title ?? 'OC 关系图')}</title><defs>${defs.join('')}</defs><rect data-export-background="${theme.value}" x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${theme.color}"/>${lines.join('')}${labels.join('')}${cards.join('')}${title}</svg>`
  return { svg, width, height }
}

async function rasterize(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const scale = Math.min(2, 7000 / Math.max(width, height), Math.sqrt(32_000_000 / (width * height)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale)); canvas.height = Math.max(1, Math.ceil(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建导出画布')
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('关系图渲染失败，请重试')); img.src = url })
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  } finally { URL.revokeObjectURL(url) }
  return canvas
}

export async function exportRelationGraph(nodes: Node[], edges: Edge[], options: ExportRelationGraphOptions = {}): Promise<string> {
  await document.fonts.ready
  const { svg, width, height } = await relationGraphSvg(nodes, edges, options)
  const format = options.format ?? 'png'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filename = options.filename ?? `OC关系图-${stamp}.${format}`
  let blob: Blob
  if (format === 'svg') blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  else {
    const canvas = await rasterize(svg, width, height)
    const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('导出图片失败，请重试')), format === 'pdf' ? 'image/jpeg' : 'image/png', .98))
    blob = format === 'pdf' ? graphJpegPdf(new Uint8Array(await image.arrayBuffer()), canvas.width, canvas.height, width, height) : image
  }
  downloadBlob(blob, filename)
  return filename
}
export const exportRelationGraphPng = (nodes: Node[], edges: Edge[], options: ExportRelationGraphOptions = {}): Promise<string> => exportRelationGraph(nodes, edges, { ...options, format: 'png' })
