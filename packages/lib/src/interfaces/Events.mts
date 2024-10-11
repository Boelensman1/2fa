import type { EmptyObject } from 'type-fest'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Salt,
} from '../interfaces/CryptoLib.mjs'
import { TwoFaLibEvent } from '../TwoFaLibEvent.mjs'
import type { DeviceId } from './SyncTypes.mjs'

export interface ChangedEventData {
  lockedRepresentation: string
  encryptedPrivateKey: EncryptedPrivateKey
  encryptedSymmetricKey: EncryptedSymmetricKey
  salt: Salt
  deviceId: DeviceId
  syncDevices: string
}
export type ChangedEventWasChangedSinceLastEvent = Record<
  keyof ChangedEventData,
  boolean
>
export interface ChangedEvent {
  changed: ChangedEventWasChangedSinceLastEvent
  data: ChangedEventData
}
export interface TwoFaLibEventMap {
  [TwoFaLibEvent.Changed]: ChangedEvent
  [TwoFaLibEvent.LoadedFromLockedRepresentation]: EmptyObject
  [TwoFaLibEvent.ConnectToExistingVaultFinished]: EmptyObject
  [TwoFaLibEvent.ConnectionToSyncServerStatusChanged]: {
    connected: boolean
  }
  [TwoFaLibEvent.Log]: {
    severity: 'info' | 'warning'
    message: string
  }
}

export type TwoFaLibEventMapEvents = {
  [K in keyof TwoFaLibEventMap]: CustomEvent<TwoFaLibEventMap[K]>
}
