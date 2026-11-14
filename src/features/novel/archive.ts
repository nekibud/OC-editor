const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, value, true)
  return out
}
function u32(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value >>> 0, true)
  return out
}
function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function zipFiles(files: Array<{ name: string; data: Uint8Array }>, mime: string): Blob {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const name = encoder.encode(file.name)
    const crc = crc32(file.data)
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
      file.data,
    ])
    localParts.push(local)
    centralParts.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(file.data.length),
        u32(file.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    )
    offset += local.length
  }

  const central = concat(centralParts)
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
  return new Blob([concat([...localParts, central, end]).buffer as ArrayBuffer], {
    type: mime,
  })
}

/** Read stored/deflated Office and EPUB ZIPs without extracting files to disk. */
export async function readBookArchive(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const data = new Uint8Array(buffer), view = new DataView(buffer)
  let end = data.length - 22
  while (end >= Math.max(0, data.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < Math.max(0, data.length - 65557)) throw new Error('文件不是有效的 Word / EPUB 文件。')
  const count = view.getUint16(end + 10, true)
  if (count > 10000 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('不支持此压缩文件。')
  let cursor = view.getUint32(end + 16, true), total = 0
  const files = new Map<string, Uint8Array>()
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > data.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('压缩文件目录损坏。')
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true)
    const crc = view.getUint32(cursor + 16, true), packed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true)
    const length = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true)
    const offset = view.getUint32(cursor + 42, true)
    const name = new TextDecoder().decode(data.subarray(cursor + 46, cursor + 46 + length)).replaceAll('\\', '/')
    cursor += 46 + length + extra + comment
    total += size
    if (flags & 1) throw new Error('无法导入加密文件，请先移除密码或加密。')
    if (size > 64 * 1024 * 1024 || total > 128 * 1024 * 1024) throw new Error('文件解压后过大，请拆分后导入。')
    if (offset + 30 > data.length || view.getUint32(offset, true) !== 0x04034b50) throw new Error('压缩文件内容损坏。')
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true)
    if (start + packed > data.length) throw new Error('压缩文件内容不完整。')
    let bytes = data.slice(start, start + packed)
    if (method === 8) {
      const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
      const chunks: Uint8Array[] = []; let read = 0
      while (true) {
        const next = await reader.read()
        if (next.done) break
        read += next.value.length
        if (read > size) { await reader.cancel(); throw new Error('压缩文件大小异常。') }
        chunks.push(next.value)
      }
      bytes = new Uint8Array(concat(chunks))
    } else if (method !== 0) throw new Error('此压缩方式暂不支持。')
    if (bytes.length !== size || crc32(bytes) !== crc) throw new Error('文件校验失败，可能已经损坏。')
    if (!name.endsWith('/')) files.set(name, bytes)
  }
  return files
}
