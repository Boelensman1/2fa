import { base64ToUint8Array } from 'uint8array-extras'

import { SyncError } from '../FavaLibError.mjs'
import type { DevicePublicKeys } from '../interfaces/CryptoLib.mjs'
import type {
  DeviceInfo,
  SyncDevice,
  SyncDeviceEnrolment,
} from '../interfaces/SyncTypes.mjs'
import {
  PUBLIC_KEY_BYTES,
  SIGNING_PUBLIC_KEY_BYTES,
} from '../platformProviders/shared/asymmetric.mjs'

/**
 * The most devices a vault's stored device list may hold.
 *
 * Counted on the STORED list, which includes this device's own record --
 * `SyncManager.getSyncDevices()` filters that one out, so the number a user
 * sees is one lower. Both places that enforce the cap (the load path in
 * creationUtils and `SyncManager.addSyncDevice`) count the stored list, so they
 * agree about the same vault.
 *
 * Not a capacity limit -- it is a bound on how much damage one malformed or
 * hostile vault state can do. Every outgoing command is sealed and signed once
 * per device (`SyncManager.sendCommand`), so an unbounded list is an unbounded
 * amount of work per keystroke.
 */
export const MAX_SYNC_DEVICES = 64

/**
 * How long each of the two base64 public keys is.
 *
 * Exact lengths, where storage version 1's RSA PEMs could only be given an
 * upper bound. The byte counts come from `platformProviders/shared/asymmetric`
 * rather than being written out here: they are a property of the primitives
 * that file chooses, and a copy of 1624 in this one would be a second source of
 * truth that only ever gets to be wrong.
 *
 * The two roles now have DIFFERENT lengths -- a key agreement key is X25519 ++
 * ML-KEM-768, a signing key Ed25519 ++ ML-DSA-65 -- so unlike the 32-byte curve
 * keys that preceded them, a pair swapped between the two fields no longer
 * validates. That is a free check and the reason these are two constants rather
 * than one.
 */
export const PUBLIC_KEY_LENGTH = base64Length(PUBLIC_KEY_BYTES)
export const SIGNING_PUBLIC_KEY_LENGTH = base64Length(SIGNING_PUBLIC_KEY_BYTES)

/**
 * The most removal tombstones a vault may keep.
 *
 * Four times the device cap, and the slack is the point. Pruning a tombstone
 * lets that device be introduced again, so unlike `15`'s replay floors -- where
 * pruning an id raises a floor and never weakens anything -- there is nothing
 * here to fall back on when an entry is dropped. A tight cap would therefore be
 * a way to forget a revocation by making enough other removals.
 *
 * It is capped at all for the reason MAX_SYNC_DEVICES exists: the record is
 * re-serialised and re-encrypted on every save, so an unbounded one is
 * unbounded work per keystroke.
 */
export const MAX_REMOVED_DEVICES = 256

/** The longest a device id may be. Ours are uuidv4, but a peer's is a string. */
const MAX_DEVICE_ID_LENGTH = 256

/** The longest a deviceType or deviceFriendlyName may be. */
const MAX_DEVICE_NAME_LENGTH = 256

/**
 * Checks that a value is a string within a length limit.
 * @param value - The value to check.
 * @param maxLength - The longest the value may be.
 * @returns True when the value is a usable non-empty string.
 */
const isBoundedString = (value: unknown, maxLength: number): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength

/**
 * How many base64 characters a given number of raw bytes encodes to.
 *
 * Padded base64, which is what `uint8ArrayToBase64` produces: four characters
 * per three bytes, rounded up.
 * @param bytes - The raw byte count.
 * @returns The encoded character count.
 */
function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

/**
 * Checks that a value is a base64 public key of exactly the right length.
 *
 * Both the length and the decode matter: the byte count is what the primitives
 * accept, and a string that is the right length but not base64 would otherwise
 * reach noble and fail there, in an error message that names a primitive.
 * @param value - The value to check, which may be anything at all.
 * @param expectedBytes - How many raw bytes this role's key decodes to.
 * @returns True when the value is a usable public key.
 */
const isPublicKey = (value: unknown, expectedBytes: number): boolean => {
  if (typeof value !== 'string' || value.length !== base64Length(expectedBytes)) {
    return false
  }
  try {
    return base64ToUint8Array(value).length === expectedBytes
  } catch {
    return false
  }
}

/**
 * Checks the optional deviceInfo of a sync device.
 * @param deviceInfo - The value to check, which may be anything at all.
 * @returns Null when it is usable or absent, otherwise the reason it is not.
 */
const validateDeviceInfo = (deviceInfo: unknown): string | null => {
  if (deviceInfo === undefined || deviceInfo === null) {
    return null
  }
  if (typeof deviceInfo !== 'object') {
    return 'device.deviceInfo is not an object'
  }

  const { deviceType, deviceFriendlyName } = deviceInfo as Partial<DeviceInfo>

  if (!isBoundedString(deviceType, MAX_DEVICE_NAME_LENGTH)) {
    return 'device.deviceInfo.deviceType is missing or too long'
  }
  if (
    deviceFriendlyName !== undefined &&
    deviceFriendlyName !== null &&
    !isBoundedString(deviceFriendlyName, MAX_DEVICE_NAME_LENGTH)
  ) {
    return 'device.deviceInfo.deviceFriendlyName is empty or too long'
  }

  return null
}

/** The three routes a device may record as its enrolment. */
const ENROLMENT_ROUTES = ['self', 'pairing', 'peer'] as const

/**
 * Checks the optional enrolment block of a sync device.
 *
 * Absent is valid and means the record predates the field. There is no route
 * meaning "unknown" precisely so that this stays true: a record whose
 * provenance was never captured says nothing rather than claiming something.
 * @param enrolment - The value to check, which may be anything at all.
 * @returns Null when it is usable or absent, otherwise the reason it is not.
 */
const validateEnrolment = (enrolment: unknown): string | null => {
  if (enrolment === undefined || enrolment === null) {
    return null
  }
  if (typeof enrolment !== 'object') {
    return 'device.enrolment is not an object'
  }

  const { via, by, at } = enrolment as Partial<SyncDeviceEnrolment>

  if (!ENROLMENT_ROUTES.includes(via!)) {
    return 'device.enrolment.via is not a known enrolment route'
  }
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    return 'device.enrolment.at is not a usable timestamp'
  }
  if (
    by !== undefined &&
    by !== null &&
    !isBoundedString(by, MAX_DEVICE_ID_LENGTH)
  ) {
    return 'device.enrolment.by is not a usable deviceId'
  }

  return null
}

/**
 * Checks the parts of a sync device without which it is simply unusable.
 *
 * A *shape* gate, and since storage version 2 an exact one: both public keys
 * are 32 raw bytes, so this checks the length and the base64 rather than
 * bounding a PEM the way it had to when the keys were RSA.
 *
 * It is still **not** the check that makes device enrolment safe, and never
 * was: a well formed record carrying an attacker's public keys passes every
 * test here. What decides whether one gets this far lives in
 * `SyncManager.addSyncDevice` and the signature check above it -- the sender
 * must already be a peer, keys are pinned on first receipt, a removed device
 * cannot be reintroduced, and a peer-introduced device is announced rather than
 * added quietly.
 * @param raw - The device to check, which may be anything at all.
 * @returns Null when the device is usable, otherwise the reason it is not.
 */
export const validateSyncDevice = (raw: unknown): string | null => {
  if (typeof raw !== 'object' || raw === null) {
    return 'device is not an object'
  }

  const device = raw as Partial<SyncDevice>

  if (!isBoundedString(device.deviceId, MAX_DEVICE_ID_LENGTH)) {
    return 'device has no usable deviceId'
  }
  if (!isPublicKey(device.publicKey, PUBLIC_KEY_BYTES)) {
    return 'device has no usable publicKey'
  }
  if (!isPublicKey(device.signingPublicKey, SIGNING_PUBLIC_KEY_BYTES)) {
    return 'device has no usable signingPublicKey'
  }
  if (
    device.acknowledgedAt !== undefined &&
    (typeof device.acknowledgedAt !== 'number' ||
      !Number.isFinite(device.acknowledgedAt))
  ) {
    return 'device.acknowledgedAt is not a usable timestamp'
  }

  const enrolmentReason = validateEnrolment(device.enrolment)
  if (enrolmentReason) {
    return enrolmentReason
  }

  return validateDeviceInfo(device.deviceInfo)
}

/**
 * Checks a vault's removal tombstones.
 *
 * Refused rather than reset when malformed, like the replay record and for the
 * same reason: starting over is the repair whose cost is invisible. A vault
 * that has forgotten what it removed works perfectly and quietly accepts a
 * device the user revoked.
 * @param raw - The value to check, which may be anything at all.
 * @returns Null when it is usable or absent, otherwise the reason it is not.
 */
export const validateRemovedDevices = (raw: unknown): string | null => {
  if (raw === undefined || raw === null) {
    return null
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return 'sync.removedDevices is not an object'
  }

  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > MAX_REMOVED_DEVICES) {
    return (
      `sync.removedDevices holds ${entries.length} tombstones, more than ` +
      `the ${MAX_REMOVED_DEVICES} allowed`
    )
  }
  for (const [deviceId, removedAt] of entries) {
    if (!isBoundedString(deviceId, MAX_DEVICE_ID_LENGTH)) {
      return 'sync.removedDevices has an unusable deviceId'
    }
    if (typeof removedAt !== 'number' || !Number.isFinite(removedAt)) {
      return `sync.removedDevices[${deviceId}] is not a usable timestamp`
    }
  }

  return null
}

/**
 * Reads a peer's two public keys out of the pairing handshake.
 *
 * They arrive encrypted under the JPAKE-derived sync key, so this is not a
 * trust boundary -- it is what makes a peer on a build that sends a different
 * shape fail here, while the user is still standing in front of both devices,
 * rather than at the first command it tries to verify.
 * @param serialised - The decrypted JSON from the handshake.
 * @returns The peer's public keys.
 * @throws {SyncError} If the payload is not a pair of usable public keys.
 */
export const parseDevicePublicKeys = (serialised: string): DevicePublicKeys => {
  let parsed: Partial<DevicePublicKeys>
  try {
    parsed = JSON.parse(serialised) as Partial<DevicePublicKeys>
  } catch {
    throw new SyncError('The other device sent unreadable public keys')
  }
  const { publicKey, signingPublicKey } = parsed ?? {}
  if (
    !publicKey ||
    !signingPublicKey ||
    !isPublicKey(publicKey, PUBLIC_KEY_BYTES) ||
    !isPublicKey(signingPublicKey, SIGNING_PUBLIC_KEY_BYTES)
  ) {
    throw new SyncError('The other device sent unusable public keys')
  }
  return { publicKey, signingPublicKey }
}
