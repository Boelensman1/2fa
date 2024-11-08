import { LiteralUnion } from 'type-fest'

import { Tagged } from 'type-fest'

export type EntryId = Tagged<string, 'TotpId'>

export type EntryType = LiteralUnion<'TOTP', string>

export interface EntryMeta {
  id: EntryId
  name: string
  issuer: string
  type: EntryType
  addedAt: number
  updatedAt: number | null
}

export interface TotpPayload {
  secret: string
  period: LiteralUnion<30 | 60, number>
  algorithm: LiteralUnion<'SHA-1' | 'SHA-256' | 'SHA-512', string>
  digits: LiteralUnion<6 | 8, number>
}

interface TotpEntry extends EntryMeta {
  type: 'TOTP'
  payload: TotpPayload
}

type Entry = TotpEntry

export type NewEntry = Omit<Entry, 'id' | 'addedAt' | 'updatedAt'>
export default Entry

export interface Token {
  validFrom: number
  validTill: number
  otp: string
}

export type EntryMetaWithToken = EntryMeta & { token: Token }
