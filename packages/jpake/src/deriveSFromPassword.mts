import { sha256 } from '@noble/hashes/sha256'
import { bytesToNumberBE } from '@noble/curves/abstract/utils'
import { mod } from '@noble/curves/abstract/modular'

import { n } from './constants.mjs'

/**
 * Derives s from a password using sha256. You might want to repeatedly hash the password or apply a key derivation function (e.g., PBKDF2, Argon2, or scrypt) to strengthen it and ensure more uniform distribution over the scalar field. This is particularly important if the password space is weak.
 * @param password - The password to derive s from.
 * @returns The derived s value.
 */
const deriveSFromPassword = (password: string): bigint => {
  if (!password) {
    throw new Error('Missing password')
  }

  let passwordHash = sha256(new TextEncoder().encode(password))
  let s = mod(bytesToNumberBE(passwordHash), n)

  // Retry if s is 0 (very unlikely)
  while (s === 0n) {
    passwordHash = sha256(new TextEncoder().encode(password + 'retried'))
    s = mod(bytesToNumberBE(passwordHash), n)
  }

  return s
}

export default deriveSFromPassword
