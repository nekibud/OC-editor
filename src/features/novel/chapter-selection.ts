import type { Novel } from './types'

export function selectNovelChapters(novel: Novel, selected: ReadonlySet<string> | null): Novel {
  return selected === null ? novel : { ...novel, chapters: novel.chapters.filter(chapter => selected.has(chapter.id)) }
}
