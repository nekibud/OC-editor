import type { Character, CharacterKind } from '@/types'

interface EntityInfoField { key: string; label: string; legacy?: keyof Character }

export const ENTITY_INFO_FIELDS: Record<'weapon' | 'pet', readonly EntityInfoField[]> = {
  weapon: [
    { key: 'type', label: '武器类型' }, { key: 'material', label: '材质' },
    { key: 'rarity', label: '稀有度' }, { key: 'dimensions', label: '尺寸' },
    { key: 'weight', label: '重量', legacy: 'weight' }, { key: 'maker', label: '制造者' },
    { key: 'createdAt', label: '铸造时间' }, { key: 'origin', label: '来源' },
    { key: 'requirements', label: '使用条件' }, { key: 'ability', label: '能力效果', legacy: 'ability' },
    { key: 'element', label: '属性元素', legacy: 'element' }, { key: 'status', label: '当前状态', legacy: 'status' },
  ],
  pet: [
    { key: 'species', label: '物种', legacy: 'race' }, { key: 'breed', label: '品种' },
    { key: 'gender', label: '性别', legacy: 'gender' }, { key: 'age', label: '年龄', legacy: 'age' },
    { key: 'size', label: '体型' }, { key: 'weight', label: '体重', legacy: 'weight' },
    { key: 'appearance', label: '外观特征' }, { key: 'personality', label: '性格', legacy: 'personality' },
    { key: 'habits', label: '习性' }, { key: 'diet', label: '饮食偏好' },
    { key: 'ability', label: '能力技能', legacy: 'ability' }, { key: 'birthday', label: '出生日期', legacy: 'birthday' },
    { key: 'adoptedAt', label: '收养日期' }, { key: 'habitat', label: '栖息地', legacy: 'residence' },
    { key: 'status', label: '当前状态', legacy: 'status' },
  ],
}

export function getEntityInfoFields(kind: CharacterKind | undefined): readonly EntityInfoField[] {
  return kind === 'weapon' || kind === 'pet' ? ENTITY_INFO_FIELDS[kind] : []
}

export function readEntityInfo(character: Character): Record<string, string> {
  const values = { ...character.entityInfo }
  for (const field of getEntityInfoFields(character.entityKind)) {
    if (values[field.key] !== undefined) continue
    const previous = field.legacy ? character[field.legacy] : undefined
    values[field.key] = typeof previous === 'string' ? previous : ''
  }
  return values
}
