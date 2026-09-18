import { describe, it, expect } from 'vitest'

import type { ServerSecret } from '../../src/interfaces/BrandedTypes.mjs'
import {
  SERVER_SECRET_MIN_LENGTH,
  createConnectProof,
  verifyConnectProof,
} from '../../src/utils/connectAuth.mjs'
import { buildConnectAuthMessage } from '../../src/utils/canonical.mjs'

const secret = 'dev-only-sync-secret-not-for-real-use' as ServerSecret
const otherSecret = 'a-completely-different-shared-secret!' as ServerSecret
const nonce = 'Ej5mQe0Gk3aQwZ2t5xLb9mC1nR7vP4yH8sK2dF6uT0A='

describe('connectAuth', () => {
  describe('createConnectProof', () => {
    /**
     * The anchor. Client and server are separate packages computing this over
     * the same wire, so a change in the encoding, the hash or the key handling
     * has to fail here rather than as "every device is suddenly unauthorized"
     * after a deploy.
     *
     * The value was computed with node:crypto against a hand-written copy of
     * the encoding, NOT copied out of this implementation:
     *
     *   msg = '22:favalib:connectauth:v144:' + nonce
     *   createHmac('sha256', utf8(secret)).update(utf8(msg)).digest('base64')
     *
     * A vector taken from the code it pins only records what the code did.
     */
    it('is pinned to a known answer', () => {
      expect(createConnectProof(secret, nonce)).toBe(
        'Unn76q/+h+7hkY8+ub2ITFdyHAm/KTamLMO4nnBk5+Y=',
      )
    })

    it('covers the canonical message, not the bare nonce', () => {
      // If this ever passed, the length-prefixed encoding would not be in the
      // picture and the domain separator would be doing nothing.
      expect(createConnectProof(secret, nonce)).not.toBe(
        createConnectProof(secret, buildConnectAuthMessage(nonce)),
      )
    })

    it('is a different proof for a different nonce', () => {
      expect(createConnectProof(secret, nonce)).not.toBe(
        createConnectProof(secret, `${nonce}x`),
      )
    })

    it('is a different proof for a different secret', () => {
      expect(createConnectProof(secret, nonce)).not.toBe(
        createConnectProof(otherSecret, nonce),
      )
    })
  })

  describe('verifyConnectProof', () => {
    it('accepts the proof the same secret and nonce produce', () => {
      expect(
        verifyConnectProof(secret, nonce, createConnectProof(secret, nonce)),
      ).toBe(true)
    })

    it('refuses a proof made with another secret', () => {
      expect(
        verifyConnectProof(
          secret,
          nonce,
          createConnectProof(otherSecret, nonce),
        ),
      ).toBe(false)
    })

    it('refuses a proof made over another nonce', () => {
      // The replay case: a proof captured from an earlier connection is offered
      // against this connection's challenge.
      expect(
        verifyConnectProof(
          secret,
          nonce,
          createConnectProof(secret, 'an-earlier-nonce'),
        ),
      ).toBe(false)
    })

    it.each([
      ['empty', ''],
      ['not base64', 'not base64 at all!!'],
      ['truncated', createConnectProof(secret, nonce).slice(0, 20)],
      ['too long', `${createConnectProof(secret, nonce)}AAAA`],
      ['a single byte', 'AA=='],
    ])('refuses a %s proof rather than throwing', (_label, proof) => {
      // Never throws, for the reason CryptoLib.verify never does: the caller is
      // deciding whether to drop something that arrived from the network, and an
      // error naming the cause is an oracle.
      expect(() => verifyConnectProof(secret, nonce, proof)).not.toThrow()
      expect(verifyConnectProof(secret, nonce, proof)).toBe(false)
    })
  })

  it('asks for at least as much secret as openssl rand -base64 32 gives', () => {
    expect(SERVER_SECRET_MIN_LENGTH).toBe(32)
  })
})
