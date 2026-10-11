/**
 * Event, CustomEvent and EventTarget, which a JSContext lacks. FavaLib extends
 * EventTarget (through typescript-event-target) and dispatches CustomEvents;
 * the WebSocket polyfill is an EventTarget too.
 *
 * There is no tree, so no capture or bubbling phases: dispatch calls the
 * target's own listeners, in registration order.
 */

/**
 * A minimal DOM Event.
 */
export class EventPolyfill {
  readonly type: string
  readonly bubbles: boolean
  readonly cancelable: boolean
  readonly timeStamp = Date.now()
  defaultPrevented = false
  target: unknown = null
  currentTarget: unknown = null
  /** Set by stopImmediatePropagation; read by dispatchEvent. */
  stopped = false

  /**
   * @param type - The event type.
   * @param init - EventInit.
   * @param init.bubbles - Recorded, has no effect here.
   * @param init.cancelable - Whether preventDefault does anything.
   */
  constructor(
    type: string,
    init: { bubbles?: boolean; cancelable?: boolean } = {},
  ) {
    this.type = String(type)
    this.bubbles = !!init.bubbles
    this.cancelable = !!init.cancelable
  }

  /**
   * Marks the event as cancelled, if it is cancelable.
   */
  preventDefault() {
    if (this.cancelable) {
      this.defaultPrevented = true
    }
  }

  /**
   * Stops the remaining listeners on this target from running.
   */
  stopImmediatePropagation() {
    this.stopped = true
  }

  /**
   * No-op: there is no propagation path.
   */
  stopPropagation() {
    // Nothing to stop: dispatch only ever reaches the target itself.
  }
}

/**
 * A minimal DOM CustomEvent.
 */
export class CustomEventPolyfill<T = unknown> extends EventPolyfill {
  readonly detail: T | null

  /**
   * @param type - The event type.
   * @param init - CustomEventInit.
   * @param init.detail - The payload.
   * @param init.bubbles - Recorded, has no effect here.
   * @param init.cancelable - Whether preventDefault does anything.
   */
  constructor(
    type: string,
    init: { detail?: T; bubbles?: boolean; cancelable?: boolean } = {},
  ) {
    super(type, init)
    this.detail = init.detail ?? null
  }
}

type Listener =
  ((event: EventPolyfill) => void) | { handleEvent(event: EventPolyfill): void }

interface Registration {
  listener: Listener
  once: boolean
}

/**
 * A minimal DOM EventTarget.
 */
export class EventTargetPolyfill {
  #listeners = new Map<string, Registration[]>()

  /**
   * Adds a listener; adding the same one twice is a no-op, as in the DOM.
   * @param type - The event type.
   * @param listener - A function or an object with handleEvent.
   * @param options - `{ once }`, or a boolean (capture, ignored).
   */
  addEventListener(
    type: string,
    listener: Listener | null,
    options?: boolean | { once?: boolean },
  ) {
    if (!listener) {
      return
    }
    const list = this.#listeners.get(type) ?? []
    if (list.some((r) => r.listener === listener)) {
      return
    }
    const once = typeof options === 'object' && !!options.once
    list.push({ listener, once })
    this.#listeners.set(type, list)
  }

  /**
   * Removes a listener.
   * @param type - The event type.
   * @param listener - The listener that was added.
   */
  removeEventListener(type: string, listener: Listener | null) {
    const list = this.#listeners.get(type)
    if (list) {
      this.#listeners.set(
        type,
        list.filter((r) => r.listener !== listener),
      )
    }
  }

  /**
   * Calls this target's listeners for the event. A throwing listener is
   * reported and does not stop the others, as in the DOM.
   * @param event - The event.
   * @returns False if a listener called preventDefault on a cancelable event.
   */
  dispatchEvent(event: EventPolyfill): boolean {
    event.target = this
    event.currentTarget = this
    for (const registration of [...(this.#listeners.get(event.type) ?? [])]) {
      if (registration.once) {
        this.removeEventListener(event.type, registration.listener)
      }
      try {
        const { listener } = registration
        if (typeof listener === 'function') {
          listener.call(this, event)
        } else {
          listener.handleEvent(event)
        }
      } catch (error) {
        reportListenerError(error)
      }
      if (event.stopped) {
        break
      }
    }
    event.currentTarget = null
    return !event.defaultPrevented
  }
}

const reportListenerError = (error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  ;(globalThis as { console?: { error(m: string): void } }).console?.error(
    `Uncaught exception in event listener: ${message}`,
  )
}

/**
 * Installs whatever of the above the global object lacks.
 */
export const installEvents = () => {
  const g = globalThis as Record<string, unknown>
  g.Event ??= EventPolyfill
  g.CustomEvent ??= CustomEventPolyfill
  g.EventTarget ??= EventTargetPolyfill
}
