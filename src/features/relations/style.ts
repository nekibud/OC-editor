'use client'


/**
 * 关系线固定十二色与箭头方向。
 * 颜色只用于连线描边与标签文字，保证二者始终同色。
 */
export const RELATION_COLORS = [
  { name: '红色', value: '#D84D4D' },
  { name: '粉色', value: '#D96B9D' },
  { name: '深蓝色', value: '#305DA8' },
  { name: '浅蓝色', value: '#62A9DE' },
  { name: '紫色', value: '#946AC3' },
  { name: '黄色', value: '#C6A12C' },
  { name: '橙色', value: '#DF8D40' },
  { name: '白色', value: '#FFFFFF' },
  { name: '深绿色', value: '#286449' },
  { name: '浅绿色', value: '#8BCB9A' },
  { name: '黑色', value: '#000000' },
  { name: '灰色', value: '#8A8A8A' },
] as const

// 保留此前保存的自选颜色；固定色板只限制新的颜色选择。
export const DEFAULT_RELATION_COLOR = '#8C877E'

export type RelationArrow = 'none' | 'forward' | 'reverse' | 'both'

export const DEFAULT_RELATION_ARROW: RelationArrow = 'none'

export const RELATION_ARROW_OPTIONS: Array<{
  value: RelationArrow
  label: string
  glyph: string
  hint: string
}> = [
  { value: 'none', label: '无箭头', glyph: '—', hint: '两端都不显示箭头' },
  { value: 'forward', label: '正向', glyph: '→', hint: '箭头指向终点' },
  { value: 'reverse', label: '反向', glyph: '←', hint: '箭头指向起点' },
  { value: 'both', label: '双向', glyph: '↔', hint: '两端都有箭头' },
]

export function resolveRelationColor(value: unknown): string {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toUpperCase() : DEFAULT_RELATION_COLOR
}

export function resolveRelationArrow(value: unknown): RelationArrow {
  return value === 'forward' || value === 'reverse' || value === 'both' || value === 'none'
    ? value
    : DEFAULT_RELATION_ARROW
}

/** 黑白线在明暗主题下都保留轮廓，标签文字仍与线条同色。 */
export function relationColorAppearance(value: unknown): {
  color: string
  outline: string | undefined
  labelBackground: string | undefined
} {
  const color = resolveRelationColor(value)
  const brightness = parseInt(color.slice(1, 3), 16) * .299 + parseInt(color.slice(3, 5), 16) * .587 + parseInt(color.slice(5, 7), 16) * .114
  if (brightness > 210) {
    return { color, outline: '#7C756B', labelBackground: '#625D56' }
  }
  if (brightness < 55) {
    return { color, outline: '#B9B2A7', labelBackground: '#F3EFE9' }
  }
  return { color, outline: undefined, labelBackground: undefined }
}
