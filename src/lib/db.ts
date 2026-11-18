import Dexie, { type Table } from 'dexie'

import type {
  Character,
  Event,
  Country,
  WorldEntry,
  Tag,
  OperationLog,
  Period,
  WorldMapRecord,
  RelationRecord,
  RelationKind,
  World,
} from '@/types'
import { activeWorldIdForWrite } from '@/lib/world-scope'

export class OCEditorDB extends Dexie {
  characters!: Table<Character, number>
  events!: Table<Event, number>
  countries!: Table<Country, number>
  worldEntries!: Table<WorldEntry, number>
  tags!: Table<Tag, number>
  operationLog!: Table<OperationLog, number>
  periods!: Table<Period, number>
  maps!: Table<WorldMapRecord, number>
  relations!: Table<RelationRecord, string>
  worlds!: Table<World, number>

  constructor() {
    // 数据库名沿用历史值 "OCStudioDB"：改名会变成全新的空数据库，导致本地创作内容丢失。
    super('OCStudioDB')

    this.version(3).stores({
      characters: '++id, name, race, element, occupation, nationalityLegacy, countryId, deleted, _syncStatus',
      events: '++id, title, time, parentEventId, isMajor, deleted, _syncStatus',
      countries: '++id, name, parentId, deleted, _syncStatus',
      worldEntries: '++id, title, category, parentId, deleted, _syncStatus',
      tags: '++id, name, category',
      operationLog: '++id, timestamp, targetType, targetId',
    })

    this.version(4).stores({
      characters: '++id, name, race, element, occupation, nationalityLegacy, countryId, deleted, _syncStatus',
      events: '++id, title, time, parentEventId, isMajor, deleted, _syncStatus',
      countries: '++id, name, parentId, deleted, _syncStatus',
      worldEntries: '++id, title, category, parentId, deleted, _syncStatus',
      tags: '++id, name, category',
      operationLog: '++id, timestamp, targetType, targetId',
    })

    this.version(5).stores({
      characters: '++id, name, race, element, occupation, nationalityLegacy, countryId, deleted, _syncStatus',
      events: '++id, title, time, parentEventId, isMajor, deleted, _syncStatus',
      countries: '++id, name, parentId, deleted, _syncStatus',
      worldEntries: '++id, title, category, parentId, deleted, _syncStatus',
      tags: '++id, name, category',
      operationLog: '++id, timestamp, targetType, targetId',
      periods: '++id, startTime, deleted',
    })

    this.version(6).stores({
      characters: '++id, name, race, element, occupation, nationalityLegacy, countryId, deleted, _syncStatus',
      events: '++id, title, time, parentEventId, isMajor, deleted, _syncStatus',
      countries: '++id, name, parentId, deleted, _syncStatus',
      worldEntries: '++id, title, category, parentId, deleted, _syncStatus',
      tags: '++id, name, category',
      operationLog: '++id, timestamp, targetType, targetId',
      periods: '++id, startTime, deleted',
      maps: '++id, name, seed, updatedAt, deleted',
    })

    this.version(7)
      .stores({
        characters: '++id, name, race, element, occupation, nationalityLegacy, countryId, deleted, _syncStatus',
        events: '++id, title, time, parentEventId, isMajor, deleted, _syncStatus',
        countries: '++id, name, parentId, deleted, _syncStatus',
        worldEntries: '++id, title, category, parentId, deleted, _syncStatus',
        tags: '++id, name, category',
        operationLog: '++id, timestamp, targetType, targetId',
        periods: '++id, startTime, deleted',
        maps: '++id, name, seed, updatedAt, deleted',
        relations: 'id, sourceType, sourceId, targetType, targetId, kind, updatedAt, deleted',
      })
      .upgrade(async (transaction) => {
        const now = Date.now()
        const rows = new Map<string, RelationRecord>()
        const relationId = (
          sourceType: RelationRecord['sourceType'],
          sourceId: number,
          targetType: RelationRecord['targetType'],
          targetId: number,
        ): string => `${sourceType}:${sourceId}->${targetType}:${targetId}`
        const add = (
          sourceType: RelationRecord['sourceType'],
          sourceId: number | undefined,
          targetType: RelationRecord['targetType'],
          targetId: number | undefined,
          kind: RelationKind,
          label: string,
          directed = true,
        ): void => {
          if (sourceId === undefined || targetId === undefined || sourceId === targetId) return
          let fromId = sourceId
          let toId = targetId
          // 国家关系是无向的：用 id 排序生成稳定主键，避免双向各存一条。
          if (kind === 'nation' && fromId > toId) {
            const swap = fromId
            fromId = toId
            toId = swap
          }
          const id = relationId(sourceType, fromId, targetType, toId)
          if (rows.has(id)) return
          rows.set(id, {
            id,
            sourceType,
            sourceId: fromId,
            targetType,
            targetId: toId,
            kind,
            label,
            directed: kind === 'nation' || kind === 'character' ? false : directed,
            createdAt: now,
            updatedAt: now,
            deleted: false,
          })
        }

        const characters = await transaction.table('characters').toArray()
        const countries = await transaction.table('countries').toArray()
        const events = await transaction.table('events').toArray()
        const characterIds = new Set(characters.filter((item) => !item.deleted).map((item) => item.id))
        const countryIds = new Set(countries.filter((item) => !item.deleted).map((item) => item.id))
        const eventIds = new Set(events.filter((item) => !item.deleted).map((item) => item.id))

        for (const character of characters) {
          if (character.deleted || character.id === undefined) continue
          for (const related of character.relatedCharacters ?? []) {
            if (related.characterId && characterIds.has(related.characterId)) {
              add('character', character.id, 'character', related.characterId, 'character', related.relation || '相关')
            }
          }
          if (character.countryId && countryIds.has(character.countryId)) {
            add('character', character.id, 'country', character.countryId, 'membership', '属于')
          }
        }

        for (const country of countries) {
          if (country.deleted || country.id === undefined) continue
          for (const nationId of country.relatedNations ?? []) {
            if (countryIds.has(nationId)) add('country', country.id, 'country', nationId, 'nation', '关系', false)
          }
        }

        for (const event of events) {
          if (event.deleted || event.id === undefined) continue
          for (const characterId of event.characters ?? []) {
            if (characterIds.has(characterId)) {
              add('event', event.id, 'character', characterId, 'event-character', '参与')
            }
          }
          for (const countryId of event.countries ?? []) {
            if (countryIds.has(countryId)) {
              add('event', event.id, 'country', countryId, 'event-country', '发生于')
            }
          }
        }

        if (rows.size > 0) await transaction.table('relations').bulkAdd([...rows.values()])
        void eventIds
      })

    // v8：引入「世界观」维度。所有创作实体加上 worldId，旧数据归入默认世界观。
    this.version(8)
      .stores({
        characters: '++id, worldId, name, race, element, occupation, nationalityLegacy, countryId, deleted, _syncStatus',
        events: '++id, worldId, title, time, parentEventId, isMajor, deleted, _syncStatus',
        countries: '++id, worldId, name, parentId, deleted, _syncStatus',
        worldEntries: '++id, worldId, title, category, parentId, deleted, _syncStatus',
        tags: '++id, name, category',
        operationLog: '++id, timestamp, targetType, targetId',
        periods: '++id, worldId, startTime, deleted',
        maps: '++id, worldId, name, seed, updatedAt, deleted',
        relations: 'id, worldId, sourceType, sourceId, targetType, targetId, kind, updatedAt, deleted',
        worlds: '++id, name, order, deleted, createdAt',
      })
      .upgrade(async (transaction) => {
        const now = Date.now()
        const worldId = await transaction.table('worlds').add({
          name: '默认世界观',
          description: '升级时自动创建，原有角色、事件、国家、词条等内容都归入这里。',
          createdAt: now,
          updatedAt: now,
          order: 0,
          deleted: false,
        })
        for (const tableName of [
          'characters',
          'events',
          'countries',
          'worldEntries',
          'periods',
          'maps',
        ]) {
          await transaction
            .table(tableName)
            .toCollection()
            .modify((row: { worldId?: number }) => {
              if (row.worldId === undefined || row.worldId === null) row.worldId = worldId
            })
        }
        await transaction
          .table('relations')
          .toCollection()
          .modify((row: { worldId?: number }) => {
            if (row.worldId === undefined || row.worldId === null) row.worldId = worldId
          })
      })

    // 新建记录自动归属当前世界观，避免各个入口（面板、关系图、导入、示例数据）漏写。
    const scopedTables = [
      this.characters,
      this.events,
      this.countries,
      this.worldEntries,
      this.periods,
      this.maps,
      this.relations,
    ] as unknown as Table<{ worldId?: number }, unknown>[]
    for (const table of scopedTables) {
      table.hook('creating', (_primKey, obj) => {
        if (obj && (obj.worldId === undefined || obj.worldId === null)) {
          const worldId = activeWorldIdForWrite()
          if (worldId !== undefined) obj.worldId = worldId
        }
      })
    }

  }
}

export const db = new OCEditorDB()
