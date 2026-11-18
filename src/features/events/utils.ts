import type { Event } from '@/types'

export type SortKey = 'time' | 'updatedAt' | 'createdAt'

/**
 * 时间线支持的最大年份（绝对值）。
 * 时间轴按年绘制刻度，年份过大会让刻度/分桶数量爆炸导致页面卡死；
 * 这里统一在解析层夹紧，避免任意大的数字进入布局计算。
 */
export const MAX_ABS_YEAR = 1_000_000_000_000

/** 合法的年份输入：可选负号 + 最多 12 位数字（配合“万/亿”单位）。 */
export const YEAR_INPUT_PATTERN = /^-?\d{0,12}$/

export type YearUnit = 'none' | '万' | '亿'
export const YEAR_UNIT_OPTIONS: Array<{ value: YearUnit; label: string; multiplier: number }> = [
  { value: 'none', label: '年', multiplier: 1 },
  { value: '万', label: '万年', multiplier: 10_000 },
  { value: '亿', label: '亿年', multiplier: 100_000_000 },
]

export function yearUnitMultiplier(unit: YearUnit): number {
  return YEAR_UNIT_OPTIONS.find((item) => item.value === unit)?.multiplier ?? 1
}

/** 把「1 + 万」展开成存储用的 10000；空值保持空。 */
export function expandYear(value: string, unit: YearUnit): string {
  if (!value || value === '-') return value
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return value
  const expanded = Math.trunc(numeric * yearUnitMultiplier(unit))
  return String(Math.max(-MAX_ABS_YEAR, Math.min(MAX_ABS_YEAR, expanded)))
}

/** 从已存储的年份推断最适合回显的单位；只在能整除时使用，避免丢精度。 */
export function splitYearUnit(expanded: string): { value: string; unit: YearUnit } {
  if (!expanded || expanded === '-') return { value: expanded, unit: 'none' }
  const numeric = Number(expanded)
  if (!Number.isFinite(numeric)) return { value: expanded, unit: 'none' }
  for (const candidate of [YEAR_UNIT_OPTIONS[2], YEAR_UNIT_OPTIONS[1]]) {
    if (candidate && numeric !== 0 && numeric % candidate.multiplier === 0) {
      return { value: String(numeric / candidate.multiplier), unit: candidate.value }
    }
  }
  return { value: expanded, unit: 'none' }
}

export function formatYearNumber(year: number): string {
  if (!Number.isFinite(year)) return '0'
  const absolute = Math.abs(year)
  const trim = (value: number): string => String(Number(value.toFixed(2)))
  if (absolute >= 100_000_000) return `${trim(year / 100_000_000)}亿`
  if (absolute >= 10_000) return `${trim(year / 10_000)}万`
  return String(Math.trunc(year))
}

export function clampYear(year: number): number {
  if (!Number.isFinite(year)) return 0
  if (year > MAX_ABS_YEAR) return MAX_ABS_YEAR
  if (year < -MAX_ABS_YEAR) return -MAX_ABS_YEAR
  return Math.trunc(year)
}

/**
 * 清洗年份输入框的内容：只保留数字（和可选的负号），并限制长度。
 * 返回 null 表示输入不合法（调用方可以提示用户）。
 */
export function sanitizeYearInput(value: string): string {
  const negative = value.startsWith('-')
  const digits = value.replace(/[^\d]/g, '').slice(0, 12)
  if (!digits) return negative ? '-' : ''
  return `${negative ? '-' : ''}${digits}`
}

interface ParsedTime {
  year: string
  month: string
  day: string
}

export function parseTime(time: string): ParsedTime {
  if (!time) return { year: '', month: '', day: '' }

  const negative = time.startsWith('-')
  const clean = negative ? time.slice(1) : time
  const parts = clean.split('-')
  return {
    year: (negative ? '-' : '') + (parts[0] ?? ''),
    month: parts[1] ?? '',
    day: parts[2] ?? '',
  }
}

export function assembleTime(year: string, month: string, day: string): string {
  if (!year) return ''

  let result = year
  if (month) {
    result += '-' + month.padStart(2, '0')
  }
  if (month && day) {
    result += '-' + day.padStart(2, '0')
  }

  return result
}

export function normalizeTime(time: string): string {
  if (!time) return ''

  const negative = time.startsWith('-')
  const clean = negative ? time.slice(1) : time
  const parts = clean.split('-')
  let year = (parts[0] ?? '').padStart(4, '0')
  if (negative) year = '-' + year
  const month = (parts[1] ?? '00').padStart(2, '0')
  const day = (parts[2] ?? '00').padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function sortEvents(events: Event[], key: SortKey): Event[] {
  const sorted = [...events]
  sorted.sort((a, b) => {
    if (key === 'time') {
      const aYear = parseYear(a.time)
      const bYear = parseYear(b.time)
      const aEmpty = aYear === null
      const bEmpty = bYear === null
      if (aEmpty && bEmpty) return 0
      if (aEmpty) return 1
      if (bEmpty) return -1
      if (aYear !== bYear) return aYear - bYear
      const aTime = normalizeTime(a.time)
      const bTime = normalizeTime(b.time)
      return aTime.localeCompare(bTime)
    }
    return Number(b[key]) - Number(a[key])
  })
  return sorted
}

export function addOneYear(time: string): string {
  if (!time) return ''
  const negative = time.startsWith('-')
  const clean = negative ? time.slice(1) : time
  const parts = clean.split('-')
  const year = (negative ? '-' : '') + (parts[0] ?? '')
  const month = parts[1] ?? ''
  const day = parts[2] ?? ''
  const newYear = String(clampYear((parseYear(year) ?? 0) + 1))
  let result = newYear
  if (month) result += '-' + month.padStart(2, '0')
  if (month && day) result += '-' + day.padStart(2, '0')
  return result
}

export function parseYear(time: string): number | null {
  if (!time) return null
  const match = /^(-?\d+(?:\.\d+)?)\s*(亿|万)?/.exec(time.trim())
  if (!match) return null
  const parsed = Number(match[1]) * (match[2] === '亿' ? 100_000_000 : match[2] === '万' ? 10_000 : 1)
  // 超长/超大的年份统一夹紧到支持区间，防止时间轴刻度数量爆炸。
  return clampYear(parsed)
}

export function formatEventTime(time: string): string {
  if (!time) return '未设定时间'

  const { year, month, day } = parseTime(time)
  const yearNum = parseYear(time)

  if (!year || yearNum === null) return '未设定时间'
  const yearLabel = yearNum < 0 ? `前${formatYearNumber(Math.abs(yearNum))}年` : `${formatYearNumber(yearNum)}年`
  if (month && day) {
    return `${yearLabel}${parseInt(month, 10)}月${parseInt(day, 10)}日`
  }
  if (month) {
    return `${yearLabel}${parseInt(month, 10)}月`
  }
  return yearLabel
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  if (diff < 0) return '刚刚'

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return '刚刚'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`

  const date = new Date(timestamp)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}
