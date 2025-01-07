import type { Tagged } from 'type-fest'
import type { JPakeThreePass, Round1Result } from 'jpake-ts'
import { PublicKey, SyncKey } from './CryptoLib.mjs'

export type DeviceId = Tagged<string, 'DeviceId'>
export type DeviceType = Tagged<string, 'DeviceType'>

export interface SyncDevice {
  deviceId: DeviceId
  deviceType: DeviceType
  publicKey: PublicKey
}

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
  responderDeviceType: DeviceType
  syncKey: SyncKey
}

// Add device flow from the responder's perspective
export interface AddDeviceFlowResponder_Initiated extends BaseAddDeviceFlow {
  state: 'responder:initated'
  initiatorDeviceId: DeviceId
  responderDeviceId: DeviceId
  initiatorDeviceType: DeviceType
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
  initiatorDeviceType: DeviceType
  timestamp: number
  pass1Result: Record<keyof Round1Result, string>
}
