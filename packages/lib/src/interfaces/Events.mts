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
    /**
     * `error` is for a refusal the user should be told about even though the
     * library carried on -- a vault arriving unrequested, a command that does
     * not verify. It is deliberately distinct from `warning`, which covers the
     * ordinary noise of a sync connection, so that a consumer can surface the
     * two differently. See key-hierarchy-review/15-sync-replay-protection.md.
     */
    severity: 'info' | 'warning' | 'error'
    message: string
  }
  [FavaLibEvent.Ready]: EmptyObject
}

export type FavaLibEventMapEvents = {
  [K in keyof FavaLibEventMap]: CustomEvent<FavaLibEventMap[K]>
}
