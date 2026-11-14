'use client'

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { formatNovelDocument, type WritingNode } from './writing'

const COMMON_FONTS = ['Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'FangSong', 'Arial', 'Times New Roman', 'Consolas']

function NovelSelectionToolbar({ editor }: { editor: Editor | null }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const subscribe = useCallback((notify: () => void) => {
    if (!editor || editor.isDestroyed) return () => {}
    editor.on('transaction', notify)
    return () => { editor.off('transaction', notify) }
  }, [editor])
  const snapshot = useCallback(() => editor && !editor.isDestroyed
    ? ['bold', 'italic', 'strike', 'underline'].reduce((mask, mark, index) => mask | (editor.isActive(mark) ? 1 << index : 0), 0) : 0, [editor])
  const marks = useSyncExternalStore(subscribe, snapshot, () => 0)

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    let frame = 0
    const update = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed || editor.state.selection.empty ||
          !editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to).trim() ||
          (!editor.isFocused && !toolbar.current?.contains(document.activeElement))) {
          setPosition(null); return
        }
        const selection = window.getSelection()
        if (!selection?.rangeCount) { setPosition(null); return }
        const range = selection.getRangeAt(0)
        if (!editor.view.dom.contains(range.commonAncestorContainer)) { setPosition(null); return }
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)
        const rect = rects[rects.length - 1]
        const editorRect = editor.view.dom.getBoundingClientRect()
        if (!rect || rect.bottom < 0 || rect.top > window.innerHeight || editorRect.width === 0) {
          setPosition(null); return
        }
        setPosition({ left: Math.max(8, Math.min(rect.left + rect.width / 2 - 76, window.innerWidth - 160)), top: rect.bottom + 8 })
      })
    }
    const outside = (event: PointerEvent): void => {
      if (!editor.view.dom.contains(event.target as Node) && !toolbar.current?.contains(event.target as Node)) setPosition(null)
    }
    editor.on('selectionUpdate', update); editor.on('transaction', update)
    editor.on('focus', update); editor.on('blur', update)
    document.addEventListener('selectionchange', update)
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('scroll', update, true); window.addEventListener('resize', update)
    update()
    return () => {
      cancelAnimationFrame(frame)
      editor.off('selectionUpdate', update); editor.off('transaction', update)
      editor.off('focus', update); editor.off('blur', update)
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update)
    }
  }, [editor])

  if (!position || !editor || editor.isDestroyed) return null
  const actions = [
    { label: '加粗', path: 'M6 4h7a4 4 0 0 1 0 8H6V4m0 8h8a4 4 0 0 1 0 8H6v-8', run: () => editor.chain().focus().toggleBold().run() },
    { label: '斜体', path: 'M10 4h9M5 20h9M15 4 9 20', run: () => editor.chain().focus().toggleItalic().run() },
    { label: '删除线', path: 'M17 5a6 6 0 0 0-5-2c-3 0-5 1.5-5 4 0 2 2 3 5 4m-1 2c4 1 6 2 6 4 0 2.5-2 4-5 4a7 7 0 0 1-6-3M3 12h18', run: () => editor.chain().focus().toggleStrike().run() },
    { label: '下划线', path: 'M6 3v8a6 6 0 0 0 12 0V3M4 21h16', run: () => editor.chain().focus().toggleUnderline().run() },
  ]
  return createPortal(<div ref={toolbar} role="toolbar" aria-label="文字格式" data-novel-selection-toolbar
    className="flex items-center gap-1 rounded-lg border border-line bg-paper p-1 shadow-lg"
    style={{ position: 'fixed', left: position.left, top: position.top, zIndex: 15000 }}
    onKeyDown={(event) => { if (event.key === 'Escape') editor.chain().focus().setTextSelection(editor.state.selection.to).run() }}>
    {actions.map((action, index) => <button key={action.label} type="button" title={action.label} aria-label={action.label}
      aria-pressed={Boolean(marks & (1 << index))} onPointerDown={(event) => event.preventDefault()} onClick={action.run}
      className={`flex h-8 w-8 items-center justify-center rounded ${marks & (1 << index) ? 'bg-paper-card text-ink ring-1 ring-line' : 'text-ink-muted hover:bg-black/5 dark:hover:bg-white/5'}`}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={action.path} /></svg>
    </button>)}
  </div>, document.body)
}

export function NovelWritingTools({ editor, fontFamily, onFontChange }: {
  editor: Editor | null
  fontFamily?: string
  onFontChange: (family: string) => void
}) {
  const [font, setFont] = useState(fontFamily ?? '')
  const [fonts, setFonts] = useState<string[]>(COMMON_FONTS)
  const [message, setMessage] = useState('')
  const listId = useId()

  useEffect(() => {
    let disposed = false
    fetch('/local-fonts.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : [])
      .then((data: unknown) => {
        if (!disposed && Array.isArray(data) && data.length) setFonts([...new Set(data.filter((name): name is string => typeof name === 'string' && Boolean(name.trim())))].sort((a, b) => a.localeCompare(b)))
      }).catch(() => {})
    return () => { disposed = true }
  }, [])

  const refreshFonts = async (): Promise<void> => {
    const query = (window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
    if (!query) { setMessage('可选择列表中的字体，或直接输入本机字体名称。'); return }
    try {
      const available = await query.call(window)
      setFonts([...new Set(available.map((item) => item.family))].sort((a, b) => a.localeCompare(b)))
      setMessage('本机字体已刷新')
    } catch { setMessage('可继续选择列表中的字体，或输入已安装字体名称。') }
  }
  const format = (): void => {
    if (!editor || editor.isDestroyed) return
    const next = editor.schema.nodeFromJSON(formatNovelDocument(editor.getJSON() as WritingNode))
    editor.chain().focus().command(({ tr }) => {
      tr.replaceWith(0, tr.doc.content.size, next.content)
      tr.setMeta('addToHistory', true)
      return true
    }).run()
    setMessage('已排版当前章节：首行空两格，段落间空一行；可撤销。')
  }
  return <div className="flex flex-wrap items-center gap-1" data-novel-writing-tools>
    <NovelSelectionToolbar editor={editor} />
    <label className="ml-1 flex items-center gap-1 text-[10px] text-ink-muted">字体
      <input aria-label="小说正文字体" list={listId} value={font} placeholder="默认字体" maxLength={200}
        onChange={(event) => { setFont(event.target.value); onFontChange(event.target.value.trim()) }}
        className="h-7 w-40 rounded border border-line bg-paper-card px-2 text-xs text-ink" />
    </label>
    <datalist id={listId}>{fonts.map((family) => <option key={family} value={family} />)}</datalist>
    <button type="button" onClick={() => void refreshFonts()} className="h-7 rounded border border-line px-2 text-[10px] text-ink-muted">读取本机字体</button>
    <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={format} disabled={!editor || editor.isDestroyed}
      title="一键排版当前章节" className="h-7 rounded border border-line bg-paper-card px-2 text-[10px] text-ink">一键排版</button>
    {message ? <span role="status" className="w-full px-1 text-[10px] text-ink-muted">{message}</span> : null}
  </div>
}
