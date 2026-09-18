import type { EmptyObject } from 'type-fest'
import type { FavaLibEvent } from '../FavaLibEvent.mjs'
import type { ConnectionStatus } from '../subclasses/SyncManager.mjs'
import type { DeviceFingerprint } from './BrandedTypes.mjs'
import type {
  AddDeviceFlowResult,
  DeviceId,
  DeviceInfo,
  SyncDeviceEnrolment,
} from './SyncTypes.mjs'

export interface FavaLibEventMap {
  [FavaLibEvent.Changed]: EmptyObject
  // Deliberately empty: a listener that cached credentials only needs to know
  // they are stale, and a payload here would be a payload carrying secrets.
  [FavaLibEvent.PasswordChanged]: EmptyObject
  [FavaLibEvent.LoadedFromLockedRepresentation]: EmptyObject
  [FavaLibEvent.ConnectToExistingVaultFinished]: EmptyObject
  [FavaLibEvent.AddDeviceFlowFinished]: AddDeviceFlowResult
  [FavaLibEvent.ConnectionToSyncServerStatusChanged]: {
    newStatus: ConnectionStatus
  }
  /**
   * Fires only for `via: 'peer'`. A device this vault paired with itself, or
   * this device registering itself, is an act the user performed in person at
   * both ends holding a 60-byte secret -- re-asking about it would be noise,
   * and noise is what stops the one that matters being read.
   */
  [FavaLibEvent.SyncDeviceAdded]: {
    deviceId: DeviceId
    fingerprint: DeviceFingerprint
    /** As the introducing peer described it, so attacker-chosen. */
    deviceInfo?: DeviceInfo
    enrolment: SyncDeviceEnrolment
  }
  [FavaLibEvent.Log]: {
    /**
     * `error` is for a refusal the user should be told about even though the
     * library carried on -- a vault arriving unrequested, a command that does
     * not verify. It is deliberately distinct from `warning`, which covers the
     * ordinary noise of a sync connection, so that a consumer can surface the
     * two differently.
     */
    severity: 'info' | 'warning' | 'error'
    message: string
  }
  [FavaLibEvent.Ready]: EmptyObject
}

export type FavaLibEventMapEvents = {
  [K in keyof FavaLibEventMap]: CustomEvent<FavaLibEventMap[K]>
}
