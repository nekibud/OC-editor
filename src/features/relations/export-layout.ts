export const GRAPH_EXPORT_BACKGROUNDS = [
  { value: 'black', label: '黑色', color: '#000000', ink: '#F5F1EA', muted: '#C3BFB8', card: '#242424', line: '#66615B' },
  { value: 'white', label: '白色', color: '#FFFFFF', ink: '#3A3733', muted: '#7C776F', card: '#FFFFFF', line: '#D9D3C8' },
  { value: 'gray', label: '灰色', color: '#808080', ink: '#FFFFFF', muted: '#F0EEEA', card: '#686868', line: '#BEBAB4' },
  { value: 'yellow', label: '护眼淡黄', color: '#F5F1D5', ink: '#3A3733', muted: '#7C776F', card: '#FAF7E7', line: '#D9D3B8' },
] as const
export type GraphExportBackground = typeof GRAPH_EXPORT_BACKGROUNDS[number]['value']
export type GraphExportFormat = 'svg' | 'pdf' | 'png'
export interface ExportPoint { x: number; y: number }
export interface ExportEdgeControl { u1: number; v1: number; u2: number; v2: number }

/** Match RelationEdge's cubic controls and CustomEdge's quadratic offset. */
export function exportEdgeGeometry(start: ExportPoint, end: ExportPoint, options: {
  style: 'straight' | 'bezier'; cubic: boolean; control?: ExportEdgeControl; offset?: number; parallelIndex?: number; parallelCount?: number
}) {
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.max(1, Math.hypot(dx, dy))
  const nx = -dy / length, ny = dx / length
  const point = (u: number, v: number): ExportPoint => ({ x: start.x + dx * u + nx * v, y: start.y + dy * u + ny * v })
  const mid = point(.5, 0)
  if (options.style === 'straight') return { path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`, label: mid, startFrom: end, endFrom: start, bounds: [start, end] }
  const count = options.parallelCount ?? 1, lane = count > 1 ? ((options.parallelIndex ?? 0) - (count - 1) / 2) * 36 : 0
  if (options.cubic) {
    const control = options.control ?? { u1: .33, v1: 34 + lane, u2: .66, v2: 34 + lane }
    const a = point(control.u1, control.v1), b = point(control.u2, control.v2)
    return { path: `M ${start.x} ${start.y} C ${a.x} ${a.y} ${b.x} ${b.y} ${end.x} ${end.y}`,
      label: { x: .125 * start.x + .375 * a.x + .375 * b.x + .125 * end.x, y: .125 * start.y + .375 * a.y + .375 * b.y + .125 * end.y },
      startFrom: a, endFrom: b, bounds: [start, a, b, end] }
  }
  const control = point(.5, (options.offset ?? 34) + lane)
  return { path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
    label: { x: .25 * start.x + .5 * control.x + .25 * end.x, y: .25 * start.y + .5 * control.y + .25 * end.y },
    startFrom: control, endFrom: control, bounds: [start, control, end] }
}

/** A single image page keeps local Chinese fonts and the SVG/PNG appearance identical. */
export function graphJpegPdf(jpeg: Uint8Array, width: number, height: number, graphWidth: number, graphHeight: number): Blob {
  const encoder = new TextEncoder(), chunks: Uint8Array<ArrayBuffer>[] = [], offsets = [0]
  let length = 0
  const append = (data: string | Uint8Array): void => { const bytes = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data); chunks.push(bytes); length += bytes.length }
  const object = (id: number, body: string): void => { offsets[id] = length; append(`${id} 0 obj\n${body}\nendobj\n`) }
  const scale = Math.min(.75, 14400 / Math.max(graphWidth, graphHeight)), w = graphWidth * scale, h = graphHeight * scale
  append('%PDF-1.4\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Graph 4 0 R >> >> /Contents 5 0 R >>`)
  offsets[4] = length
  append(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
  append(jpeg); append('\nendstream\nendobj\n')
  const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Graph Do\nQ\n`
  object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`)
  const xref = length
  append(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(chunks.map(chunk => chunk.buffer), { type: 'application/pdf' })
}
