/**
 * 文档字段兼容层。
 *
 * 历史版本/导入包可能把 TipTap JSON 存成“字符串套字符串”：
 *   "{\"type\":\"doc\",...}" 或 "\"{\\\"type\\\":\\\"doc\\\"...}\""
 * 直接交给编辑器会被当成 HTML 文本，重启后就表现为“格式全乱”。
 * 这里统一解到对象；无法解析时保留原值，交给编辑器按 HTML/纯文本处理。
 */
export function parseDocumentValue(value: unknown): Record<string, unknown> | null {
  let current: unknown = value
  for (let depth = 0; depth < 3; depth += 1) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      const record = current as Record<string, unknown>
      if (record.type === 'doc' || Array.isArray(record.content)) return record
      return null
    }
    if (typeof current !== 'string' || !current.trim()) return null
    try {
      current = JSON.parse(current) as unknown
    } catch {
      return null
    }
  }
  return current && typeof current === 'object' && !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : null
}

/** 编辑器 content 的统一入口：对象原样返回，JSON 字符串解析，其余按原值。 */
export function normalizeDocumentContent(value: unknown): unknown {
  if (value && typeof value === 'object') return value
  if (typeof value !== 'string' || !value.trim()) return value ?? ''
  return parseDocumentValue(value) ?? value
}
