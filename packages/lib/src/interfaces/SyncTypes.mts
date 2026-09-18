import type { Tagged } from 'type-fest'
import type { JPakeThreePass, Round1Result } from 'jpake-ts'
import type { PublicKey, SigningPublicKey, SyncKey } from './CryptoLib.mjs'
import type { Vault, VaultSyncState } from './Vault.mjs'
import type { DeviceFingerprint, DeviceId } from './BrandedTypes.mjs'

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
   * device will act on.
   */
  signingPublicKey: SigningPublicKey
  deviceInfo?: DeviceInfo
  /**
   * How this device came to be in the list.
   *
   * Local, and only ever written here: `SyncManager.addSyncDevice` builds the
   * stored record from the four fields above plus the route it was called on,
   * so an `enrolment` block arriving inside a peer's vault state is ignored
   * rather than trusted. A peer does not get to describe its own introduction.
   *
   * Optional because a record written before the field existed is legitimate
   * and cannot be reconstructed after the fact -- there is no fourth route
   * meaning "unknown", the absence says it.
   */
  enrolment?: SyncDeviceEnrolment
  /**
   * When a consumer told us it had shown this device to the user.
   *
   * Informational, and deliberately gates nothing: a peer is a peer whether or
   * not anyone has looked at it. Local, like `enrolment`.
   */
  acknowledgedAt?: number
}

/**
 * The three ways a device can enter this vault's peer list.
 *
 * - `self` -- this device, registered by its own SyncManager constructor.
 * - `pairing` -- a JPAKE flow this device took part in, so the user was
 *   standing in front of both ends holding a 60-byte out-of-band secret.
 * - `peer` -- a device already in the list said this one exists, either in an
 *   `AddSyncDeviceCommand` or in the device list of a resilvered vault. Nobody
 *   authorised this pair directly; it is trust arriving by delegation.
 */
export type SyncDeviceEnrolmentRoute = 'self' | 'pairing' | 'peer'

/**
 * How and when a device entered this vault's peer list.
 *
 * A type alias rather than an interface, and `PublicSyncDevice` likewise: an
 * interface has no implicit index signature, so it does not satisfy
 * `type-fest`'s `Jsonifiable` -- which is what `favacli` declares its command
 * output as. The old `Omit<...>` alias satisfied it by accident, being an
 * intersection; this says so on purpose. Both of these are JSON data crossing
 * an API boundary, so being assignable to `Jsonifiable` is a property they
 * should have rather than one they happen to have.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type SyncDeviceEnrolment = {
  via: SyncDeviceEnrolmentRoute
  /** The peer that introduced it, as verified. Set only when `via` is 'peer'. */
  by?: DeviceId
  at: number
}

/**
 * A sync device as a consumer may see it: no key material, plus a fingerprint.
 *
 * A type alias, for the reason given on SyncDeviceEnrolment.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type PublicSyncDevice = {
  deviceId: DeviceId
  deviceType?: DeviceType
  deviceFriendlyName?: DeviceFriendlyName
  /**
   * Both public keys, digested for a human to compare across two screens.
   *
   * This is what the friendly name cannot be: a peer chooses its own name, and
   * until this change could choose anyone else's too.
   */
  fingerprint: DeviceFingerprint
  enrolment?: SyncDeviceEnrolment
  /** False for a device a peer introduced that no consumer has surfaced yet. */
  acknowledged: boolean
}

export interface BaseAddDeviceFlow {
  jpak: JPakeThreePass
  addDevicePassword: Uint8Array
  timestamp: number
}

/** The sender's terminal pairing result; contains no pairing secrets. */
export type AddDeviceFlowResult =
  | { status: 'completed'; deviceId: DeviceId }
  | { status: 'cancelled' | 'failed'; reason: string }

// Add device flow from the initiator's perspective
export interface AddDeviceFlowInitiator_Initiated extends BaseAddDeviceFlow {
  state: 'initiator:initiated'
  resolveContinuePromise: (value: unknown) => void
  rejectContinuePromise: (reason: Error) => void
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
