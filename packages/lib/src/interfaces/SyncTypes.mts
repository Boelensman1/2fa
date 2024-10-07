import { Tagged } from 'type-fest'
import type { JPakeThreePass, Round1Result } from 'jpake'
import { PublicKey, SyncKey } from './CryptoLib.mjs'

export type UserId = Tagged<string, 'UserId'>

export interface SyncDevice {
  userId: string
  deviceIdentifier: string
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
  initiatorUserIdString: string
}

export interface AddDeviceFlowInitiator_SyncKeyCreated
  extends Omit<
    AddDeviceFlowInitiator_Initiated,
    'state' | 'resolveContinuePromise'
  > {
  state: 'initiator:syncKeyCreated'
  responderUserIdString: string
  responderDeviceIdentifier: string
  syncKey: SyncKey
}

// Add device flow from the responder's perspective
export interface AddDeviceFlowResponder_Initiated extends BaseAddDeviceFlow {
  state: 'responder:initated'
  initiatorUserIdString: string
  responderUserIdString: string
  initiatorDeviceIdentifier: string
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
  initiatorUserIdString: string
  initiatorDeviceIdentifier: string
  timestamp: number
  pass1Result: Record<keyof Round1Result, string>
}