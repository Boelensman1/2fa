import type { EmptyObject } from 'type-fest'
import type { FavaLibEvent } from '../FavaLibEvent.mjs'
import type { ConnectionStatus } from '../subclasses/SyncManager.mjs'

export interface FavaLibEventMap {
  [FavaLibEvent.Changed]: EmptyObject
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
