// The host contract for the jsc shell, which has no native bridge. Loaded
// before the bundle by tests/jsc.test.mts.
//
// NOT a real host: randomBytes is a seeded xorshift and argon2id a cheap
// stand-in (a real derivation in pure JS takes over a minute with the JIT
// off). Both are self-consistent, which is all this run checks: that the
// bundle loads and works on JavaScriptCore with nothing but ECMAScript.
// Real argon2 is covered by the node tests and the Swift tests.
;(() => {
  const shell = { print, setTimeout }
  for (const name of [
    'setTimeout',
    'clearTimeout',
    'atob',
    'btoa',
    'structuredClone',
    'WebAssembly',
    'console',
  ]) {
    try {
      delete globalThis[name]
    } catch {}
    if (typeof globalThis[name] !== 'undefined') {
      Object.defineProperty(globalThis, name, {
        value: undefined,
        configurable: true,
      })
    }
  }
  globalThis.__shellPrint = shell.print

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const b64 = (bytes) => {
    let out = ''
    for (let i = 0; i < bytes.length; i += 3) {
      const n =
        (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
      out += B64[n >> 18] + B64[(n >> 12) & 63]
      out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
      out += i + 2 < bytes.length ? B64[n & 63] : '='
    }
    return out
  }
  const unb64 = (s) => {
    const out = []
    let bits = 0
    let n = 0
    for (const ch of s.replace(/=+$/, '')) {
      bits = (bits << 6) | B64.indexOf(ch)
      n += 6
      if (n >= 8) {
        n -= 8
        out.push((bits >> n) & 255)
      }
    }
    return out
  }

  let seed = 0x2545f491
  const timers = new Map()
  let nextId = 1
  globalThis.__favaHost = {
    randomBytes(count) {
      const out = new Uint8Array(count)
      for (let i = 0; i < count; i++) {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        out[i] = seed & 255
      }
      return b64(out)
    },
    argon2id(password, salt, t, m, p, length) {
      const pw = unb64(password)
      const sa = unb64(salt)
      const out = new Uint8Array(length)
      for (let i = 0; i < length; i++) {
        out[i] =
          (pw[i % pw.length] ^ sa[i % sa.length] ^ (i * 31) ^ t ^ m ^ p) & 255
      }
      return b64(out)
    },
    setTimeout(callback, ms) {
      const id = nextId++
      timers.set(id, true)
      shell.setTimeout(() => {
        if (timers.delete(id)) callback()
      }, ms)
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    log(level, message) {
      if (level === 'error') shell.print(`[engine ${level}] ${message}`)
    },
    wsConnect() {
      throw new Error('no sockets in the jsc shell')
    },
    wsSend() {},
    wsClose() {},
    save(locked) {
      globalThis.__lastSave = locked
    },
    emit() {},
  }
})()
