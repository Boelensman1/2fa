import { randomBytes } from 'node:crypto'
import type { WebSocket } from 'ws'

import { verifyConnectProof } from 'favalib/protocol/connectAuth'
import type { ServerSecret } from 'favalib/types'

/**
 * How long a socket may stay unauthenticated, in milliseconds.
 *
 * A client answers the challenge in the same tick it receives it -- the proof is
 * one HMAC over a value it was just handed -- so this is a bound on sockets that
 * are not clients at all, not a budget for slow ones. Without it anything that
 * connects and says nothing sits in the map forever.
 */
const AUTH_TIMEOUT_MS = 10_000

/** The nonce length in raw bytes, before base64. */
const NONCE_BYTES = 32

/**
 * The close code every refusal uses: 4401, in the 4000-4999 range the WebSocket
 * spec leaves to applications.
 *
 * One code and one reason for all three ways this fails -- a wrong proof, a
 * message sent before the proof, a proof that never came. Distinguishing them
 * would tell whoever is probing which half they got right, and the client has
 * no use for the difference: all three mean "this server will not talk to you".
 */
export const UNAUTHORIZED_CLOSE_CODE = 4401

/** The reason string sent with it. Deliberately says nothing. */
export const UNAUTHORIZED_CLOSE_REASON = 'Unauthorized'

/**
 * Tracks how far each socket has got through the connection gate.
 *
 * The gate is a static secret shared by every device of a deployment, proved
 * with an HMAC over a nonce this class draws, so the secret never crosses the
 * wire. It answers "may this socket talk to us at all" and deliberately nothing
 * more: the `deviceId` a socket claims afterwards is as unverified as ever.
 *
 * Freshness lives here rather than in `verifyConnectProof`, which is handed a
 * nonce and cannot know whether it is still live. A nonce is drawn per socket
 * and consumed by the first proof against it, so one connection buys exactly
 * one guess and a captured proof is worth nothing on the next.
 */
class ConnectionAuthManager {
  private readonly pending = new Map<
    WebSocket,
    { nonce: string; timeout: NodeJS.Timeout }
  >()
  private readonly authenticated = new Set<WebSocket>()

  /**
   * @param sharedSecret - The secret this server was configured with.
   * @param onTimeout - Called with a socket that never proved itself, so the
   * caller can close it. Passed in rather than closing the socket here, so this
   * class owns state and the server owns the connection.
   */
  constructor(
    private readonly sharedSecret: ServerSecret,
    private readonly onTimeout: (ws: WebSocket) => void,
  ) {}

  /**
   * @returns The number of sockets that have proved the shared secret.
   */
  get size() {
    return this.authenticated.size
  }

  /**
   * Draws this socket's challenge and starts its clock.
   * @param ws - The socket that just connected.
   * @returns The base64 nonce to send to it.
   */
  public issueChallenge(ws: WebSocket): string {
    this.remove(ws)

    const nonce = randomBytes(NONCE_BYTES).toString('base64')
    const timeout = setTimeout(() => {
      this.pending.delete(ws)
      this.onTimeout(ws)
    }, AUTH_TIMEOUT_MS)
    // Nothing here should hold the process open: an idle server with one
    // half-open socket must still exit on its own.
    timeout.unref?.()

    this.pending.set(ws, { nonce, timeout })
    return nonce
  }

  /**
   * Checks a proof against the nonce this socket was challenged with.
   *
   * The nonce is consumed either way. A socket that guesses wrong does not get
   * a second attempt against the same challenge -- it gets closed, and a fresh
   * connection with a fresh nonce is the only way to try again.
   * @param ws - The socket that sent the proof.
   * @param proof - What it sent, which may be anything at all.
   * @returns Whether the socket is now authenticated.
   */
  public submitProof(ws: WebSocket, proof: unknown): boolean {
    const entry = this.pending.get(ws)
    if (!entry) {
      // No challenge outstanding: either this socket already proved itself and
      // is repeating, or it never had a nonce. Neither is a reason to hand out
      // another guess.
      return false
    }

    clearTimeout(entry.timeout)
    this.pending.delete(ws)

    if (
      typeof proof !== 'string' ||
      !verifyConnectProof(this.sharedSecret, entry.nonce, proof)
    ) {
      return false
    }

    this.authenticated.add(ws)
    return true
  }

  /**
   * @param ws - The socket to check.
   * @returns Whether this socket has proved the shared secret.
   */
  public isAuthenticated(ws: WebSocket): boolean {
    return this.authenticated.has(ws)
  }

  /**
   * Forgets a socket, whatever state it was in. Safe to call more than once.
   * @param ws - The socket that closed, or is being closed.
   */
  public remove(ws: WebSocket) {
    const entry = this.pending.get(ws)
    if (entry) {
      clearTimeout(entry.timeout)
      this.pending.delete(ws)
    }
    this.authenticated.delete(ws)
  }

  /**
   * Clears every timer, so a shut-down server leaves nothing running.
   */
  public clear() {
    for (const { timeout } of this.pending.values()) {
      clearTimeout(timeout)
    }
    this.pending.clear()
    this.authenticated.clear()
  }
}

export default ConnectionAuthManager
export { AUTH_TIMEOUT_MS }
