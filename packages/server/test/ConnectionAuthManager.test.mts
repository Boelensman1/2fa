import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { WebSocket } from 'ws'

import ConnectionAuthManager, {
  AUTH_TIMEOUT_MS,
} from '../src/ConnectionAuthManager.mjs'
import { createConnectProof } from 'favalib/protocol/connectAuth'
import type { ServerSecret } from 'favalib/types'

const secret = 'test-only-sync-secret-not-for-real-use' as ServerSecret
const otherSecret = 'a-completely-different-shared-secret!' as ServerSecret

/**
 * A socket only needs an identity here; nothing is sent through it.
 * @returns A distinct object to use as one.
 */
const makeWs = () => ({}) as WebSocket

describe('ConnectionAuthManager', () => {
  let onTimeout: ReturnType<typeof vi.fn<(ws: WebSocket) => void>>
  let manager: ConnectionAuthManager

  beforeEach(() => {
    onTimeout = vi.fn<(ws: WebSocket) => void>()
    manager = new ConnectionAuthManager(secret, onTimeout)
  })

  afterEach(() => {
    manager.clear()
    vi.useRealTimers()
  })

  it('starts a socket out unauthenticated', () => {
    const ws = makeWs()
    expect(manager.isAuthenticated(ws)).toBe(false)
    expect(manager.size).toBe(0)
  })

  it('authenticates a proof over the nonce it issued', () => {
    const ws = makeWs()
    const nonce = manager.issueChallenge(ws)

    expect(manager.submitProof(ws, createConnectProof(secret, nonce))).toBe(
      true,
    )
    expect(manager.isAuthenticated(ws)).toBe(true)
    expect(manager.size).toBe(1)
  })

  it('refuses a proof made with another secret', () => {
    const ws = makeWs()
    const nonce = manager.issueChallenge(ws)

    expect(
      manager.submitProof(ws, createConnectProof(otherSecret, nonce)),
    ).toBe(false)
    expect(manager.isAuthenticated(ws)).toBe(false)
  })

  it.each([
    ['a non-string', 42],
    ['undefined', undefined],
    ['an object', { proof: 'nice try' }],
    ['garbage', 'not base64 at all!!'],
  ])('refuses %s proof without throwing', (_label, proof) => {
    const ws = makeWs()
    manager.issueChallenge(ws)

    expect(() => manager.submitProof(ws, proof)).not.toThrow()
    expect(manager.isAuthenticated(ws)).toBe(false)
  })

  it('issues a different nonce to every socket', () => {
    // Otherwise one captured proof would open every connection.
    const nonces = new Set(
      Array.from({ length: 8 }, () => manager.issueChallenge(makeWs())),
    )
    expect(nonces.size).toBe(8)
  })

  it('consumes the nonce, so one connection is one guess', () => {
    const ws = makeWs()
    const nonce = manager.issueChallenge(ws)

    expect(manager.submitProof(ws, 'wrong')).toBe(false)
    // The right answer to a spent nonce is still refused: guessing means
    // reconnecting, which is what stops an online search over one socket.
    expect(manager.submitProof(ws, createConnectProof(secret, nonce))).toBe(
      false,
    )
  })

  it('refuses a proof from a socket that was never challenged', () => {
    expect(manager.submitProof(makeWs(), createConnectProof(secret, 'x'))).toBe(
      false,
    )
  })

  it('does not let an authenticated socket re-authenticate', () => {
    const ws = makeWs()
    const nonce = manager.issueChallenge(ws)
    manager.submitProof(ws, createConnectProof(secret, nonce))

    expect(manager.submitProof(ws, createConnectProof(secret, nonce))).toBe(
      false,
    )
    // Still in, though: a repeat proof is ignored, not a reason to drop it.
    expect(manager.isAuthenticated(ws)).toBe(true)
  })

  it('re-challenging a socket drops what it had', () => {
    const ws = makeWs()
    const first = manager.issueChallenge(ws)
    manager.issueChallenge(ws)

    expect(manager.submitProof(ws, createConnectProof(secret, first))).toBe(
      false,
    )
  })

  it('forgets a socket on remove', () => {
    const ws = makeWs()
    const nonce = manager.issueChallenge(ws)
    manager.submitProof(ws, createConnectProof(secret, nonce))

    manager.remove(ws)

    expect(manager.isAuthenticated(ws)).toBe(false)
    expect(manager.size).toBe(0)
  })

  it('tolerates removing a socket it has never seen', () => {
    expect(() => manager.remove(makeWs())).not.toThrow()
  })

  describe('the timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('reports a socket that never proved itself', () => {
      // Without this, anything that connects and says nothing sits in the map
      // for as long as it cares to.
      const ws = makeWs()
      manager.issueChallenge(ws)

      vi.advanceTimersByTime(AUTH_TIMEOUT_MS)

      expect(onTimeout).toHaveBeenCalledWith(ws)
      expect(manager.isAuthenticated(ws)).toBe(false)
    })

    it('does not fire once the socket is authenticated', () => {
      const ws = makeWs()
      const nonce = manager.issueChallenge(ws)
      manager.submitProof(ws, createConnectProof(secret, nonce))

      vi.advanceTimersByTime(AUTH_TIMEOUT_MS * 2)

      expect(onTimeout).not.toHaveBeenCalled()
      expect(manager.isAuthenticated(ws)).toBe(true)
    })

    it('does not fire for a socket that was removed first', () => {
      const ws = makeWs()
      manager.issueChallenge(ws)
      manager.remove(ws)

      vi.advanceTimersByTime(AUTH_TIMEOUT_MS * 2)

      expect(onTimeout).not.toHaveBeenCalled()
    })

    it('leaves nothing running after clear', () => {
      manager.issueChallenge(makeWs())
      manager.clear()

      vi.advanceTimersByTime(AUTH_TIMEOUT_MS * 2)

      expect(onTimeout).not.toHaveBeenCalled()
    })
  })
})
