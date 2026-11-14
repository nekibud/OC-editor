'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Novel } from './types'
import { buildNovelEpub, downloadBook, downloadNovelTxt, readNovelFile, type ImportedNovel } from './transfer'
import { downloadNovelDocx } from './docx'

const EXPORTS = [
  { key: 'docx', label: '导出 Word (.docx)', description: '可继续编辑的文档，保留字体、行距、文字格式、空行和图片，各章另起一页。' },
  { key: 'epub', label: '导出 EPUB (.epub)', description: '带目录的电子书，各章另起一页；可用 EPUB 阅读器阅读，阅读器可能调整字体和行距。' },
  { key: 'txt', label: '导出 TXT (.txt)', description: '纯文字格式，保留空格与空行，无法保留图片、字体、加粗等格式。' },
] as const

export function NovelFileExports({ novel, disabled = false }: { novel: Novel; disabled?: boolean }) {
  const [busy, setBusy] = useState(''), [error, setError] = useState('')
  const exportFile = async (format: string): Promise<void> => {
    setBusy(format); setError('')
    try {
      if (format === 'docx') await downloadNovelDocx(novel)
      else if (format === 'epub') downloadBook(await buildNovelEpub(novel), novel.title, 'epub')
      else downloadNovelTxt(novel)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导出失败，请重试。') }
    finally { setBusy('') }
  }
  return <div className="novel-file-exports space-y-3">
    {EXPORTS.map(item => <div key={item.key}>
      <button type="button" disabled={disabled || Boolean(busy)} onClick={() => void exportFile(item.key)}
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-sm text-ink-muted hover:border-line-hover hover:text-ink disabled:opacity-40">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/></svg>
        {busy === item.key ? '正在导出…' : item.label}
      </button>
      <p className="mt-1 text-[10px] leading-4 text-ink-faint">{item.description}</p>
    </div>)}
    {error ? <p role="alert" className="text-[11px] text-error">{error}</p> : null}
  </div>
}

export function NovelImportButton({ onImport }: { onImport: (novel: ImportedNovel) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const [book, setBook] = useState<ImportedNovel | null>(null), [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [merge, setMerge] = useState(false)
  const read = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setReading(true); setError(''); setMerge(false)
    try { setBook(await readNovelFile(file)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '文件读取失败。') }
    finally { setReading(false); if (input.current) input.current.value = '' }
  }
  const confirm = async (): Promise<void> => {
    if (!book) return
    setSaving(true); setError('')
    try {
      const chapters = merge ? [{ ...book.chapters[0], title: '正文', content: book.chapters.map(ch => `<h1>${ch.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>${ch.content}`).join('') }] : book.chapters
      await onImport({ ...book, title: book.title.trim() || '导入的小说', chapters })
      setBook(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败，原有小说未被覆盖。') }
    finally { setSaving(false) }
  }
  return <div className="novel-import-control">
    <button type="button" onClick={() => input.current?.click()} disabled={reading || saving}
      className="flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-ink-muted hover:border-line-hover hover:text-ink disabled:opacity-50">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5"/></svg>
      {reading ? '正在读取…' : '导入小说'}
    </button>
    <input ref={input} type="file" accept=".docx,.txt,.epub" aria-label="选择小说文件" className="hidden" onChange={event => void read(event.target.files?.[0])}/>
    {error && !book ? <p role="alert" className="mt-1 text-[11px] text-error">{error}</p> : null}
    {book ? createPortal(<dialog ref={node => { if (node && !node.open) node.showModal() }} aria-labelledby="novel-import-title"
      onCancel={event => { if (saving) event.preventDefault() }} onClose={() => { if (!saving) setBook(null) }}
      className="novel-import-dialog rounded-xl border border-line bg-paper text-ink shadow-lg">
        <div className="novel-info-header border-b border-line"><h2 id="novel-import-title" className="font-serif text-lg">导入小说</h2>
          <button type="button" disabled={saving} aria-label="取消导入" onClick={() => setBook(null)} className="h-8 w-8 rounded-lg text-ink-muted">×</button></div>
        <div className="novel-import-content space-y-3">
          <p className="text-xs text-ink-muted">确认后创建一本新小说。支持简单段落、标题、常见文字格式和插图。</p>
          <label className="block text-xs text-ink-muted">书名<input autoFocus aria-label="导入书名" value={book.title} onChange={event => setBook({ ...book, title: event.target.value })} className="mt-1 h-8 w-full rounded border border-line bg-paper-card px-2 text-ink"/></label>
          <label className="block text-xs text-ink-muted">作者<input aria-label="导入作者" value={book.author} onChange={event => setBook({ ...book, author: event.target.value })} className="mt-1 h-8 w-full rounded border border-line bg-paper-card px-2 text-ink"/></label>
          <label className="flex items-center gap-2 text-xs text-ink-muted"><input type="checkbox" checked={merge} onChange={event => setMerge(event.target.checked)}/>整篇导入为一个章节</label>
          <p className="text-xs text-ink-muted">{merge ? '将导入 1 个章节' : `已识别 ${book.chapters.length} 个章节`}</p>
          <ol className="novel-import-chapters text-xs text-ink-muted">{book.chapters.map((ch, index) => <li key={ch.id}>{index + 1}. {ch.title}</li>)}</ol>
          <p className="text-[10px] leading-4 text-ink-faint">Word / EPUB 的复杂版式会简化为当前编辑器样式；不导入脚本和外部资源。</p>
          {error ? <p role="alert" className="text-xs text-error">{error}</p> : null}
          <button type="button" disabled={saving} onClick={() => void confirm()} className="h-9 w-full rounded-lg bg-ink px-3 text-sm text-paper disabled:opacity-50">{saving ? '正在导入…' : '确认导入'}</button>
        </div>
    </dialog>, document.body) : null}
  </div>
}
