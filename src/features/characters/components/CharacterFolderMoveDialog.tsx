'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Folder, FolderPlus, Loader2 } from 'lucide-react'
import type { Character } from '@/types'
import type { CharacterFolder } from '../folders'

export function CharacterFolderMoveDialog({ targets, folders, kindLabel, onMove, onCreateFolder, onClose }: {
  targets: Character[]
  folders: CharacterFolder[]
  kindLabel: string
  onMove: (folderId: string | null) => Promise<void>
  onCreateFolder: (name: string) => CharacterFolder
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [creating, setCreating] = useState(false), [name, setName] = useState('')
  const move = async (folderId: string | null, newName?: string): Promise<void> => {
    if (busy) return
    setBusy(true); setError('')
    try { await onMove(newName ? onCreateFolder(newName).id : folderId) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '加入文件夹失败，请重试。'); setBusy(false) }
  }
  return createPortal(<dialog ref={node => { if (node && !node.open) node.showModal() }} aria-label="移动到文件夹"
    className="rounded-xl border border-line bg-paper p-4 text-ink shadow-xl"
    style={{ margin: 'auto', width: 'min(360px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)' }}
    onCancel={event => { if (busy) event.preventDefault() }} onClose={() => { if (!busy) onClose() }}>
    <h3 className="font-serif text-base">{targets.length === 1 ? `移动「${targets[0].name}」` : `将 ${targets.length} 个${kindLabel}加入文件夹`}</h3>
    <p className="mt-1 text-[11px] text-ink-muted">选择目标文件夹，所选条目会移入该文件夹。</p>
    {targets.length > 1 ? <p className="mt-2 truncate text-xs text-ink-faint" title={targets.map(item => item.name).join('、')}>{targets.map(item => item.name).join('、')}</p> : null}
    <div className="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
      {[{ id: null, name: '未分类' }, ...folders].map(folder => <button type="button" key={folder.id ?? 'none'} disabled={busy} onClick={() => void move(folder.id)}
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 ${targets.every(item => (item.folderId ?? null) === folder.id) ? 'border-line-hover bg-paper-card text-ink' : 'border-line text-ink-muted hover:border-line-hover hover:text-ink'}`}>
        <Folder size={14} strokeWidth={2}/><span className="truncate">{folder.name}</span>
      </button>)}
    </div>
    {creating ? <form className="mt-3" onSubmit={event => { event.preventDefault(); if (name.trim()) void move(null, name.trim()) }}>
      <input autoFocus aria-label="新文件夹名称" placeholder="输入文件夹名称" value={name} disabled={busy} onChange={event => setName(event.target.value)} className="h-9 w-full rounded-lg border border-line bg-paper-card px-3 text-sm outline-none focus:border-line-hover"/>
      <button type="submit" disabled={busy || !name.trim()} className="mt-2 h-8 rounded-lg bg-ink px-3 text-xs text-paper disabled:opacity-40">创建并加入</button>
    </form> : <button type="button" disabled={busy} onClick={() => setCreating(true)} className="mt-3 flex w-full items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-left text-xs text-ink-muted hover:border-line-hover"><FolderPlus size={14}/>新建文件夹</button>}
    {error ? <p role="alert" className="mt-3 text-xs text-error">{error}</p> : null}
    <footer className="mt-4 flex items-center justify-end gap-2">{busy ? <span role="status" className="mr-auto flex items-center gap-1 text-xs text-ink-muted"><Loader2 size={13} className="animate-spin"/>正在加入…</span> : null}<button type="button" disabled={busy} onClick={onClose} className="h-8 rounded-lg border border-line px-3 text-xs text-ink-muted disabled:opacity-40">取消</button></footer>
  </dialog>, document.body)
}
