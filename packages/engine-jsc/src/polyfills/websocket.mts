/**
 * A WebSocket over the host's socket (URLSessionWebSocketTask on iOS).
 *
 * favalib's SyncManager needs exactly: the constructor, addEventListener for
 * open/message/close/error, send(text), close(), readyState and the static
 * `WebSocket.OPEN`. It has to be installed globally: the browser provider's
 * WebSocketLib returns the global `WebSocket`.
 */
import { EventPolyfill } from './events.mjs'
import { getHost } from '../host.mjs'

interface SocketEvent extends EventPolyfill {
  data?: string
  code?: number
  reason?: string
  wasClean?: boolean
  message?: string
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
    binaryType = 'blob'
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
        const error = new Error(`Invalid WebSocket url: ${this.url}`)
        error.name = 'SyntaxError'
        throw error
      }
      this.#id = getHost().wsConnect(this.url, (type, a, b) => {
        this.#onHostEvent(type, a, b)
      })
    }

    #onHostEvent(
      type: 'open' | 'message' | 'close' | 'error',
      a?: string | number,
      b?: string,
    ) {
      if (this.readyState === 3) return
      if (type === 'open') this.readyState = 1
      if (type === 'close') this.readyState = 3
      const event = new EventCtor(type) as SocketEvent
      if (type === 'message') event.data = String(a)
      if (type === 'close') {
        event.code = Number(a ?? 1006)
        event.reason = b ?? ''
        event.wasClean = event.code === 1000
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
        const error = new Error('WebSocket is not open')
        error.name = 'InvalidStateError'
        throw error
      }
      getHost().wsSend(this.#id, String(data))
    }

    /**
     * Starts the closing handshake; `close` fires when it completes.
     * @param code - The close code.
     * @param reason - The close reason.
     */
    close(code = 1000, reason = '') {
      if (this.readyState >= 2) return
      this.readyState = 2
      getHost().wsClose(this.#id, code, reason)
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
