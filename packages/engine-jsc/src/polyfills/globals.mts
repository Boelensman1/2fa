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
    g.setTimeout = (callback: unknown, ms = 0, ...args: unknown[]) =>
      getHost().setTimeout(call(callback, args), Math.max(0, Number(ms) || 0))
    g.clearTimeout = (id?: number) => {
      if (id !== undefined) getHost().clearTimeout(id)
    }

    // Intervals are chained timeouts. Each interval keeps one stable id and
    // maps it to whichever host timer is currently pending.
    const intervals = new Map<number, number>()
    let nextIntervalId = 1
    g.setInterval = (callback: unknown, ms = 0, ...args: unknown[]) => {
      const id = -nextIntervalId++
      const delay = Math.max(0, Number(ms) || 0)
      const tick = () => {
        if (!intervals.has(id)) return
        intervals.set(id, getHost().setTimeout(tick, delay))
        call(callback, args)()
      }
      intervals.set(id, getHost().setTimeout(tick, delay))
      return id
    }
    g.clearInterval = (id?: number) => {
      if (id === undefined) return
      const pending = intervals.get(id)
      intervals.delete(id)
      if (pending !== undefined) getHost().clearTimeout(pending)
    }
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
