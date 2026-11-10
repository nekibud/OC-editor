export interface Inspiration {
  worldId?: number
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

export function memoText(html: string): string {
  const entities: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
  return html.replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, entity => entities[entity]).replace(/\s+/g, ' ').trim()
}
