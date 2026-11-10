'use client'

import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { RelationColorPicker } from './RelationColorPicker'
import { DEFAULT_RELATION_COLOR, relationColorAppearance, resolveRelationArrow, resolveRelationColor, type RelationArrow } from '../style'

export function RelationEditDialog({ label, color, arrow, sourceName, targetName, canStyle, onSave, onClose }: {
  label: string
  color?: unknown
  arrow?: unknown
  sourceName: string
  targetName: string
  canStyle: boolean
  onSave: (draft: { label: string; color: string; arrow: RelationArrow }) => Promise<void>
  onClose: () => void
}) {
  const [text, setText] = useState(label), [draftColor, setColor] = useState(resolveRelationColor(color))
  const [draftArrow, setArrow] = useState(resolveRelationArrow(arrow)), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const id = useId().replace(/:/g, ''), appearance = relationColorAppearance(draftColor)
  const save = async (): Promise<void> => {
    if (saving) return
    setSaving(true); setError('')
    try { await onSave({ label: text.trim() || '相关', color: draftColor, arrow: draftArrow }); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。'); setSaving(false) }
  }
  return createPortal(<dialog ref={node => { if (node && !node.open) node.showModal() }}
    aria-label="编辑关系" className="relation-edit-dialog rounded-xl border border-line bg-paper text-ink shadow-lg"
    onCancel={event => { if (saving) event.preventDefault() }} onClose={() => { if (!saving) onClose() }}>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <h3 className="font-serif text-base">编辑关系</h3>
      <p className="mt-1 text-[11px] text-ink-muted">{sourceName} → {targetName}</p>
      <label className="mt-3 block text-xs text-ink-muted">关系名称
        <input autoFocus aria-label="关系名称" value={text} disabled={saving} onChange={event => setText(event.target.value)}
          className="mt-1 h-9 w-full rounded-lg border border-line bg-paper-card px-3 text-sm text-ink outline-none focus:border-line-hover" />
      </label>
      {canStyle ? <>
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-xs text-ink-muted"><span>关系颜色</span>
            <button type="button" disabled={saving} onClick={() => setColor(DEFAULT_RELATION_COLOR)} className="text-[10px] text-ink-faint">恢复默认</button></div>
          <RelationColorPicker value={draftColor} onChange={setColor} disabled={saving}/>
          <p className="mt-2 text-[10px] text-ink-faint">文字与线条使用同一种颜色。</p>
        </div>
        <label className="mt-4 block text-xs text-ink-muted">线条箭头
          <select aria-label="线条箭头" value={draftArrow} disabled={saving} onChange={event => setArrow(resolveRelationArrow(event.target.value))}
            className="mt-1 h-9 w-full rounded-lg border border-line bg-paper-card px-2 text-xs text-ink outline-none">
            <option value="none">无箭头</option>
            <option value="forward">单向箭头（{sourceName} → {targetName}）</option>
            <option value="reverse">单向箭头（{targetName} → {sourceName}）</option>
            <option value="both">双向箭头</option>
          </select>
        </label>
        <div aria-label="颜色与箭头预览" className="mt-3 rounded-lg border border-line bg-paper-card px-3 py-2" style={{ backgroundColor: appearance.labelBackground }}>
          <svg viewBox="0 0 300 46" width="100%" height="46" aria-hidden="true">
            <defs><marker id={id} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1 1 11 6 1 11Z" fill={draftColor}/></marker></defs>
            <path d="M10 32H290" stroke={draftColor} strokeWidth="2" markerStart={draftArrow === 'reverse' || draftArrow === 'both' ? `url(#${id})` : undefined} markerEnd={draftArrow === 'forward' || draftArrow === 'both' ? `url(#${id})` : undefined}/>
            <text x="150" y="18" textAnchor="middle" fontSize="12" fill={draftColor}>{text || '相关'}</text>
          </svg>
        </div>
      </> : null}
      {error ? <p role="alert" className="mt-2 text-xs text-error">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" disabled={saving} onClick={onClose} className="h-8 rounded-lg border border-line px-3 text-xs text-ink-muted">取消</button>
        <button type="submit" disabled={saving} className="h-8 rounded-lg bg-ink px-3 text-xs text-paper disabled:opacity-50">{saving ? '正在保存…' : '保存'}</button>
      </div>
    </form>
  </dialog>, document.body)
}
