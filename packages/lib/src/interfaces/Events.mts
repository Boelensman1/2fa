import type { EmptyObject } from 'type-fest'
import type { TwoFaLibEvent } from '../TwoFaLibEvent.mjs'
import type { ConnectionStatus } from '../subclasses/SyncManager.mjs'

export interface TwoFaLibEventMap {
  [TwoFaLibEvent.Changed]: EmptyObject
  [TwoFaLibEvent.LoadedFromLockedRepresentation]: EmptyObject
  [TwoFaLibEvent.ConnectToExistingVaultFinished]: EmptyObject
  [TwoFaLibEvent.ConnectionToSyncServerStatusChanged]: {
    newStatus: ConnectionStatus
  }
  [TwoFaLibEvent.Log]: {
    severity: 'info' | 'warning'
    message: string
  }
  [TwoFaLibEvent.Ready]: EmptyObject
}

export type TwoFaLibEventMapEvents = {
  [K in keyof TwoFaLibEventMap]: CustomEvent<TwoFaLibEventMap[K]>
}
