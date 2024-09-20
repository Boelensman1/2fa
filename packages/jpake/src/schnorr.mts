import { ProjPointType } from '@noble/curves/abstract/weierstrass'
import { secp256k1 } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { concatBytes } from '@noble/hashes/utils'
import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/abstract/utils'
import { mod } from '@noble/curves/abstract/modular'

import { n } from './constants.mjs'

// Implementation of Schnorr ZKP using https://www.rfc-editor.org/rfc/rfc8235

/**
 * Generates a Schnorr challenge.
 * @param userId - The user ID.
 * @param gx - The public key point.
 * @param gr - The random point.
 * @returns The challenge.
 * @throws {Error} if userId is too long (more than 255 bytes).
 */
export const generateSchnorrChallenge = (
  userId: string,
  gx: ProjPointType<bigint>,
  gr: ProjPointType<bigint>,
  otherInfo: string[] = [],
): bigint => {
  const userIdBytes = new TextEncoder().encode(userId)
  const gxBytes = gx.toRawBytes(true)
  const grBytes = gr.toRawBytes(true)

  if (userIdBytes.length > 255) {
    throw new Error(
      'userId is too long. It must be 255 bytes or less when UTF-8 encoded.',
    )
  }
  if (gxBytes.length > 255) {
    throw new Error('gxBytes is too long. It must be 255 bytes or less.')
  }
  if (grBytes.length > 255) {
    throw new Error('grBytes is too long. It must be 255 bytes or less.')
  }

  const challenge = mod(
    bytesToNumberBE(
      sha256(
        concatBytes(
          new Uint8Array([gxBytes.length]),
          gx.toRawBytes(true),

          new Uint8Array([grBytes.length]),
          gr.toRawBytes(true),

          new Uint8Array([userIdBytes.length]),
          userIdBytes,

          ...otherInfo.map((info) => {
            const infoBytes = new TextEncoder().encode(info)
            if (infoBytes.length > 255) {
              throw new Error(
                'Each otherInfo string must be 255 bytes or less when UTF-8 encoded.',
              )
            }
            return concatBytes(new Uint8Array([infoBytes.length]), infoBytes)
          }),
        ),
      ),
    ),
    n,
  )

  return challenge
}

/**
 * Generates a Schnorr proof.
 * @param  userId - The user ID.
 * @param  x - The private key.
 * @param  gx - The public key point.
 * @param  g - The generator point.
 * @returns The proof.
 * @throws {Error} If the generated proof is invalid.
 */
export const generateSchnorrProof = (
  userId: string,
  x: Uint8Array,
  gx: ProjPointType<bigint>,
  g: ProjPointType<bigint>,
  otherInfo: string[] = [],
): Uint8Array => {
  const v = bytesToNumberBE(secp256k1.utils.randomPrivateKey())

  const V = g.multiply(v)

  const challenge = generateSchnorrChallenge(userId, gx, V, otherInfo)

  const r = numberToBytesBE(mod(v - bytesToNumberBE(x) * challenge, n), 32)

  const Vbytes = V.toRawBytes(true)
  if (Vbytes.length !== 33 || r.length !== 32) {
    throw new Error(
      'Generated proof is invalid, V and r must be 33 and 32 bytes respectively',
    )
  }
  const proof = concatBytes(
    new Uint8Array([Vbytes.length]),
    Vbytes,
    new Uint8Array([r.length]),
    r,
  )

  // Verify the proof before returning it
  const isValidProof = verifySchnorrProof(userId, gx, proof, g, otherInfo)
  if (!isValidProof) {
    throw new Error('Generated Schnorr proof is invalid')
  }

  return proof
}

/**
 * Verifies a Schnorr proof.
 * @param peerUserId - The peer user ID.
 * @param gx - The public key point.
 * @param proof - The proof to verify.
 * @param g - The generator point.
 * @returns True if the proof is valid, false otherwise.
 */
export const verifySchnorrProof = (
  peerUserId: string,
  gx: ProjPointType<bigint>,
  proof: Uint8Array,
  g: ProjPointType<bigint>,
  otherInfo: string[] = [],
): boolean => {
  if (proof.length !== 33 + 32 + 2) {
    throw new Error('Invalid proof, must be 33 + 32 + 2 bytes long')
  }
  // get and verify lengths
  const VLength = proof[0]
  const rLength = proof[1 + VLength]
  if (VLength !== 33 || rLength !== 32) {
    throw new Error('Invalid proof, V must be 33 bytes and r must be 32 bytes')
  }

  // Extract V and r from the proof
  let V
  try {
    V = secp256k1.ProjectivePoint.fromHex(proof.slice(1, 1 + VLength))
  } catch {
    // Error: Point is not on curve, proof was tampered with
    return false
  }
  const r = bytesToNumberBE(
    proof.slice(1 + VLength + 1, 1 + VLength + 1 + rLength),
  )

  // Compute the challenge
  const c = generateSchnorrChallenge(peerUserId, gx, V, otherInfo)

  // Verify that V = G * [r] + gx * [c]
  const leftSide = V
  const rightSide = g.multiply(r).add(gx.multiply(c))

  // Convert both sides to affine coordinates for comparison
  // This is necessary because one side might be normalized (in affine form)
  // while the other might not be, leading to false negatives in the comparison
  const leftSideAffine = leftSide.toAffine()
  const rightSideAffine = rightSide.toAffine()

  const isValid =
    leftSideAffine.x === rightSideAffine.x &&
    leftSideAffine.y === rightSideAffine.y

  return isValid
}
