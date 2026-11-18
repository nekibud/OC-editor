'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export interface OcavExportAction {
  id: string
  label: string
  hint?: string
  onSelect: () => void | Promise<void>
}

interface OcavExportButtonProps {
  actions: OcavExportAction[]
  /** 只有一个动作时按钮上的文字；多个动作时作为菜单标题。 */
  label?: string
  compact?: boolean
  className?: string
}

/**
 * 分类导出按钮。
 * - 单个动作：直接执行并下载 .ocbak。
 * - 多个动作（例如角色：本分类 / 全部角色）：展开菜单。
 */
export function OcavExportButton({
  actions,
  label = '导出',
  compact = false,
  className = '',
}: OcavExportButtonProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(rect.right - 220, window.innerWidth - 232)),
      top: Math.min(rect.bottom + 6, window.innerHeight - 8),
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const run = useCallback(
    async (action: OcavExportAction): Promise<void> => {
      if (busy) return
      setBusy(action.id)
      setOpen(false)
      try {
        await action.onSelect()
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : '导出失败')
      } finally {
        setBusy(null)
      }
    },
    [busy],
  )

  const handleClick = (): void => {
    if (busy) return
    if (actions.length === 0) return
    if (actions.length === 1) {
      void run(actions[0])
      return
    }
    setOpen((value) => !value)
  }

  const baseClass = compact
    ? 'touch-feedback flex h-7 items-center gap-1 rounded border border-line bg-paper-card/60 px-2 text-[11px] text-ink-muted transition-colors hover:border-line-hover hover:text-ink disabled:opacity-40'
    : 'touch-feedback flex h-9 items-center gap-1.5 rounded border border-line bg-paper-card/60 px-3 text-sm text-ink-muted transition-colors hover:border-line-hover hover:text-ink disabled:opacity-40'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleClick}
        disabled={Boolean(busy)}
        title={actions.length === 1 ? actions[0].label : label}
        className={`${baseClass} ${className}`}
      >
        {busy ? (
          <Loader2 size={compact ? 13 : 15} strokeWidth={2} className="animate-spin" />
        ) : (
          <Download size={compact ? 13 : 15} strokeWidth={2} />
        )}
        {compact ? (
          <span className="max-sm:sr-only">{busy ? '导出中' : label}</span>
        ) : (
          <span>{busy ? '导出中…' : label}</span>
        )}
        {actions.length > 1 ? <ChevronDown size={compact ? 12 : 14} strokeWidth={2} /> : null}
      </button>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[10020] w-[220px] rounded-lg border border-line bg-paper p-1 shadow-xl"
              style={{ left: pos.left, top: pos.top }}
            >
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => void run(action)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-paper-card"
                >
                  <span className="text-xs text-ink">{action.label}</span>
                  {action.hint ? (
                    <span className="text-[10px] leading-4 text-ink-faint">{action.hint}</span>
                  ) : null}
                </button>
              ))}
            </div>,
            document.getElementById('overlay-root') ?? document.body,
          )
        : null}
    </>
  )
}
