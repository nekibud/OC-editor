'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X, Lightbulb, Trash2 } from 'lucide-react'
import { useInspirations, addNovelNote, removeNovelNote, updateNovelNote } from '../inspirations/store'
import { MemoEditor } from '../inspirations/MemoEditor'
import { memoText } from '../inspirations/types'
import { novelNotes, noteHtml } from './notes'
import type { Novel } from './types'

export function NovelNotesSidebar({ novel, activeId, onSelect }: { novel: Novel; activeId: string | null; onSelect: (id: string) => void }) {
  const { items } = useInspirations()
  const [pickerOpen, setPickerOpen] = useState(false), [search, setSearch] = useState(''), [error, setError] = useState('')
  const notes = novelNotes(novel)
  const add = async (inspirationId?: string): Promise<void> => {
    try { const id = await addNovelNote(novel.id!, inspirationId); onSelect(id); setPickerOpen(false); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '添加失败，请重试。') }
  }
  return <>
    <section className="novel-notes" aria-label="笔记">
      <div className="novel-notes-inner">
        <div className="mb-2 flex items-center justify-between gap-1">
          <p className="text-[10px] text-ink-faint">笔记</p>
          <div className="flex items-center gap-1">
            <button type="button" title="添加一条笔记" aria-label="添加一条笔记" onClick={() => void add()} className="flex h-6 items-center gap-0.5 rounded px-1 text-[10px] text-ink-muted hover:bg-black/5 dark:hover:bg-white/5"><Plus size={12}/>新建</button>
            <button type="button" title="添加已有灵感" onClick={() => { setSearch(''); setPickerOpen(true) }} className="flex h-6 items-center gap-0.5 rounded px-1 text-[10px] text-ink-muted hover:bg-black/5 dark:hover:bg-white/5"><Lightbulb size={12}/>添加灵感</button>
          </div>
        </div>
        {error ? <p role="alert" className="text-[10px] text-error">{error}</p> : null}
        <div className="novel-note-list space-y-1.5">
          {notes.map(note => {
            const inspiration = items.find(item => item.id === note.inspirationId)
            const title = inspiration?.title || note.title || note.text.split('\n')[0].slice(0, 24) || '未命名笔记'
            const preview = memoText(inspiration?.content ?? noteHtml(note))
            return <div key={note.id} className={`group relative rounded-lg border ${activeId === note.id ? 'border-line-hover bg-paper-card' : 'border-line'}`}>
              <button type="button" onClick={() => onSelect(note.id)} aria-label={`打开笔记：${title}`} aria-pressed={activeId === note.id} className="block w-full px-2 py-2 pr-7 text-left">
                <span className="block truncate text-xs text-ink">{title}</span>
                <span className="mt-1 block truncate text-[10px] text-ink-faint">{inspiration ? '灵感 · ' : ''}{preview || '点击编辑文字和图片'}</span>
              </button>
              <button type="button" title="移除这条笔记" aria-label={`移除笔记：${title}`} onClick={() => void removeNovelNote(novel.id!, note.id).catch(() => setError('移除失败，请重试。'))} className="absolute right-1 top-2 text-ink-faint hover:text-error"><Trash2 size={11}/></button>
            </div>
          })}
          {!notes.length ? <p className="rounded-lg border border-dashed border-line px-2 py-2 text-[10px] leading-4 text-ink-faint">记录章节想法，或添加已写好的灵感。</p> : null}
        </div>
      </div>
    </section>
    {pickerOpen ? createPortal(<dialog ref={node => { if (node && !node.open) node.showModal() }} aria-label="添加灵感" onClose={() => setPickerOpen(false)} className="inspiration-picker rounded-xl border border-line bg-paper text-ink shadow-lg">
      <div className="flex items-center justify-between border-b border-line p-4"><h3 className="font-serif text-base">添加已有灵感</h3><button type="button" aria-label="关闭灵感选择" onClick={() => setPickerOpen(false)}><X size={16}/></button></div>
      <div className="p-4"><input autoFocus aria-label="查找灵感" placeholder="搜索标题或内容…" value={search} onChange={event => setSearch(event.target.value)} className="h-8 w-full rounded-lg border border-line bg-paper-card px-3 text-xs text-ink outline-none"/>
        <div className="inspiration-picker-items">{items.filter(item => `${item.title} ${memoText(item.content)}`.toLowerCase().includes(search.toLowerCase())).map(item => <button type="button" key={item.id} onClick={() => void add(item.id)} aria-label={`添加灵感：${item.title || '未命名灵感'}`} className="block w-full rounded-lg border border-line p-3 text-left hover:bg-paper-card">
          <span className="block truncate text-sm">{item.title || '未命名灵感'}</span><span className="mt-1 block truncate text-xs text-ink-muted">{memoText(item.content)}</span>
          {notes.some(note => note.inspirationId === item.id) ? <span className="text-[10px] text-ink-faint">已添加，点击打开</span> : null}
        </button>)}</div>
        {!items.length ? <p className="mt-4 text-xs text-ink-faint">还没有灵感，可先在“创作 → 灵感”中记录。</p> : null}
      </div>
    </dialog>, document.body) : null}
  </>
}

export function NovelNotePanel({ novel, activeId, onClose }: { novel: Novel; activeId: string | null; onClose: () => void }) {
  const { items } = useInspirations()
  const note = novelNotes(novel).find(item => item.id === activeId)
  if (!note) return null
  const inspiration = items.find(item => item.id === note.inspirationId)
  return <aside className="novel-note-panel border-r border-line bg-paper" aria-label="展开的笔记">
    <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
      <div><h3 className="text-xs text-ink">{inspiration ? '灵感笔记' : '小说笔记'}</h3>{inspiration ? <p className="mt-1 text-[10px] text-ink-faint">修改会同步到灵感库</p> : null}</div>
      <button type="button" aria-label="收起笔记" title="收起笔记" onClick={onClose} className="rounded p-1 text-ink-muted"><X size={15}/></button>
    </header>
    <MemoEditor key={`${novel.id}:${note.id}`} label="笔记" title={inspiration?.title ?? note.title ?? ''} content={inspiration?.content ?? noteHtml(note)}
      onSave={draft => updateNovelNote(novel.id!, note.id, draft)}/>
  </aside>
}
