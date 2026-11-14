'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { EditorCore } from '@/components/editor/EditorCore'
import { saveBlobToDisk } from '@/lib/image-service'

export function MemoEditor({ title, content, label = '灵感', onSave }: {
  title: string
  content: string
  label?: string
  onSave: (draft: { title: string; content: string }) => Promise<void>
}) {
  const [draftTitle, setTitle] = useState(title), [status, setStatus] = useState('已保存'), [error, setError] = useState('')
  const draft = useRef({ title, content }), queued = useRef<{ title: string; content: string } | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve()), save = useRef(onSave), timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true), editor = useRef<Editor | null>(null), input = useRef<HTMLInputElement>(null)
  useEffect(() => { save.current = onSave }, [onSave])
  const flush = useCallback((): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const snapshot = draft.current
    if (queued.current === snapshot) return queue.current
    queued.current = snapshot
    const persist = save.current
    const writing = queue.current.catch(() => {}).then(() => persist(snapshot))
    queue.current = writing
    void writing.then(() => {
      if (mounted.current && snapshot === draft.current) { setStatus('已保存'); setError('') }
    }).catch(cause => {
      if (queued.current === snapshot) queued.current = null
      if (mounted.current) { setStatus('保存失败'); setError(cause instanceof Error ? cause.message : '保存失败，请重试。') }
    })
    return writing
  }, [])
  useEffect(() => {
    mounted.current = true
    const onHide = (): void => { if (queued.current || timer.current) void flush().catch(() => {}) }
    window.addEventListener('pagehide', onHide)
    return () => { mounted.current = false; window.removeEventListener('pagehide', onHide); if (queued.current || timer.current) void flush().catch(() => {}) }
  }, [flush])
  const change = (next: Partial<{ title: string; content: string }>): void => {
    draft.current = { ...draft.current, ...next }
    setStatus('待保存')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush().catch(() => {}) }, 350)
  }
  const insertImage = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      const src = await saveBlobToDisk(file, 'gallery')
      if (editor.current && !editor.current.isDestroyed) editor.current.chain().focus().insertContent({ type: 'imageBlock', attrs: { src, width: 240 } }).run()
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '图片读取失败。') }
    finally { if (input.current) input.current.value = '' }
  }
  return <div className="memo-editor" data-memo-editor aria-label={`${label}编辑器`}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node) && timer.current) void flush().catch(() => {}) }}>
    <input aria-label={`${label}标题`} placeholder="标题" value={draftTitle}
      onChange={event => { setTitle(event.target.value); change({ title: event.target.value }) }}
      onBlur={() => { if (timer.current) void flush().catch(() => {}) }}
      className="memo-title bg-transparent font-serif text-xl text-ink outline-none placeholder:text-ink-faint"/>
    <div className="memo-tools border-b border-line text-xs text-ink-muted">
      <button type="button" onClick={() => input.current?.click()} className="flex items-center gap-1 rounded border border-line px-2 py-1">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/></svg>插入图片
      </button>
      <input ref={input} type="file" accept="image/*" aria-label={`${label}图片`} className="hidden" onChange={event => void insertImage(event.target.files?.[0])}/>
      <span role="status" className="ml-auto text-[10px] text-ink-faint">{status}</span>
      <button type="button" onClick={() => void flush().catch(() => {})} className="rounded border border-line px-2 py-1">保存</button>
    </div>
    {error ? <p role="alert" className="text-xs text-error">{error}</p> : null}
    <div className="memo-body">
      <EditorCore plain hideBubbleMenu hideContextMenu preserveWhitespace content={content} placeholder="记下想法、片段或待办…"
        onReady={ready => { editor.current = ready; ready.on('update', () => change({ content: ready.getHTML() })) }}/>
    </div>
  </div>
}
