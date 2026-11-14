'use client'

import type { NodeProps } from '@xyflow/react'
import { Sword, PawPrint } from 'lucide-react'
import { Avatar } from '@/components/shared/Avatar'
import { getImageUrl } from '@/lib/image-service'
import { RelationHandle } from './RelationHandle'

export function CharacterNode({ data }: NodeProps) {
  const qAvatarUrl = data.qAvatarUrl as string | undefined
  const avatarUrl = data.avatarUrl as string | undefined
  const src = qAvatarUrl || avatarUrl
  const countryColor = data.countryColor as string | undefined
  const countryName = data.countryName as string | undefined
  const entityKind = data.entityKind as string | undefined

  return (
    <>
      <div className="flex flex-col items-center gap-1 group cursor-pointer">
        <div className="relative" title={countryName ? `所属国家：${countryName}` : undefined}>
          <Avatar src={getImageUrl(src, 'avatar')} className="h-14 w-14 border-2 border-paper" size="md"
            style={countryColor ? { borderColor: countryColor, borderWidth: 3, borderStyle: 'solid', borderImage: 'none', backgroundImage: 'none', boxShadow: 'none' } : undefined} />
          {countryColor ? (
            <svg className="oc-country-solid-ring" aria-hidden="true" viewBox="0 0 56 56"
              style={{ position: 'absolute', top: 0, left: 0, width: 56, height: 56, pointerEvents: 'none', filter: 'none', opacity: 1 }}>
              <circle cx="28" cy="28" r="26.5" fill="none" stroke={countryColor} strokeWidth="3" strokeOpacity="1" />
            </svg>
          ) : null}
          {entityKind === 'weapon' || entityKind === 'pet' ? (
            <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-paper text-ink-muted shadow-sm">
              {entityKind === 'weapon' ? (
                <Sword size={10} strokeWidth={2} />
              ) : (
                <PawPrint size={10} strokeWidth={2} />
              )}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-ink text-center max-w-[80px] truncate">
          {data.label as string}
        </span>
      </div>
      <RelationHandle centerY={60} size={20} />
    </>
  )
}
