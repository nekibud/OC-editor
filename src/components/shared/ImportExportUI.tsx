'use client'

import { useState, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'

import { exportAllData, exportAllDataZip, downloadJson } from '@/lib/export'
import { validateImportData, importData } from '@/lib/import'
import type { ImportSummary, MergeStrategy } from '@/lib/import'
import {
  importOcav,
  isOcavPayload,
  validateOcav,
  type OcavFile,
  type OcavSummary,
} from '@/lib/ocav'
import { readZip } from '@/lib/zip'

const MERGE_OPTIONS: { value: MergeStrategy; label: string; description: string }[] = [
  { value: 'skip', label: '跳过重复', description: '仅添加不重名的数据，已有记录保持不变' },
  { value: 'overwrite', label: '覆盖重复', description: '用导入数据替换本地同名记录' },
  { value: 'keep-both', label: '保留两者', description: '导入数据作为新条目，生成新 ID' },
  { value: 'replace', label: '清空并导入', description: '清除所有数据后导入，等同于覆盖替换' },
]

const OCAV_MERGE_OPTIONS: typeof MERGE_OPTIONS = MERGE_OPTIONS.filter(
  (option) => option.value !== 'replace',
)

export function useImportExport() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ocavInputRef = useRef<HTMLInputElement>(null)
  const [pendingJson, setPendingJson] = useState<unknown>(null)
  const [pendingOcav, setPendingOcav] = useState<OcavFile | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [ocavSummary, setOcavSummary] = useState<OcavSummary | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [strategy, setStrategy] = useState<MergeStrategy>('skip')

  const handleExport = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
      const data = await exportAllData()
      const date = new Date().toISOString().slice(0, 10)
      const name = downloadJson(data, `oc-editor-all-${date}.ocbak`)
      toast.success(`导出成功：${name}`)
    } catch {
      toast.error('导出失败')
    } finally {
      setExporting(false)
    }
  }, [exporting])

  const handleExportZip = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
      const result = await exportAllDataZip()
      toast.success(`ZIP 备份已导出：${result.name}`)
    } catch {
      toast.error('导出 ZIP 失败')
    } finally {
      setExporting(false)
    }
  }, [exporting])

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleOcavImportClick = useCallback(() => {
    ocavInputRef.current?.click()
  }, [])

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    try {
      const buffer = await file.arrayBuffer()
      const head = new Uint8Array(buffer.slice(0, 4))
      const isZip = head[0] === 0x50 && head[1] === 0x4b
      let text: string
      if (isZip) {
        const entries = await readZip(buffer)
        const dataEntry =
          entries.get('oc-data.json') ??
          [...entries.entries()].find(([name]) => name.toLowerCase().endsWith('.json'))?.[1]
        if (!dataEntry) throw new Error('ZIP 中未找到 oc-data.json')
        text = new TextDecoder().decode(dataEntry)
      } else {
        text = new TextDecoder().decode(new Uint8Array(buffer))
      }
      const json = JSON.parse(text)
      if (isOcavPayload(json)) {
        const detected = validateOcav(json)
        setPendingOcav(detected.file)
        setOcavSummary(detected.summary)
        setPendingJson(null)
        setSummary(null)
        setStrategy('skip')
        setConfirmOpen(true)
        return
      }
      const s = validateImportData(json)
      setPendingJson(json)
      setSummary(s)
      setPendingOcav(null)
      setOcavSummary(null)
      setStrategy('skip')
      setConfirmOpen(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : '无效的数据格式'
      toast.error(message)
    }
  }, [])

  const handleConfirmImport = useCallback(async () => {
    if (!pendingJson && !pendingOcav) return
    setImporting(true)
    try {
      if (pendingOcav) {
        const result = await importOcav(pendingOcav, strategy, queryClient)
        const parts: string[] = []
        if (result.added > 0) parts.push(`新增 ${result.added} 条`)
        if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 条`)
        if (result.overwritten > 0) parts.push(`覆盖 ${result.overwritten} 条`)
        if (result.contextAdded > 0) parts.push(`补齐关联 ${result.contextAdded} 条`)
        if (result.relations > 0) parts.push(`同步关系 ${result.relations} 条`)
        toast.success(`已导入${result.kindLabel}：${parts.join('，') || '没有变化'}`)
        setConfirmOpen(false)
        setPendingOcav(null)
        setOcavSummary(null)
        return
      }
      if (!pendingJson) return
      const result = await importData(pendingJson, strategy, queryClient)
      window.dispatchEvent(new CustomEvent('data-updated'))

      const parts: string[] = []
      if (result.added > 0) parts.push(`新增 ${result.added} 条`)
      if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 条`)
      if (result.overwritten > 0) parts.push(`覆盖 ${result.overwritten} 条`)

      toast.success(`导入完成：${parts.join('，')}`)
      setConfirmOpen(false)
      setPendingJson(null)
      setSummary(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }, [pendingJson, pendingOcav, strategy, queryClient])

  const handleCancel = useCallback(() => {
    setConfirmOpen(false)
    setPendingJson(null)
    setPendingOcav(null)
    setSummary(null)
    setOcavSummary(null)
  }, [])

  const summaryText = summary
    ? `角色 ${summary.characters} 条，事件 ${summary.events} 条，国家 ${summary.countries} 条，词条 ${summary.worldEntries} 条，标签 ${summary.tags} 条，地图 ${summary.maps} 张`
    : ''
  const ocavSummaryText = ocavSummary
    ? `${ocavSummary.kindLabel} · ${ocavSummary.label} · ${ocavSummary.count} 条`
    : ''

  const dialog = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".ocbak,.json,.zip"
        className="hidden"
        onChange={handleFileSelected}
      />
      <input
        ref={ocavInputRef}
        type="file"
        accept=".ocbak,application/json"
        className="hidden"
        onChange={handleFileSelected}
      />
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open)
          if (!open) {
            setPendingJson(null)
            setPendingOcav(null)
            setSummary(null)
            setOcavSummary(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingOcav ? '确认导入 .ocbak 分类备份' : '确认导入数据'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingOcav ? (
                <span className="mt-1 block space-y-1 text-xs leading-5">
                  <span className="block font-medium text-ink">软件已自动判断：{ocavSummaryText}</span>
                  <span className="block">
                    关联对象 {ocavSummary?.contextCount ?? 0} 个，关系 {ocavSummary?.relationCount ?? 0} 条；
                    来源世界观：{ocavSummary?.worldName || '未知'}。
                  </span>
                  <span className="block">
                    会按文件内容的实际形状导入当前世界观，并自动按新 ID 重连关系图；
                    即使文件头的类型写错，也不会把角色写进国家表。
                  </span>
                </span>
              ) : summaryText ? (
                <span className="mt-1 block">导入数据包含：{summaryText}</span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-2 py-2">
            <span className="text-sm text-ink-muted">重复记录处理策略</span>
            {(pendingOcav ? OCAV_MERGE_OPTIONS : MERGE_OPTIONS).map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                  strategy === opt.value
                    ? 'border-line-hover bg-paper-card'
                    : 'border-line hover:border-line-hover'
                }`}
              >
                <input
                  type="radio"
                  name="merge-strategy"
                  value={opt.value}
                  checked={strategy === opt.value}
                  onChange={() => setStrategy(opt.value)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-line bg-paper-card text-ink accent-ink"
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-ink">{opt.label}</span>
                  <span className="text-xs text-ink-muted">{opt.description}</span>
                  {opt.value === 'keep-both' && strategy === 'keep-both' ? (
                    <span className={`text-xs pt-0.5 ${pendingOcav ? 'text-ink-faint' : 'text-error'}`}>
                      {pendingOcav
                        ? '.ocbak 会为新条目重新映射关联并自动同步关系图'
                        : '注意：关联关系（如 relatedCharacters）可能需要手动修复'}
                    </span>
                  ) : null}
                </div>
              </label>
            ))}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmImport}
              disabled={importing}
            >
              {importing ? '导入中...' : '确认导入'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

  return { handleExport, handleExportZip, handleImportClick, handleOcavImportClick, dialog }
}
