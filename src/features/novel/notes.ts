import type { Novel, NovelNote } from './types'
import type { Inspiration } from '../inspirations/types'
import { memoText } from '../inspirations/types'

export function novelNotes(novel: Novel): NovelNote[] {
  return novel.noteItems ?? (novel.notes ? [{ id: 'legacy-note', text: novel.notes }] : [])
}

export function noteHtml(note: NovelNote): string {
  if (note.content !== undefined) return note.content
  return note.text.split('\n').map(line => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('')
}

export function inspirationNote(inspiration: Inspiration): NovelNote {
  return { id: crypto.randomUUID(), inspirationId: inspiration.id, title: inspiration.title, content: inspiration.content, text: memoText(inspiration.content) }
}

export function detachInspiration(notes: NovelNote[], inspiration: Inspiration): NovelNote[] {
  return notes.map(note => {
    if (note.inspirationId !== inspiration.id) return note
    const snapshot = { ...note }
    delete snapshot.inspirationId
    return { ...snapshot, title: inspiration.title, content: inspiration.content, text: memoText(inspiration.content) }
  })
}
