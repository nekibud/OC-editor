import { blobFromLocalPath, blobToDataUrl, isTauriRuntime } from '@/lib/local-media'

const IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|avif|svg|mp4|webm)(?:[?#].*)?$/i
const IMAGE_PATH_HINT = /(?:^|\/)(?:images?|media|assets?|附件|图片)\//i

function looksLikeLocalImage(value: string): boolean {
  if (!value || value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('http:') || value.startsWith('https:') || value.startsWith('asset:')) return false
  return IMAGE_EXT.test(value) || IMAGE_PATH_HINT.test(value)
}

async function readLocalImage(value: string): Promise<string | null> {
  if (!isTauriRuntime()) return null
  const blob = await blobFromLocalPath(value).catch(() => null)
  if (!blob || blob.size === 0) return null
  return blobToDataUrl(blob)
}

/**
 * 导出 .ocbak 前把本地图片路径转成 data URL。
 * 浏览器端图片本来就是 data URL；Tauri 端的 AppData 相对路径会在这里被读出来，
 * 这样别人导入 OC Studio / OC editor 时才能看到图片，而不是一条失效路径。
 */
export async function embedImagesDeep<T>(input: T): Promise<T> {
  const seen = new WeakSet<object>()

  const walk = async (value: unknown): Promise<unknown> => {
    if (typeof value === 'string') {
      if (!looksLikeLocalImage(value)) return value
      return (await readLocalImage(value)) ?? value
    }
    // 地图的 imageBlob/paintBlob 仍由 seed + params 重建；不要把 Blob 变成
    // data URL，否则全量备份导入后地图层会变成字符串而无法渲染。
    if (value instanceof Blob) return value
    if (Array.isArray(value)) {
      const out: unknown[] = []
      for (const item of value) out.push(await walk(item))
      return out
    }
    if (value && typeof value === 'object') {
      if (seen.has(value)) return value
      seen.add(value)
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        out[key] = await walk(item)
      }
      return out
    }
    return value
  }

  return (await walk(input)) as T
}
