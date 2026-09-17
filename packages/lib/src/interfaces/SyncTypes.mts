import type { Tagged } from 'type-fest'
import type { JPakeThreePass, Round1Result } from 'jpake-ts'
import type { PublicKey, SigningPublicKey, SyncKey } from './CryptoLib.mjs'
import type { Vault, VaultSyncState } from './Vault.mjs'
import type { DeviceId } from './BrandedTypes.mjs'

export type { DeviceId } from './BrandedTypes.mjs'
export type DeviceType = Tagged<string, 'DeviceType'>
export type DeviceFriendlyName = Tagged<string, 'DeviceFriendlyName'>

export interface DeviceInfo {
  deviceType: DeviceType
  deviceFriendlyName?: DeviceFriendlyName
}

export interface SyncDevice {
  deviceId: DeviceId
  /** The peer's X25519 public key: what this device seals messages to. */
  publicKey: PublicKey
  /**
   * The peer's Ed25519 public key: what this device verifies its commands
   * with.
   *
   * This is the credential the whole sync path's authenticity rests on, and it
   * is why removing a device from this list is now a revocation rather than
   * bookkeeping -- a peer that is not in it can no longer say anything this
   * device will act on. See
   * key-hierarchy-review/13-sync-command-authentication.md.
   */
  signingPublicKey: SigningPublicKey
  deviceInfo?: DeviceInfo
}
export type PublicSyncDevice = Omit<
  SyncDevice,
  'publicKey' | 'signingPublicKey' | 'deviceInfo'
> &
  Partial<SyncDevice['deviceInfo']>

export interface BaseAddDeviceFlow {
  jpak: JPakeThreePass
  addDevicePassword: Uint8Array
  timestamp: number
}

// Add device flow from the initiator's perspective
export interface AddDeviceFlowInitiator_Initiated extends BaseAddDeviceFlow {
  state: 'initiator:initiated'
  resolveContinuePromise: (value: unknown) => void
  initiatorDeviceId: DeviceId
  timeout: NodeJS.Timeout
}

export interface AddDeviceFlowInitiator_SyncKeyCreated extends Omit<
  AddDeviceFlowInitiator_Initiated,
  'state' | 'resolveContinuePromise'
> {
  state: 'initiator:syncKeyCreated'
  responderDeviceId: DeviceId
  syncKey: SyncKey
}

// Add device flow from the responder's perspective
export interface AddDeviceFlowResponder_Initiated extends BaseAddDeviceFlow {
  state: 'responder:initated'
  responderDeviceId: DeviceId
  initiatorDeviceId: DeviceId
}

export interface AddDeviceFlowResponder_SyncKeyCreated extends Omit<
  AddDeviceFlowResponder_Initiated,
  'state'
> {
  state: 'responder:syncKeyCreated'
  syncKey: SyncKey
}

export type ActiveAddDeviceFlow =
  | AddDeviceFlowInitiator_Initiated
  | AddDeviceFlowInitiator_SyncKeyCreated
  | AddDeviceFlowResponder_Initiated
  | AddDeviceFlowResponder_SyncKeyCreated

export interface InitiateAddDeviceFlowResult {
  /**
   * The JPAKE wire version this payload was produced with; see PAIRING_VERSION.
   * Absent on a payload written before the field existed, which is why the
   * responder checks it at runtime rather than trusting this type.
   */
  pairingVersion: string
  addDevicePassword: string
  initiatorDeviceId: DeviceId
  timestamp: number
  pass1Result: Record<keyof Round1Result, string>
}

export interface VaultStateSend {
  deviceId: DeviceId
  forDeviceId: DeviceId
  deviceFriendlyName?: DeviceFriendlyName
  vault: Vault
  sync: VaultSyncState
}
