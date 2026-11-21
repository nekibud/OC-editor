'use client'

import { useEffect, useState } from 'react'
import { EN } from './i18n-en'

export type Locale = 'zh' | 'en'

const STORAGE_KEY = 'oc-editor-language'
const CHANGE_EVENT = 'oc-language-changed'

export function localeDateCode(): string {
  return getLocale() === 'en' ? 'en-US' : 'zh-CN'
}

export function getLocale(): Locale {
  if (typeof window === 'undefined') return 'zh'
  const fromUrl = new URLSearchParams(window.location.search).get('lang')
  if (fromUrl === 'en' || fromUrl === 'zh') return fromUrl
  return window.localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh'
}

export function setLocale(locale: Locale): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, locale)
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
  document.documentElement.dataset.locale = locale
  window.dispatchEvent(new Event(CHANGE_EVENT))
  applyLanguage()
}

export function useLocale(): { locale: Locale; toggleLocale: () => void } {
  const [locale, setLocaleState] = useState<Locale>('zh')

  useEffect(() => {
    setLocaleState(getLocale())
    const handler = (): void => setLocaleState(getLocale())
    window.addEventListener(CHANGE_EVENT, handler)
    return () => window.removeEventListener(CHANGE_EVENT, handler)
  }, [])

  return {
    locale,
    toggleLocale: () => setLocale(locale === 'zh' ? 'en' : 'zh'),
  }
}

/** 动态数量/单位：词典无法穷举，只翻译安全的固定模式。 */
type DynamicReplacement = string | ((match: RegExpMatchArray) => string)

const DYNAMIC: Array<[RegExp, DynamicReplacement]> = [
  [/^(\d+)\s*个角色$/, '$1 characters'],
  [/^(\d+)\s*个事件$/, '$1 events'],
  [/^(\d+)\s*个国家$/, '$1 countries'],
  [/^(\d+)\s*个词条$/, '$1 entries'],
  [/^(\d+)\s*个分类$/, '$1 categories'],
  [/^(\d+)\s*个条目$/, '$1 items'],
  [/^(\d+)\s*张地图$/, '$1 maps'],
  [/^(\d+)\s*个时期$/, '$1 periods'],
  [/^(\d+)\s*条关系$/, '$1 relations'],
  [/^(\d+)\s*个字$/, '$1 characters'],
  [/^第\s*(\d+)\s*章$/, 'Chapter $1'],
  [/^(\d+)\s*年$/, '$1 years'],
  [/^(\d+)\s*月$/, '$1 months'],
  [/^(\d+)\s*日$/, '$1 days'],
  [/^(\d+)\s*小时$/, '$1 hours'],
  [/^(\d+)\s*分钟$/, '$1 minutes'],
  [/^已复制(.+)$/, (match) => `Copied ${EN[match[1]] ?? match[1]}`],
  [/^导出成功：(.+)$/, 'Exported: $1'],
  [/^已导出(.+)：(.+)$/, (match) => `Exported ${EN[match[1].trim()] ?? match[1].trim()}: ${match[2]}`],
  [/^已导出分类：(.+)$/, 'Exported category: $1'],
  [/^已导入(.+)：(.+)$/, (match) => `Imported ${EN[match[1].trim()] ?? match[1].trim()}: ${match[2]}`],
  [/^导出本分类（(.+)）$/, (match) => `Export this category (${EN[match[1].trim()] ?? match[1].trim()})`],
  [/^新建(.+)文件夹$/, (match) => `New ${EN[match[1].trim()] ?? match[1].trim()} folder`],
  [/^只导出当前(.+)分类，导入时自动识别为角色数据$/, (match) => `Export only the current ${EN[match[1].trim()] ?? match[1].trim()} category; imported as character data`],
  [/^未分类中暂无(.+)$/, (match) => `No ${EN[match[1].trim()] ?? match[1].trim()} in Uncategorized`],
  [/^这个文件夹里还没有(.+)$/, (match) => `No ${EN[match[1].trim()] ?? match[1].trim()} in this folder yet`],
  [/^删除「(.+)」字段$/, 'Delete “$1” field'],
  [/^已导出全部角色：(.+)$/, 'Exported all characters: $1'],
  [/^已导出未分类角色：(.+)$/, 'Exported uncategorized characters: $1'],
  [/^已导出文件夹：(.+)$/, 'Exported folder: $1'],
  [/^事件 #(\d+)$/, 'Event #$1'],
  [/^国家 #(\d+)$/, 'Country #$1'],
  [/^角色图片-(\d+)$/, 'Character image $1'],
  [/^ZIP 备份已导出：(.+)$/, 'ZIP backup exported: $1'],
  [/^新增\s*(\d+)\s*条$/, '$1 added'],
  [/^跳过\s*(\d+)\s*条$/, '$1 skipped'],
  [/^覆盖\s*(\d+)\s*条$/, '$1 overwritten'],
  [/^补齐关联\s*(\d+)\s*条$/, '$1 links added'],
  [/^同步关系\s*(\d+)\s*条$/, '$1 relations synced'],
  [/^导入完成：(.+)$/, 'Import complete: $1'],
  [/^(.+?)\s*·\s*相关国家$/, (match) => `${EN[match[1].trim()] ?? match[1].trim()} · Related countries`],
  [/^(.+?)\s*·\s*相关事件$/, (match) => `${EN[match[1].trim()] ?? match[1].trim()} · Related events`],
  [/^(.+?)\s*·\s*相关世界观$/, (match) => `${EN[match[1].trim()] ?? match[1].trim()} · Related world entries`],
  [/^共\s*(\d+)\s*个(.+)$/, (match) => `${match[1]} ${EN[match[2]] ?? match[2]}`],
  [/^(.+)\s*·\s*拖动移动，右下角缩放$/, '$1 · Drag to move, resize from the bottom-right'],
  [/^确定删除分类「(.+)」？其中的所有条目和关联关系都会删除，原人物、国家等内容不会受影响。$/, 'Delete category “$1”? All its entries and links will be deleted; characters and countries themselves will not be affected.'],
  [/^确定删除「(.+)」？$/, 'Delete “$1”?'],
  [/^搜索(.+)\.\.\.$/, 'Search $1...'],
  [/^新建(.+)文件夹$/, 'New $1 folder'],
]

function translateCore(core: string): string {
  const direct = EN[core]
  if (direct) return direct
  for (const [pattern, replacement] of DYNAMIC) {
    const match = core.match(pattern)
    if (!match) continue
    if (typeof replacement === 'function') return replacement(match)
    return core.replace(pattern, replacement)
  }
  return core
}

export function translateText(raw: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw)
  if (!match) return raw
  const [, leading, core, trailing] = match
  if (!/[\u3400-\u9fff]/.test(core)) return raw
  const translated = translateCore(core.replace(/\s+/g, ' ').trim())
  return translated === core.replace(/\s+/g, ' ').trim()
    ? raw
    : `${leading}${translated}${trailing}`
}

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-placeholder'] as const
const TEXT_STATE = new WeakMap<Text, { source: string; rendered: string }>()
const ATTR_STATE = new WeakMap<Element, Map<string, { source: string; rendered: string }>>()

function isExcluded(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!element) return false
  return Boolean(
    element.closest(
      'script, style, noscript, textarea, code, pre, [contenteditable="true"], [data-no-i18n]',
    ),
  )
}

function translateTextNode(node: Text, locale: Locale): void {
  if (isExcluded(node)) return
  const previous = TEXT_STATE.get(node)
  if (locale === 'zh') {
    if (previous && node.nodeValue === previous.rendered) node.nodeValue = previous.source
    return
  }
  const source = previous && node.nodeValue === previous.rendered ? previous.source : node.nodeValue ?? ''
  const rendered = translateText(source)
  TEXT_STATE.set(node, { source, rendered })
  if (node.nodeValue !== rendered) node.nodeValue = rendered
}

function translateAttributes(element: Element, locale: Locale): void {
  if (element.closest('[data-no-i18n]')) return
  let states = ATTR_STATE.get(element)
  if (!states) {
    states = new Map()
    ATTR_STATE.set(element, states)
  }
  for (const attr of ATTRS) {
    const value = element.getAttribute(attr)
    if (value === null || !/[\u3400-\u9fff]/.test(value)) continue
    const previous = states.get(attr)
    if (locale === 'zh') {
      if (previous && value === previous.rendered) element.setAttribute(attr, previous.source)
      continue
    }
    const source = previous && value === previous.rendered ? previous.source : value
    const rendered = translateText(source)
    states.set(attr, { source, rendered })
    if (value !== rendered) element.setAttribute(attr, rendered)
  }
}

function translateTree(root: Node, locale: Locale): void {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text, locale)
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return
  if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root as Element, locale)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    translateTextNode(node as Text, locale)
    node = walker.nextNode()
  }
  if (root.nodeType === Node.ELEMENT_NODE) {
    for (const element of (root as Element).querySelectorAll('*')) translateAttributes(element, locale)
  }
}

function applyLanguage(): void {
  if (typeof window === 'undefined') return
  const locale = getLocale()
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
  document.documentElement.dataset.locale = locale
  translateTree(document.body, locale)
}

export function LanguageTranslator(): null {
  useEffect(() => {
    applyLanguage()
    let editingField = false
    const isField = (target: EventTarget | null): boolean => {
      const element = target instanceof Element ? target : null
      return Boolean(element?.closest('input, textarea, [contenteditable="true"]'))
    }
    const onFocusIn = (event: FocusEvent): void => {
      if (isField(event.target)) editingField = true
    }
    const onFocusOut = (): void => {
      window.setTimeout(() => {
        editingField = isField(document.activeElement)
        if (!editingField && getLocale() === 'en') applyLanguage()
      }, 0)
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    const observer = new MutationObserver((mutations) => {
      // 输入法/改名输入框获得焦点时不要改写 DOM，
      // 否则翻译节点和 React 受控输入会互相触发，造成卡死。
      if (editingField || getLocale() !== 'en') return
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          translateTextNode(mutation.target as Text, 'en')
        } else if (mutation.type === 'attributes') {
          translateAttributes(mutation.target as Element, 'en')
        } else {
          for (const node of mutation.addedNodes) translateTree(node, 'en')
        }
      }
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRS],
    })
    return () => {
      observer.disconnect()
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])
  return null
}
