'use client'

import { RELATION_COLORS } from '../style'

export function RelationColorPicker({ value, onChange, label = '关系颜色', disabled = false }: {
  value: string
  onChange: (color: string) => void
  label?: string
  disabled?: boolean
}) {
  return <div role="group" aria-label={label} style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 28px)', gap: 8 }}>
    {RELATION_COLORS.map(color => <button key={color.value} type="button" disabled={disabled}
      aria-label={color.name} title={color.name} aria-pressed={value.toUpperCase() === color.value}
      onClick={() => onChange(color.value)} className="rounded-full border border-line transition-transform hover:scale-110 disabled:opacity-40"
      style={{ width: 28, height: 28, backgroundColor: color.value,
        boxShadow: value.toUpperCase() === color.value ? '0 0 0 2px var(--color-paper), 0 0 0 3px var(--color-ink-muted)' : undefined }} />)}
  </div>
}
