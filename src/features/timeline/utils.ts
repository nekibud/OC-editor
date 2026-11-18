import type { TimelineEvent } from './types'
import { clampYear, formatYearNumber } from '@/features/events/utils'

export type TimelineDensity = 'year' | 'decade' | 'half-century' | 'century'

export interface TimeBucket {
  label: string
  startYear: number
  endYear: number
  events: TimelineEvent[]
  x: number
  width: number
}

export function computeDensity(pxPerYear: number): TimelineDensity {
  if (pxPerYear >= 40) return 'year'
  if (pxPerYear >= 20) return 'decade'
  if (pxPerYear >= 10) return 'half-century'
  return 'century'
}

export function densityLabel(density: TimelineDensity): string {
  if (density === 'year') return '年视图'
  if (density === 'decade') return '十年视图'
  if (density === 'half-century') return '五十年视图'
  return '百年视图'
}

export function parseYear(time: string): number | null {
  if (!time) return null
  const match = /^-?\d+/.exec(time)
  if (!match) return null
  return clampYear(parseInt(match[0], 10))
}

/** 单个视图最多渲染的分桶/刻度数量，防止超长时间跨度把页面卡死。 */
const MAX_BUCKETS = 400
const MAX_TICKS = 400

export function buildBuckets(
  timedEvents: TimelineEvent[],
  density: TimelineDensity,
  rangeStart: number,
  totalYears: number,
  pxPerYear: number,
  leftPadding: number,
): BucketResult {
  const baseSize = density === 'decade' ? 10 : density === 'half-century' ? 50 : 100
  // 跨度极大时自动放大桶宽，桶的数量始终受 MAX_BUCKETS 限制。
  let bucketSize = baseSize
  while (bucketSize < 1_000_000_000_000_000 && totalYears / bucketSize > MAX_BUCKETS) {
    bucketSize *= 10
  }

  // Split: spanning (crosses bucket boundary) vs bucket-fitting
  const spanningEvents: TimelineEvent[] = []
  const bucketEvents: TimelineEvent[] = []

  for (const e of timedEvents) {
    const y = parseYear(e.time)
    if (y === null) continue
    const ey = parseYear(e.endTime || e.time) ?? y
    if (Math.floor(y / bucketSize) !== Math.floor(ey / bucketSize)) {
      spanningEvents.push(e)
    } else {
      bucketEvents.push(e)
    }
  }

  // Compute spanning event positions + lane assignment
  const spanning = spanningEvents
    .map((e) => {
      const y = parseYear(e.time) ?? 0
      const ey = parseYear(e.endTime || e.time) ?? y
      const x = leftPadding + (y - rangeStart) * pxPerYear
      const endX = leftPadding + (ey - rangeStart) * pxPerYear
      return { event: e, x, width: Math.max(endX - x, 8), lane: 0 }
    })
    .sort((a, b) => a.x - b.x)

  const laneEnds: number[] = []
  for (const item of spanning) {
    let lane = 0
    for (; lane < 8; lane++) {
      if (!(lane in laneEnds) || laneEnds[lane] <= item.x) {
        laneEnds[lane] = item.x + item.width
        break
      }
    }
    if (lane >= 8) laneEnds.push(item.x + item.width)
    item.lane = lane
  }

  // 只处理真正有事件的桶（按桶索引分组），不再遍历整个时间跨度。
  const grouped = new Map<number, TimelineEvent[]>()
  for (const e of bucketEvents) {
    const y = parseYear(e.time)
    if (y === null) continue
    const index = Math.floor(y / bucketSize)
    const list = grouped.get(index)
    if (list) list.push(e)
    else grouped.set(index, [e])
  }

  const buckets: TimeBucket[] = []
  const indices = [...grouped.keys()].sort((a, b) => a - b)
  for (const index of indices) {
    const startYear = index * bucketSize
    const endYear = startYear + bucketSize - 1
    const events = (grouped.get(index) ?? []).sort((a, b) => {
      const aY = parseYear(a.time) ?? 0
      const bY = parseYear(b.time) ?? 0
      if (aY !== bY) return aY - bY
      return a.time.localeCompare(b.time)
    })
    if (events.length === 0) continue

    buckets.push({
      label:
        density === 'century'
          ? `${formatYearNumber(startYear)}年 - ${formatYearNumber(endYear)}年`
          : `${formatYearNumber(startYear)} - ${formatYearNumber(endYear)}`,
      startYear,
      endYear,
      events,
      x: leftPadding + (startYear - rangeStart) * pxPerYear,
      width: bucketSize * pxPerYear,
    })
  }

  return { buckets, spanning }
}

export interface SpanningEvent {
  event: TimelineEvent
  x: number
  width: number
  lane: number
}

export interface BucketResult {
  buckets: TimeBucket[]
  spanning: SpanningEvent[]
}

export interface YearTick {
  year: number
  x: number
}

export function buildYearTicks(
  density: TimelineDensity,
  rangeStart: number,
  totalYears: number,
  pxPerYear: number,
  leftPadding: number,
): YearTick[] {
  if (density === 'year') {
    // 年视图最多渲染 MAX_TICKS 个刻度；年份跨度再大也不会撑爆 DOM。
    const step = Math.max(1, Math.ceil(totalYears / MAX_TICKS))
    const ticks: YearTick[] = []
    for (let i = 0; i <= totalYears; i += step) {
      ticks.push({
        year: rangeStart + i,
        x: leftPadding + i * pxPerYear,
      })
    }
    return ticks
  }

  let step = density === 'decade' ? 10 : density === 'half-century' ? 50 : 100
  while (step < 1_000_000_000_000_000 && totalYears / step > MAX_TICKS) {
    step *= 10
  }
  const start =
    Math.trunc(rangeStart / step) * step
  const end = rangeStart + totalYears
  const ticks: YearTick[] = []

  for (let year = start; year <= end; year += step) {
    ticks.push({
      year,
      x: leftPadding + (year - rangeStart) * pxPerYear,
    })
  }

  return ticks
}
