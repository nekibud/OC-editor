/** Blob ↔ data URL，供地图图片随备份往返。 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

export function dataUrlToBlob(value: string): Blob | null {
  if (!value.startsWith('data:')) return null
  const comma = value.indexOf(',')
  if (comma < 0) return null
  const header = value.slice(5, comma)
  const payload = value.slice(comma + 1)
  const mime = header.split(';')[0] || 'application/octet-stream'
  try {
    const binary = header.includes(';base64') ? atob(payload) : decodeURIComponent(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  } catch {
    return null
  }
}
