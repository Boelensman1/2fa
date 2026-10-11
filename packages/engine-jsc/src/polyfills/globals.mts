/**
 * The small globals a JSContext lacks that favalib or its dependencies touch:
 * timers and console (both backed by the host), queueMicrotask, and two
 * objects that exist only because a dependency reads them.
 */
import { getHost } from '../host.mjs'

/**
 * Installs whatever of the above the global object lacks.
 */
export const installGlobals = () => {
  const g = globalThis as Record<string, unknown>

  // openpgp resolves its own `globalThis` from window, global or self, and
  // silently falls back to `{}` -- where it then finds no crypto and throws
  // "The WebCrypto API is not available" from inside encrypt().
  g.self ??= globalThis
  // openpgp sniffs userAgent for an old Safari AES-GCM bug and reads
  // hardwareConcurrency. Neither applies: AES-GCM is ours (polyfills/crypto).
  g.navigator ??= { userAgent: 'favaenginejsc', hardwareConcurrency: 1 }

  g.queueMicrotask ??= (callback: () => void) => {
    Promise.resolve()
      .then(callback)
      .catch((error: unknown) => {
        getHost().log(
          'error',
          `Uncaught exception in microtask: ${String(error)}`,
        )
      })
  }

  if (typeof g.setTimeout !== 'function') {
    const call = (callback: unknown, args: unknown[]) => () => {
      try {
        if (typeof callback === 'function') {
          ;(callback as (...a: unknown[]) => void)(...args)
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error)
        getHost().log('error', `Uncaught exception in timer: ${message}`)
      }
    }
    // Intervals are chained timeouts. Each interval keeps one stable id -- the
    // host id of its first timer, so it shares the host's id space with plain
    // timeouts -- and maps it to whichever host timer is currently pending.
    // As in a browser, clearTimeout and clearInterval are interchangeable.
    const intervals = new Map<number, number>()
    g.setTimeout = (callback: unknown, ms = 0, ...args: unknown[]) =>
      getHost().setTimeout(call(callback, args), Math.max(0, Number(ms) || 0))
    g.setInterval = (callback: unknown, ms = 0, ...args: unknown[]) => {
      const delay = Math.max(0, Number(ms) || 0)
      let id = 0
      const tick = () => {
        if (!intervals.has(id)) return
        intervals.set(id, getHost().setTimeout(tick, delay))
        call(callback, args)()
      }
      id = getHost().setTimeout(tick, delay)
      intervals.set(id, id)
      return id
    }
    const clear = (id?: number) => {
      if (id === undefined) return
      const pending = intervals.get(id)
      intervals.delete(id)
      getHost().clearTimeout(pending ?? id)
    }
    g.clearTimeout = clear
    g.clearInterval = clear
  }

  if (typeof g.console !== 'object' || g.console === null) {
    const format = (args: unknown[]) =>
      args
        .map((a) => {
          if (typeof a === 'string') return a
          if (a instanceof Error) return a.stack ?? a.message
          try {
            return JSON.stringify(a)
          } catch {
            return String(a)
          }
        })
        .join(' ')
    const at =
      (level: 'debug' | 'info' | 'warn' | 'error') =>
      (...args: unknown[]) =>
        getHost().log(level, format(args))
    g.console = {
      debug: at('debug'),
      log: at('info'),
      info: at('info'),
      warn: at('warn'),
      error: at('error'),
    }
  }
}
