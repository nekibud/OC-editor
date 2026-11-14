'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Loader2, X } from 'lucide-react'
import { GRAPH_EXPORT_BACKGROUNDS, type GraphExportBackground, type GraphExportFormat } from '../export-layout'

const FORMATS = [
  { value: 'svg', label: 'SVG', description: '矢量图形，放大仍清晰，头像随文件保存。' },
  { value: 'pdf', label: 'PDF', description: '整张关系图单页保存，保留外观，便于阅读和打印。' },
  { value: 'png', label: 'PNG', description: '常用图片格式，适合分享。' },
] as const

export function RelationExportDialog({ busy, edgeStyle, onClose, onExport }: {
  busy: boolean
  edgeStyle: 'straight' | 'bezier'
  onClose: () => void
  onExport: (options: { format: GraphExportFormat; background: GraphExportBackground }) => Promise<void>
}) {
  const [format, setFormat] = useState<GraphExportFormat>('png'), [background, setBackground] = useState<GraphExportBackground>('yellow'), [error, setError] = useState('')
  return createPortal(<dialog ref={node => { if (node && !node.open) node.showModal() }} aria-label="导出关系图"
    className="relation-export-dialog rounded-xl border border-line bg-paper p-5 text-ink shadow-lg"
    style={{ margin: 'auto', width: 'min(420px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)' }}
    onCancel={event => { if (busy) event.preventDefault() }} onClose={() => { if (!busy) onClose() }}>
    <form onSubmit={event => { event.preventDefault(); setError(''); void onExport({ format, background }).catch(cause => setError(cause instanceof Error ? cause.message : '导出失败，请重试。')) }}>
      <header className="flex items-center justify-between"><h3 className="font-serif text-base">导出关系图</h3><button type="button" aria-label="关闭导出" disabled={busy} onClick={onClose} className="rounded p-1 text-ink-muted"><X size={16}/></button></header>
      <p className="mt-2 text-[11px] leading-5 text-ink-muted">导出当前显示的分类与布局，包含画布外的节点；线型保持为{edgeStyle === 'straight' ? '直线' : '曲线'}。</p>
      <fieldset disabled={busy} className="mt-4"><legend className="text-xs text-ink-muted">底色</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">{GRAPH_EXPORT_BACKGROUNDS.map(item => <label key={item.value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs ${background === item.value ? 'border-ink/40 bg-paper-card' : 'border-line'}`}>
          <input type="radio" name="graph-background" aria-label={item.label} checked={background === item.value} onChange={() => setBackground(item.value)}/><span className="h-4 w-4 rounded border border-line" style={{ backgroundColor: item.color }}/>{item.label}
        </label>)}</div>
      </fieldset>
      <fieldset disabled={busy} className="mt-4"><legend className="text-xs text-ink-muted">文件格式</legend>
        <div className="mt-2 space-y-2">{FORMATS.map(item => <label key={item.value} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${format === item.value ? 'border-ink/40 bg-paper-card' : 'border-line'}`}>
          <input type="radio" name="graph-format" aria-label={item.label} checked={format === item.value} onChange={() => setFormat(item.value)} className="mt-1"/><span><span className="text-xs">{item.label}</span><span className="mt-1 block text-[10px] leading-4 text-ink-muted">{item.description}</span></span>
        </label>)}</div>
      </fieldset>
      {error ? <p role="alert" className="mt-3 text-xs text-error">{error}</p> : null}
      <footer className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="h-8 rounded-lg border border-line px-3 text-xs text-ink-muted">取消</button><button type="submit" disabled={busy} className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-xs text-paper disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin"/> : <Download size={13}/>} {busy ? '正在导出…' : '导出文件'}</button></footer>
    </form>
  </dialog>, document.body)
}
