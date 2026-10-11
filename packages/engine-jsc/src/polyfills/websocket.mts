/**
 * A WebSocket over the host's socket (URLSessionWebSocketTask on iOS).
 *
 * favalib's SyncManager needs exactly: the constructor, addEventListener for
 * open/message/close/error, send(text), close(), readyState and the static
 * `WebSocket.OPEN`. It has to be installed globally: the browser provider's
 * WebSocketLib returns the global `WebSocket`.
 */
import { base64ToBytes, Utf8Encoder } from './encoding.mjs'
import { EventPolyfill } from './events.mjs'
import { getHost } from '../host.mjs'

interface SocketEvent extends EventPolyfill {
  data?: string | ArrayBuffer
  code?: number
  reason?: string
  wasClean?: boolean
  message?: string
}

const namedError = (name: string, message: string) => {
  const error = new Error(message)
  error.name = name
  return error
}

/**
 * Builds the WebSocket class on top of whatever EventTarget is installed.
 * @returns The class.
 */
export const createWebSocketClass = () => {
  const Base = (globalThis as unknown as { EventTarget: typeof EventTarget })
    .EventTarget
  const EventCtor = (globalThis as unknown as { Event: typeof EventPolyfill })
    .Event

  return class WebSocket extends Base {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3

    readonly url: string
    readonly protocol = ''
    readonly extensions = ''
    /**
     * Binary frames arrive as ArrayBuffers. A browser defaults to 'blob', but
     * there is no Blob here, and fava's protocol is text anyway.
     */
    binaryType = 'arraybuffer'
    readyState = 0
    onopen: ((event: SocketEvent) => void) | null = null
    onmessage: ((event: SocketEvent) => void) | null = null
    onclose: ((event: SocketEvent) => void) | null = null
    onerror: ((event: SocketEvent) => void) | null = null
    readonly #id: number

    /**
     * @param url - A ws:// or wss:// url.
     */
    constructor(url: string | URL) {
      super()
      this.url = String(url)
      if (!/^wss?:\/\//i.test(this.url)) {
        throw namedError('SyntaxError', `Invalid WebSocket url: ${this.url}`)
      }
      this.#id = getHost().wsConnect(this.url, (type, a, b, c) => {
        this.#onHostEvent(type, a, b, c)
      })
    }

    #onHostEvent(
      type: 'open' | 'message' | 'close' | 'error',
      a?: string | number,
      b?: string | boolean,
      c?: boolean,
    ) {
      if (this.readyState === 3) return
      if (type === 'open') {
        // A close() while connecting can cross an open already on its way
        // from the host. A browser never reopens a closing socket.
        if (this.readyState !== 0) return
        this.readyState = 1
      }
      if (type === 'close') this.readyState = 3
      const event = new EventCtor(type) as SocketEvent
      if (type === 'message') {
        event.data =
          b === true ? base64ToBytes(String(a)).slice().buffer : String(a)
      }
      if (type === 'close') {
        event.code = Number(a ?? 1006)
        event.reason = typeof b === 'string' ? b : ''
        event.wasClean = c === true
      }
      if (type === 'error') event.message = String(a ?? '')
      this.dispatchEvent(event as unknown as Event)
      const handler = this[`on${type}`]
      if (typeof handler === 'function') handler.call(this, event)
    }

    /** Sends are not buffered on this side. */
    readonly bufferedAmount = 0

    /**
     * Sends a text frame.
     * @param data - The text.
     */
    send(data: string) {
      if (this.readyState !== 1) {
        throw namedError('InvalidStateError', 'WebSocket is not open')
      }
      getHost().wsSend(this.#id, String(data))
    }

    /**
     * Starts the closing handshake; `close` fires when it completes.
     * @param code - The close code: 1000, or 3000-4999 for applications.
     * @param reason - The close reason, at most 123 bytes of UTF-8.
     */
    close(code?: number, reason?: string) {
      // Checked before the state, as in a browser: a bad call throws even on
      // a socket that is already closing.
      if (code !== undefined) {
        code = Number(code)
        if (code !== 1000 && !(code >= 3000 && code <= 4999)) {
          throw namedError(
            'InvalidAccessError',
            `Invalid close code ${String(code)}`,
          )
        }
      }
      reason = reason === undefined ? '' : String(reason)
      if (new Utf8Encoder().encode(reason).length > 123) {
        throw namedError('SyntaxError', 'Close reason exceeds 123 bytes')
      }
      if (this.readyState >= 2) return
      this.readyState = 2
      getHost().wsClose(this.#id, Math.trunc(code ?? 1000), reason)
    }
  }
}

/**
 * Installs WebSocket if the global object lacks it.
 */
export const installWebSocket = () => {
  const g = globalThis as Record<string, unknown>
  g.WebSocket ??= createWebSocketClass()
}
