'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, ImagePlus, Link2, Plus, Save, Trash2, Type, UserRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { downloadBlob } from '@/lib/zip'
import { searchAllEntitiesFlat } from '@/lib/reference-registry'

type LayerType = 'image' | 'text' | 'link'

interface CardLayer {
  id: string
  type: LayerType
  x: number
  y: number
  width: number
  height: number
  imageUrl?: string
  text?: string
  fontSize?: number
  color?: string
  bold?: boolean
  targetId?: number
  targetType?: string
  targetName?: string
}

interface CharacterCard {
  id: string
  name: string
  backgroundUrl: string
  width: number
  height: number
  layers: CardLayer[]
  createdAt: number
  updatedAt: number
}

interface CharacterCardStudioProps {
  onNavigate: (id: number, type?: string) => void
}

const STORAGE_KEY = 'oc-character-card-library'
const CARD_WIDTH = 900
const CARD_HEIGHT = 1200
const DEFAULT_BG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#F3EFE9"/><stop offset="1" stop-color="#E7E3DC"/>
    </linearGradient>
    <linearGradient id="ink" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#C49A4A"/><stop offset="1" stop-color="#6E6A63"/>
    </linearGradient>
  </defs>
  <rect width="900" height="1200" fill="url(#bg)"/>
  <rect x="34" y="34" width="832" height="1132" rx="26" fill="none" stroke="#C9C2B6" stroke-width="2"/>
  <rect x="34" y="34" width="832" height="16" rx="8" fill="url(#ink)"/>
  <text x="62" y="105" font-family="Georgia,serif" font-size="24" fill="#6E6A63" letter-spacing="6">OC EDITOR</text>
  <text x="62" y="152" font-family="Georgia,serif" font-size="52" fill="#2E2B27">CHARACTER CARD</text>
  <line x1="62" y1="180" x2="838" y2="180" stroke="#C9C2B6"/>
  <rect x="62" y="214" width="258" height="340" rx="14" fill="#DED7CC" stroke="#C9C2B6"/>
  <text x="191" y="396" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#8C857A">角色图片</text>
  <rect x="350" y="214" width="488" height="112" rx="14" fill="#F8F5F0" stroke="#C9C2B6"/>
  <text x="374" y="258" font-family="sans-serif" font-size="18" fill="#8C857A">NAME</text>
  <rect x="350" y="346" width="488" height="208" rx="14" fill="#F8F5F0" stroke="#C9C2B6"/>
  <text x="374" y="390" font-family="sans-serif" font-size="18" fill="#8C857A">PROFILE</text>
  <rect x="62" y="586" width="776" height="280" rx="14" fill="#F8F5F0" stroke="#C9C2B6"/>
  <text x="86" y="630" font-family="sans-serif" font-size="18" fill="#8C857A">STORY</text>
  <rect x="62" y="898" width="776" height="156" rx="14" fill="#F8F5F0" stroke="#C9C2B6"/>
  <text x="86" y="942" font-family="sans-serif" font-size="18" fill="#8C857A">RELATIONS</text>
  <text x="62" y="1110" font-family="sans-serif" font-size="16" fill="#8C857A">Made with OC editor · local-first</text>
</svg>`)}`

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function loadCards(): CharacterCard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CharacterCard[]) : []
  } catch {
    return []
  }
}

function saveCards(cards: CharacterCard[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards))
}

function defaultLayers(): CardLayer[] {
  return [
    { id: uid('layer'), type: 'image', x: 62, y: 214, width: 258, height: 340 },
    { id: uid('layer'), type: 'text', x: 374, y: 286, width: 430, height: 50, text: '角色名字', fontSize: 36, color: '#2E2B27', bold: true },
    { id: uid('layer'), type: 'text', x: 374, y: 418, width: 430, height: 120, text: '种族 · 身份 · 阵营', fontSize: 20, color: '#6E6A63' },
    { id: uid('layer'), type: 'text', x: 86, y: 662, width: 720, height: 170, text: '在这里写角色简介。', fontSize: 22, color: '#2E2B27' },
    { id: uid('layer'), type: 'link', x: 86, y: 974, width: 260, height: 40, text: '@相关角色', fontSize: 20, color: '#8A6A2F' },
  ]
}

function newCard(): CharacterCard {
  const now = Date.now()
  return {
    id: uid('card'),
    name: '未命名角色卡',
    backgroundUrl: DEFAULT_BG,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    layers: defaultLayers(),
    createdAt: now,
    updatedAt: now,
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const char of text) {
    const next = line + char
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = char
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

async function renderCard(card: CharacterCard): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = card.width
  canvas.height = card.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  const background = await loadImage(card.backgroundUrl)
  ctx.drawImage(background, 0, 0, card.width, card.height)
  for (const layer of card.layers) {
    if (layer.type === 'image' && layer.imageUrl) {
      const image = await loadImage(layer.imageUrl)
      ctx.drawImage(image, layer.x, layer.y, layer.width, layer.height)
      continue
    }
    ctx.fillStyle = layer.color || '#2E2B27'
    ctx.font = `${layer.bold ? '700 ' : ''}${layer.fontSize || 20}px "Noto Sans SC", "Microsoft YaHei", sans-serif`
    ctx.textBaseline = 'top'
    const lines = wrapText(ctx, layer.text || '', layer.width)
    const lineHeight = (layer.fontSize || 20) * 1.45
    lines.slice(0, Math.max(1, Math.floor(layer.height / lineHeight))).forEach((line, index) => {
      ctx.fillText(line, layer.x, layer.y + index * lineHeight)
    })
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('导出失败'))), 'image/png')
  })
}

export function CharacterCardStudio({ onNavigate }: CharacterCardStudioProps) {
  const [cards, setCards] = useState<CharacterCard[]>([])
  const [draft, setDraft] = useState<CharacterCard | null>(null)
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const [entities, setEntities] = useState<Array<{ id: string; name: string; type: string }>>([])
  const [busy, setBusy] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const imageFileRef = useRef<HTMLInputElement>(null)
  const imageTargetRef = useRef<string | null>(null)

  useEffect(() => {
    const loaded = loadCards()
    setCards(loaded)
  }, [])

  useEffect(() => {
    if (!linkPickerOpen) return
    void searchAllEntitiesFlat('').then((rows) =>
      setEntities(rows.map((row) => ({ id: String(row.id), name: row.name, type: row.type }))),
    )
  }, [linkPickerOpen])

  useEffect(() => {
    if (!dragRef.current) return
    const move = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || !stageRef.current) return
      const rect = stageRef.current.getBoundingClientRect()
      const dx = ((event.clientX - drag.startX) / rect.width) * (draft?.width || CARD_WIDTH)
      const dy = ((event.clientY - drag.startY) / rect.height) * (draft?.height || CARD_HEIGHT)
      setDraft((current) =>
        current
          ? {
              ...current,
              layers: current.layers.map((layer) =>
                layer.id === drag.id
                  ? { ...layer, x: Math.round(drag.x + dx), y: Math.round(drag.y + dy) }
                  : layer,
              ),
            }
          : current,
      )
    }
    const up = () => {
      dragRef.current = null
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [draft?.height, draft?.width])

  const selectedLayer = draft?.layers.find((layer) => layer.id === selectedLayerId) ?? null

  const persist = useCallback((card: CharacterCard, announce = true) => {
    const nextCard = { ...card, updatedAt: Date.now() }
    const next = [...loadCards().filter((item) => item.id !== nextCard.id), nextCard]
    saveCards(next)
    setCards(next)
    setDraft(nextCard)
    if (announce) toast.success('已保存到角色卡仓库')
  }, [])

  const renameCard = (card: CharacterCard, event: React.MouseEvent): void => {
    event.stopPropagation()
    const name = window.prompt('角色卡名称', card.name)?.trim()
    if (!name) return
    const next = cards.map((item) => (item.id === card.id ? { ...item, name, updatedAt: Date.now() } : item))
    saveCards(next)
    setCards(next)
    if (draft?.id === card.id) setDraft({ ...draft, name })
  }
  const beginNew = (): void => {
    const card = newCard()
    setDraft(card)
    setSelectedLayerId(null)
    setPreview(false)
  }

  const openCard = (card: CharacterCard): void => {
    setDraft(card)
    setSelectedLayerId(null)
    setPreview(false)
  }

  const addLayer = (type: LayerType): void => {
    if (!draft) return
    const layer: CardLayer = {
      id: uid('layer'),
      type,
      x: 120,
      y: 380,
      width: type === 'text' ? 420 : 220,
      height: type === 'text' ? 80 : 160,
      text: type === 'text' ? '双击编辑文字' : type === 'link' ? '@相关角色' : undefined,
      fontSize: 22,
      color: '#2E2B27',
    }
    setDraft({ ...draft, layers: [...draft.layers, layer] })
    setSelectedLayerId(layer.id)
  }

  const updateLayer = (id: string, patch: Partial<CardLayer>): void => {
    setDraft((current) =>
      current
        ? { ...current, layers: current.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)) }
        : current,
    )
  }

  const removeLayer = (id: string): void => {
    setDraft((current) => (current ? { ...current, layers: current.layers.filter((layer) => layer.id !== id) } : current))
    setSelectedLayerId(null)
  }

  const chooseBackground = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    if (!file || !draft) return
    const reader = new FileReader()
    reader.onload = () => setDraft({ ...draft, backgroundUrl: String(reader.result) })
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  const chooseLayerImage = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    const layerId = imageTargetRef.current
    if (!file || !layerId) return
    const reader = new FileReader()
    reader.onload = () => updateLayer(layerId, { imageUrl: String(reader.result) })
    reader.readAsDataURL(file)
    event.target.value = ''
    imageTargetRef.current = null
  }

  const exportCurrent = async (): Promise<void> => {
    if (!draft) return
    setBusy(true)
    try {
      const blob = await renderCard(draft)
      downloadBlob(blob, `${draft.name || '角色卡'}.png`)
      toast.success('角色卡已导出 PNG')
    } catch {
      toast.error('导出失败，请检查背景/图片')
    } finally {
      setBusy(false)
    }
  }

  if (!draft) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl text-ink">角色卡仓库</h1>
            <p className="mt-1 text-xs text-ink-muted">本地角色卡模板与成品；与关系图独立，仅 @ 引用会跳转。</p>
          </div>
          <button onClick={beginNew} className="touch-feedback flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm text-paper">
            <Plus size={15} strokeWidth={2} /> 新建角色卡
          </button>
        </div>
        {cards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-ink-muted">
            还没有角色卡。新建一张，或先从默认模板开始。
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <button key={card.id} onClick={() => openCard(card)} className="touch-feedback overflow-hidden rounded-xl border border-line bg-paper-card text-left">
                <div className="aspect-[3/4] overflow-hidden bg-paper-alt">
                  <img src={card.backgroundUrl} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="p-3">
                  <p className="truncate text-sm text-ink">{card.name}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-[10px] text-ink-faint">{new Date(card.updatedAt).toLocaleString('zh-CN')}</p>
                    <button onClick={(event) => renameCard(card, event)} className="text-[10px] text-ink-faint hover:text-ink">重命名</button>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const selected = selectedLayer

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 md:p-5 lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-64">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-xl text-ink">角色卡制作</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => { setDraft(null); setPreview(false); setSelectedLayerId(null) }} className="text-[10px] text-ink-faint hover:text-ink">仓库</button>
            <button onClick={beginNew} className="text-[10px] text-ink-faint hover:text-ink">新建</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => fileRef.current?.click()} className="touch-feedback flex h-8 items-center gap-1 rounded-lg border border-line px-2 text-[11px] text-ink-muted">
            <ImagePlus size={13} /> 自定义模板
          </button>
          <button onClick={() => setDraft({ ...draft, backgroundUrl: DEFAULT_BG })} className="touch-feedback flex h-8 items-center gap-1 rounded-lg border border-line px-2 text-[11px] text-ink-muted">
            默认模板
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={chooseBackground} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => addLayer('image')} className="touch-feedback flex flex-col items-center gap-1 rounded-lg border border-line p-2 text-[10px] text-ink-muted"><ImagePlus size={16} />图片框</button>
          <button onClick={() => addLayer('text')} className="touch-feedback flex flex-col items-center gap-1 rounded-lg border border-line p-2 text-[10px] text-ink-muted"><Type size={16} />文字</button>
          <button onClick={() => addLayer('link')} className="touch-feedback flex flex-col items-center gap-1 rounded-lg border border-line p-2 text-[10px] text-ink-muted"><Link2 size={16} />@引用</button>
        </div>
        <div className="rounded-xl border border-line bg-paper-card/50 p-3">
          <p className="mb-2 text-xs font-medium text-ink">卡片名称</p>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-8 w-full rounded border border-line bg-paper px-2 text-xs text-ink" />
          <p className="mb-1 mt-3 text-[10px] text-ink-faint">画布 {draft.width}×{draft.height}</p>
          {selected ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-ink">
                <span>{selected.type === 'image' ? '图片层' : selected.type === 'link' ? '@ 引用层' : '文字层'}</span>
                <button onClick={() => removeLayer(selected.id)} className="text-ink-faint hover:text-error"><Trash2 size={13} /></button>
              </div>
              {selected.type !== 'image' ? (
                <textarea value={selected.text || ''} onChange={(e) => updateLayer(selected.id, { text: e.target.value })} rows={3} className="w-full rounded border border-line bg-paper px-2 py-1 text-xs text-ink" placeholder="内容" />
              ) : (
                <button onClick={() => { imageTargetRef.current = selected.id; imageFileRef.current?.click() }} className="flex h-8 w-full items-center justify-center gap-1 rounded border border-line text-[11px] text-ink-muted">
                  <ImagePlus size={13} /> 选择图片
                </button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <input type="number" value={selected.x} onChange={(e) => updateLayer(selected.id, { x: Number(e.target.value) })} className="h-7 rounded border border-line bg-paper px-1 text-[11px]" placeholder="X" />
                <input type="number" value={selected.y} onChange={(e) => updateLayer(selected.id, { y: Number(e.target.value) })} className="h-7 rounded border border-line bg-paper px-1 text-[11px]" placeholder="Y" />
                <input type="number" value={selected.width} onChange={(e) => updateLayer(selected.id, { width: Number(e.target.value) })} className="h-7 rounded border border-line bg-paper px-1 text-[11px]" placeholder="宽" />
                <input type="number" value={selected.height} onChange={(e) => updateLayer(selected.id, { height: Number(e.target.value) })} className="h-7 rounded border border-line bg-paper px-1 text-[11px]" placeholder="高" />
              </div>
              {selected.type !== 'image' ? (
                <div className="flex items-center gap-2">
                  <input type="number" value={selected.fontSize || 20} onChange={(e) => updateLayer(selected.id, { fontSize: Number(e.target.value) })} className="h-7 w-16 rounded border border-line bg-paper px-1 text-[11px]" />
                  <input type="color" value={selected.color || '#2E2B27'} onChange={(e) => updateLayer(selected.id, { color: e.target.value })} className="h-7 w-10 rounded border border-line bg-paper" />
                  <label className="flex items-center gap-1 text-[10px] text-ink-muted"><input type="checkbox" checked={Boolean(selected.bold)} onChange={(e) => updateLayer(selected.id, { bold: e.target.checked })} />粗体</label>
                </div>
              ) : null}
              {selected.type === 'link' ? (
                <button onClick={() => setLinkPickerOpen(true)} className="h-8 w-full rounded border border-line text-[11px] text-ink-muted">
                  {selected.targetName ? `@ ${selected.targetName}` : '选择 @ 跳转对象'}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-[10px] text-ink-faint">点击画布上的层进行编辑。</p>
          )}
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          <button onClick={() => void exportCurrent()} disabled={busy} className="touch-feedback flex h-8 items-center gap-1 rounded-lg border border-line px-2 text-[11px] text-ink-muted"><Download size={13} />导出 PNG</button>
          <button onClick={() => persist(draft)} className="touch-feedback flex h-8 items-center gap-1 rounded-lg bg-ink px-2 text-[11px] text-paper"><Save size={13} />保存到仓库</button>
          <button onClick={() => setPreview((value) => !value)} className="touch-feedback h-8 rounded-lg border border-line px-2 text-[11px] text-ink-muted">{preview ? '返回编辑' : '预览 / 测试 @'}</button>
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-xl border border-line bg-paper-alt p-3">
        <div ref={stageRef} className="relative shrink-0 overflow-hidden rounded-lg shadow-lg" style={{ width: 'min(100%, 560px)', aspectRatio: `${draft.width} / ${draft.height}` }}>
          <img src={draft.backgroundUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-fill" draggable={false} />
          {draft.layers.map((layer) => {
            const scaleX = 100 / draft.width
            const scaleY = 100 / draft.height
            return (
              <div
                key={layer.id}
                onClick={(event) => {
                  event.stopPropagation()
                  if (preview && layer.type === 'link' && layer.targetId) {
                    onNavigate(layer.targetId, layer.targetType)
                    return
                  }
                  setSelectedLayerId(layer.id)
                }}
                onPointerDown={(event) => {
                  if (preview) return
                  event.stopPropagation()
                  setSelectedLayerId(layer.id)
                  dragRef.current = { id: layer.id, startX: event.clientX, startY: event.clientY, x: layer.x, y: layer.y }
                  document.body.style.cursor = 'grabbing'
                }}
                className={`absolute cursor-move select-none ${selectedLayerId === layer.id ? 'ring-2 ring-accent' : ''}`}
                style={{
                  left: `${layer.x * scaleX}%`,
                  top: `${layer.y * scaleY}%`,
                  width: `${layer.width * scaleX}%`,
                  height: `${layer.height * scaleY}%`,
                  border: layer.type === 'image' && !layer.imageUrl ? '1px dashed #B8AEA0' : undefined,
                  background: layer.type === 'image' && !layer.imageUrl ? 'rgba(184,174,160,.12)' : undefined,
                }}
              >
                {layer.type === 'image' && layer.imageUrl ? (
                  <img src={layer.imageUrl} alt="" className="pointer-events-none h-full w-full object-cover" draggable={false} />
                ) : layer.type !== 'image' ? (
                  <div
                    className="h-full w-full whitespace-pre-wrap break-words"
                    style={{ fontSize: `${(layer.fontSize || 20) * (560 / draft.width)}px`, color: layer.color || '#2E2B27', fontWeight: layer.bold ? 700 : 400, lineHeight: 1.45 }}
                  >
                    {layer.text || (layer.type === 'link' ? '@相关角色' : '')}
                  </div>
                ) : null}
              </div>
            )
          })}
          {preview ? null : (
            <button onClick={() => setSelectedLayerId(null)} className="absolute bottom-2 right-2 rounded bg-black/40 px-2 py-1 text-[10px] text-white">取消选中</button>
          )}
        </div>
      </div>

      <input ref={imageFileRef} type="file" accept="image/*" className="hidden" onChange={chooseLayerImage} />

      {linkPickerOpen ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/25 p-4 backdrop-blur-sm" onClick={() => setLinkPickerOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-line bg-paper p-4" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm text-ink">选择 @ 跳转对象</p>
              <button onClick={() => setLinkPickerOpen(false)} className="text-ink-faint"><X size={16} /></button>
            </div>
            <div className="mt-3 max-h-80 overflow-auto">
              {entities.map((entity) => (
                <button
                  key={`${entity.type}-${entity.id}`}
                  onClick={() => {
                    if (!selected) return
                    updateLayer(selected.id, {
                      targetId: Number(entity.id),
                      targetType: entity.type,
                      targetName: entity.name,
                      text: `@${entity.name}`,
                    })
                    setLinkPickerOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-ink-muted hover:bg-black/5 hover:text-ink dark:hover:bg-white/5"
                >
                  <UserRound size={14} /> {entity.name}
                  <span className="ml-auto text-[10px] text-ink-faint">{entity.type}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
