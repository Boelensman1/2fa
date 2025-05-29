import type { Tagged } from 'type-fest'
import type { JPakeThreePass, Round1Result } from 'jpake-ts'
import type { PublicKey, SyncKey } from './CryptoLib.mjs'
import type { Vault, VaultSyncState } from './Vault.mjs'

export type DeviceId = Tagged<string, 'DeviceId'>
export type DeviceType = Tagged<string, 'DeviceType'>
export type DeviceFriendlyName = Tagged<string, 'DeviceFriendlyName'>

export interface DeviceInfo {
  deviceType: DeviceType
  deviceFriendlyName?: DeviceFriendlyName
}

export interface SyncDevice {
  deviceId: DeviceId
  publicKey: PublicKey
  deviceInfo?: DeviceInfo
}
export type PublicSyncDevice = Omit<SyncDevice, 'publicKey' | 'deviceInfo'> &
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

export interface AddDeviceFlowInitiator_SyncKeyCreated
  extends Omit<
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

export interface AddDeviceFlowResponder_SyncKeyCreated
  extends Omit<AddDeviceFlowResponder_Initiated, 'state'> {
  state: 'responder:syncKeyCreated'
  syncKey: SyncKey
}

export type ActiveAddDeviceFlow =
  | AddDeviceFlowInitiator_Initiated
  | AddDeviceFlowInitiator_SyncKeyCreated
  | AddDeviceFlowResponder_Initiated
  | AddDeviceFlowResponder_SyncKeyCreated

export interface InitiateAddDeviceFlowResult {
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
