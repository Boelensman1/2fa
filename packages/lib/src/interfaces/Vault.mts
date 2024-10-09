import type { Tagged } from 'type-fest'
import type { Encrypted } from './CryptoLib.mjs'
import type Entry from './Entry.mjs'

export type Vault = Entry[]

export type VaultData = Tagged<string, 'VaultData'>
export type EncryptedVaultData = Encrypted<VaultData>
