import type { Character, Country } from '@/types'

/** 兼容旧版已有代表色；国家未设置颜色时使用中性灰。 */
export function countryColor(country: Pick<Country, 'accentColor'>): string {
  return typeof country.accentColor === 'string' && /^#[\da-f]{6}$/i.test(country.accentColor)
    ? country.accentColor : '#8A8A8A'
}

/** 以资料中的所属国家为准；兼容早期仅保存国家名称的资料。 */
export function characterCountry(
  character: Pick<Character, 'countryId' | 'nationalityLegacy'>,
  countries: Country[],
): Country | undefined {
  const active = countries.filter((country) => !country.deleted)
  const byId = character.countryId == null
    ? undefined : active.find((country) => country.id === character.countryId)
  if (byId) return byId
  const name = character.nationalityLegacy?.trim()
  if (!name) return undefined
  // 重名国家不能可靠匹配，不猜测归属。
  const matches = active.filter((country) => country.name.trim() === name)
  return matches.length === 1 ? matches[0] : undefined
}

/** 归属仍存于数据库，画布改用头像圆环展示。 */
export function isCountryMembershipEdge(data: Record<string, unknown> | undefined): boolean {
  return data?.kind === 'membership'
}
