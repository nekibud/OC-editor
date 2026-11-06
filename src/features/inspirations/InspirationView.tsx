'use client'

import { useEffect, useState } from 'react'
import { Plus, Lightbulb, Trash2 } from 'lucide-react'
import { useNavigation } from '@/components/layout/NavigationContext'
import { useWordCount } from '@/components/layout/WordCountContext'
import { AppConfirm } from '@/components/shared/AppConfirm'
import { MemoEditor } from './MemoEditor'
import { useInspirations, createInspiration, saveInspiration, deleteInspiration } from './store'
import { memoText, type Inspiration } from './types'

export function InspirationView() {
  const { activeItem } = useNavigation(), { items, loading } = useInspirations()
  const [selectedId, setSelectedId] = useState<string | null>(null), [search, setSearch] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Inspiration | null>(null), [error, setError] = useState('')
  const selected = items.find(item => item.id === selectedId)
  const { setWordCount, setWordCountLabel } = useWordCount()
  useEffect(() => {
    if (activeItem === '灵感') { setWordCountLabel('灵感字数'); setWordCount(memoText(selected?.content ?? '').replace(/\s/g, '').length) }
  }, [activeItem, selected?.content, setWordCount, setWordCountLabel])
  if (activeItem !== '灵感') return null
  return <div className="inspiration-view">
    <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-line px-5">
      <h1 className="flex items-center gap-2 font-serif text-lg text-ink"><Lightbulb size={19}/>灵感</h1>
      <button type="button" onClick={async () => { try { setSelectedId(await createInspiration()); setError('') } catch { setError('新建失败，请重试。') } }} className="flex h-8 items-center gap-1 rounded-lg bg-ink px-3 text-xs text-paper"><Plus size={14}/>新建灵感</button>
    </header>
    {error ? <p role="alert" className="px-5 py-2 text-xs text-error">{error}</p> : null}
    <div className="inspiration-workspace">
      <aside className="inspiration-list border-r border-line">
        <input aria-label="搜索灵感" placeholder="搜索标题或内容…" value={search} onChange={event => setSearch(event.target.value)} className="m-3 h-8 rounded-lg border border-line bg-paper-card px-3 text-xs text-ink outline-none"/>
        <div className="inspiration-cards">
          {items.filter(item => `${item.title} ${memoText(item.content)}`.toLowerCase().includes(search.toLowerCase())).map(item => <div key={item.id} className={`group relative rounded-lg border p-3 ${selectedId === item.id ? 'border-line-hover bg-paper-card' : 'border-line hover:bg-paper-card/60'}`}>
            <button type="button" onClick={() => setSelectedId(item.id)} className="block w-full pr-5 text-left" aria-label={`打开灵感：${item.title || '未命名灵感'}`}>
              <h2 className="truncate text-sm text-ink">{item.title || '未命名灵感'}</h2>
              <p className="mt-1 truncate text-xs text-ink-muted">{memoText(item.content) || (item.content.includes('image-block') ? '图片灵感' : '还没有内容')}</p>
              <p className="mt-2 text-[10px] text-ink-faint">{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</p>
            </button>
            <button type="button" aria-label={`删除灵感：${item.title || '未命名灵感'}`} onClick={() => setPendingDelete(item)} className="absolute right-2 top-3 text-ink-faint hover:text-error"><Trash2 size={12}/></button>
          </div>)}
          {!items.length ? <p className="p-4 text-xs text-ink-faint">{loading ? '正在加载…' : '点击“新建灵感”，记录文字和图片。'}</p> : null}
        </div>
      </aside>
      <main className="inspiration-content">
        {selected ? <MemoEditor key={selected.id} title={selected.title} content={selected.content} onSave={draft => saveInspiration(selected.id, draft)}/> : <div className="flex h-full items-center justify-center text-sm text-ink-faint">选择或新建一条灵感</div>}
      </main>
    </div>
    <AppConfirm open={Boolean(pendingDelete)} title="删除灵感" description="删除后，小说中已引用的内容会保留为独立笔记。" confirmLabel="删除" danger
      onCancel={() => setPendingDelete(null)} onConfirm={() => { if (pendingDelete) void deleteInspiration(pendingDelete.id).then(() => setPendingDelete(null)).catch(() => setError('删除失败，请重试。')) }}/>
  </div>
}
