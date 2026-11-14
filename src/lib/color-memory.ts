export const COLOR_MEMORY_KEY = 'oc-studio-color-memory-v1'
export const COLOR_MEMORY_EVENT = 'oc-color-memory-changed'
export const COLOR_SLOT_COUNT = 10

export function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const hex = value.trim()
  if (/^#[\da-f]{6}$/i.test(hex)) return hex.toUpperCase()
  if (/^#[\da-f]{3}$/i.test(hex)) return '#' + [...hex.slice(1)].map((v) => v + v).join('').toUpperCase()
  return undefined
}

const EMPTY_MEMORY: (string | null)[] = Array(COLOR_SLOT_COUNT).fill(null)
let cachedRaw: string | null | undefined
let cachedMemory = EMPTY_MEMORY

export function getServerColorMemory(): (string | null)[] { return EMPTY_MEMORY }

export function getColorMemory(): (string | null)[] {
  if (typeof window === 'undefined') return EMPTY_MEMORY
  try {
    const raw = window.localStorage.getItem(COLOR_MEMORY_KEY)
    if (raw !== cachedRaw) {
      cachedRaw = raw
      let data: unknown = null
      try { data = raw ? JSON.parse(raw) : null } catch { /* use empty slots */ }
      cachedMemory = Array.from({ length: COLOR_SLOT_COUNT }, (_, index) =>
        Array.isArray(data) ? normalizeHexColor(data[index]) ?? null : null,
      )
    }
    return cachedMemory
  } catch { return EMPTY_MEMORY }
}

export function subscribeColorMemory(onChange: () => void): () => void {
  const storage = (event: StorageEvent): void => {
    if (event.key === COLOR_MEMORY_KEY || event.key === null) onChange()
  }
  window.addEventListener(COLOR_MEMORY_EVENT, onChange)
  window.addEventListener('storage', storage)
  return () => {
    window.removeEventListener(COLOR_MEMORY_EVENT, onChange)
    window.removeEventListener('storage', storage)
  }
}

export function setColorMemorySlot(index: number, value: string | null): void {
  if (!Number.isInteger(index) || index < 0 || index >= COLOR_SLOT_COUNT) throw new RangeError('无效颜色栏位')
  const color = value === null ? null : normalizeHexColor(value)
  if (color === undefined) throw new Error('请输入有效的 HEX 颜色')
  const next = [...getColorMemory()]
  next[index] = color
  window.localStorage.setItem(COLOR_MEMORY_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event(COLOR_MEMORY_EVENT))
}
