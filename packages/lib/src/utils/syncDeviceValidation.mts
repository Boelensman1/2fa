import { base64ToUint8Array } from 'uint8array-extras'

import { SyncError } from '../FavaLibError.mjs'
import type { DevicePublicKeys } from '../interfaces/CryptoLib.mjs'
import type { DeviceInfo, SyncDevice } from '../interfaces/SyncTypes.mjs'

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
 * How long a base64 public key is: 32 raw bytes, so 44 characters including the
 * single padding character.
 *
 * An exact length, where storage version 1's RSA PEMs could only be given an
 * upper bound. X25519 and Ed25519 keys are both exactly this size, which is
 * also why nothing but the field name and the branded type keeps the two roles
 * apart -- there is no length to tell them by.
 */
export const PUBLIC_KEY_LENGTH = 44

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
 * Checks that a value is a base64 public key of exactly the right length.
 *
 * Both the length and the decode matter: 32 bytes is what the curves accept,
 * and a string that is the right length but not base64 would otherwise reach
 * noble and fail there, in an error message that names a primitive.
 * @param value - The value to check, which may be anything at all.
 * @returns True when the value is a usable public key.
 */
const isPublicKey = (value: unknown): boolean => {
  if (typeof value !== 'string' || value.length !== PUBLIC_KEY_LENGTH) {
    return false
  }
  try {
    return base64ToUint8Array(value).length === 32
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

/**
 * Checks the parts of a sync device without which it is simply unusable.
 *
 * A *shape* gate, and since storage version 2 an exact one: both public keys
 * are 32 raw bytes, so this checks the length and the base64 rather than
 * bounding a PEM the way it had to when the keys were RSA.
 *
 * It is still **not** the check that makes device enrolment safe. A well formed
 * record carrying an attacker's public keys passes every test here. What has
 * changed is who can get such a record in front of this function: an
 * `AddSyncDeviceCommand` now has to arrive signed by a device already in the
 * peer list, so enrolment is no longer open to anyone who has seen a public
 * key. Enrolment by a *trusted but hostile* peer, key pinning and a visible
 * new-device confirmation are still open --
 * key-hierarchy-review/14-sync-device-injection.md.
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
  if (!isPublicKey(device.publicKey)) {
    return 'device has no usable publicKey'
  }
  if (!isPublicKey(device.signingPublicKey)) {
    return 'device has no usable signingPublicKey'
  }

  return validateDeviceInfo(device.deviceInfo)
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
    !isPublicKey(publicKey) ||
    !isPublicKey(signingPublicKey)
  ) {
    throw new SyncError('The other device sent unusable public keys')
  }
  return { publicKey, signingPublicKey }
}
