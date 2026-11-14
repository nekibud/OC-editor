'use client'

import { useState, useSyncExternalStore } from 'react'
import { normalizeHexColor, getColorMemory, getServerColorMemory, subscribeColorMemory, setColorMemorySlot } from '@/lib/color-memory'

export function ColorPicker({ value, onChange, label = '颜色', disabled = false }: {
  value: string
  onChange: (color: string) => void
  label?: string
  disabled?: boolean
}) {
  const color = normalizeHexColor(value) ?? '#8A8A8A'
  const [draft, setDraft] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState('')
  const memory = useSyncExternalStore(subscribeColorMemory, getColorMemory, getServerColorMemory)
  const change = (next: string): void => { setDraft(null); onChange(next) }
  const store = (clear = false): void => {
    try { setColorMemorySlot(selected, clear ? null : color); setError('') }
    catch { setError('颜色栏位保存失败，请重试。') }
  }
  return (
    <div role="group" aria-label={label} className="space-y-2" style={{ minWidth: 260, maxWidth: 400 }}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${label}调色盘`} value={color} disabled={disabled}
          onChange={(event) => change(event.target.value.toUpperCase())}
          className="h-9 w-12 cursor-pointer rounded border border-line bg-paper p-1" />
        <input type="text" aria-label={`${label}HEX`} value={draft ?? color} disabled={disabled}
          onChange={(event) => {
            const next = event.target.value
            setDraft(next)
            const normalized = normalizeHexColor(next)
            if (normalized) onChange(normalized)
          }}
          onBlur={() => setDraft(null)} spellCheck={false} maxLength={7}
          className="h-9 w-28 rounded border border-line bg-paper-card px-2 text-xs text-ink outline-none focus:border-line-hover" />
        <span className="text-[10px] text-ink-muted">任意颜色</span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-ink-muted">
        <span>记忆颜色</span><span>栏位 {selected + 1} / 10</span>
      </div>
      <div role="group" aria-label="记忆颜色栏位" style={{ display: 'grid', gridTemplateColumns: 'repeat(10,minmax(0,1fr))', gap: 4 }}>
        {memory.map((saved, index) => (
          <button key={index} type="button" disabled={disabled} aria-label={`颜色栏位 ${index + 1}`}
            aria-pressed={selected === index} title={saved ?? '空栏位'}
            onClick={() => { setSelected(index); if (saved) change(saved) }}
            className="h-7 rounded border text-[10px]"
            style={{ background: saved ?? 'var(--color-paper-card)', borderColor: selected === index ? 'var(--color-ink)' : 'var(--color-line)',
              boxShadow: selected === index ? '0 0 0 1px var(--color-ink-muted)' : 'none',
              color: saved ? (parseInt(saved.slice(1, 3), 16) * .299 + parseInt(saved.slice(3, 5), 16) * .587 + parseInt(saved.slice(5, 7), 16) * .114 > 145 ? '#191919' : '#FFFFFF') : 'var(--color-ink-muted)' }}>
            {index + 1}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={disabled} onClick={() => store()}
          className="h-7 rounded border border-line bg-paper-card px-2 text-[10px] text-ink">存入选中栏位</button>
        <button type="button" disabled={disabled || !memory[selected]} onClick={() => store(true)}
          className="h-7 rounded border border-line px-2 text-[10px] text-ink-muted disabled:opacity-40">清空栏位</button>
      </div>
      {error ? <p role="alert" className="text-xs text-error">{error}</p> : null}
    </div>
  )
}
