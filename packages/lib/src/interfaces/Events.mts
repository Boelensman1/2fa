import type { EmptyObject } from 'type-fest'
import type { FavaLibEvent } from '../FavaLibEvent.mjs'
import type { ConnectionStatus } from '../subclasses/SyncManager.mjs'

export interface FavaLibEventMap {
  [FavaLibEvent.Changed]: EmptyObject
  // Deliberately empty: a listener that cached credentials only needs to know
  // they are stale, and a payload here would be a payload carrying secrets.
  [FavaLibEvent.PasswordChanged]: EmptyObject
  [FavaLibEvent.LoadedFromLockedRepresentation]: EmptyObject
  [FavaLibEvent.ConnectToExistingVaultFinished]: EmptyObject
  [FavaLibEvent.ConnectionToSyncServerStatusChanged]: {
    newStatus: ConnectionStatus
  }
  [FavaLibEvent.Log]: {
    severity: 'info' | 'warning'
    message: string
  }
  [FavaLibEvent.Ready]: EmptyObject
}

export type FavaLibEventMapEvents = {
  [K in keyof FavaLibEventMap]: CustomEvent<FavaLibEventMap[K]>
}
