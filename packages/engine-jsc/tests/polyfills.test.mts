/**
 * The polyfills against node's native implementations of the same APIs. Node
 * has every one of these, so it is the reference: where the two disagree, the
 * polyfill is wrong.
 */
import crypto, { webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  atobPolyfill,
  btoaPolyfill,
  Utf8Decoder,
  Utf8Encoder,
} from '../src/polyfills/encoding.mjs'
import {
  CustomEventPolyfill,
  EventPolyfill,
  EventTargetPolyfill,
} from '../src/polyfills/events.mjs'
import {
  getRandomValues,
  randomUUID,
  subtle,
} from '../src/polyfills/crypto.mjs'
import { createWebSocketClass } from '../src/polyfills/websocket.mjs'
import type { FavaHost } from '../src/host.mjs'

beforeAll(() => {
  ;(globalThis as { __favaHost?: Partial<FavaHost> }).__favaHost = {
    randomBytes: (count: number) =>
      crypto.randomBytes(count).toString('base64'),
  }
})

const STRINGS = [
  '',
  'plain ascii',
  'héllo wörld',
  '日本語のテキスト',
  'emoji 🔐🗝️ and astral 𝔘𝔫𝔦𝔠𝔬𝔡𝔢',
  'lone high \ud800 surrogate',
  'lone low \udc00 surrogate',
  'reversed pair \udc00\ud800',
  'nul \u0000 and del \u007f and U+FFFF ￿',
]

describe('TextEncoder', () => {
  it.each(STRINGS)('encodes %j like the native one', (s) => {
    expect(new Utf8Encoder().encode(s)).toEqual(new TextEncoder().encode(s))
  })
})

describe('TextDecoder', () => {
  it.each(STRINGS)('round-trips %j like the native one', (s) => {
    const bytes = new TextEncoder().encode(s)
    expect(new Utf8Decoder().decode(bytes)).toBe(
      new TextDecoder().decode(bytes),
    )
  })

  it('replaces invalid sequences exactly like the native one', () => {
    for (let round = 0; round < 2000; round++) {
      const bytes = crypto.randomBytes(1 + (round % 24))
      expect(new Utf8Decoder().decode(bytes)).toBe(
        new TextDecoder().decode(bytes),
      )
    }
  })

  it('handles the classic edge cases like the native one', () => {
    const cases = [
      [0xc0, 0x80], // overlong NUL
      [0xe0, 0x80, 0x80], // overlong
      [0xed, 0xa0, 0x80], // encoded surrogate
      [0xf4, 0x90, 0x80, 0x80], // above U+10FFFF
      [0xf0, 0x9f, 0x94], // truncated 4-byte
      [0xef, 0xbb, 0xbf, 0x41], // BOM
      [0xff, 0xfe, 0x41],
    ]
    for (const c of cases) {
      const bytes = new Uint8Array(c)
      expect(new Utf8Decoder().decode(bytes)).toBe(
        new TextDecoder().decode(bytes),
      )
    }
  })

  it('throws on invalid input when fatal', () => {
    expect(() =>
      new Utf8Decoder('utf-8', { fatal: true }).decode(new Uint8Array([0xff])),
    ).toThrow(TypeError)
  })

  it('accepts a DataView and an offset view', () => {
    const buffer = new TextEncoder().encode('xxhéllo').buffer
    expect(new Utf8Decoder().decode(new DataView(buffer, 2))).toBe('héllo')
    expect(new Utf8Decoder().decode(new Uint8Array(buffer, 2))).toBe('héllo')
  })

  it('refuses encodings other than UTF-8', () => {
    expect(() => new Utf8Decoder('latin1')).toThrow(RangeError)
  })
})

describe('TextDecoder streaming', () => {
  const decodeInChunks = (
    decoder: {
      decode(input?: Uint8Array, options?: { stream?: boolean }): string
    },
    bytes: Uint8Array,
    cuts: number[],
  ) => {
    let out = ''
    let start = 0
    for (const cut of cuts) {
      out += decoder.decode(bytes.subarray(start, cut), { stream: true })
      start = cut
    }
    return out + decoder.decode(bytes.subarray(start))
  }

  it.each(STRINGS)(
    'decodes %j split at every point like the native one',
    (s) => {
      const bytes = new TextEncoder().encode(s)
      for (let cut = 0; cut <= bytes.length; cut++) {
        expect(decodeInChunks(new Utf8Decoder(), bytes, [cut])).toBe(
          decodeInChunks(new TextDecoder(), bytes, [cut]),
        )
      }
    },
  )

  it('matches the native one on random bytes in random chunks', () => {
    for (let round = 0; round < 500; round++) {
      const bytes = crypto.randomBytes(1 + (round % 32))
      const cuts = [...crypto.randomBytes(3)]
        .map((b) => b % (bytes.length + 1))
        .sort((x, y) => x - y)
      expect(decodeInChunks(new Utf8Decoder(), bytes, cuts)).toBe(
        decodeInChunks(new TextDecoder(), bytes, cuts),
      )
    }
  })

  it('strips a BOM split across chunks, once per stream', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xef, 0xbb, 0xbf])
    const ours = new Utf8Decoder()
    const native = new TextDecoder()
    for (const cuts of [[1], [2], [1, 2], [4], [5]]) {
      expect(decodeInChunks(ours, bytes, cuts)).toBe(
        decodeInChunks(native, bytes, cuts),
      )
    }
    // A second stream on the same decoder strips its own BOM again.
    expect(ours.decode(bytes)).toBe(native.decode(bytes))
  })

  it('reports a sequence left unfinished at the end of the stream', () => {
    const ours = new Utf8Decoder()
    const native = new TextDecoder()
    const head = new Uint8Array([0x41, 0xf0, 0x9f])
    expect(ours.decode(head, { stream: true }) + ours.decode()).toBe(
      native.decode(head, { stream: true }) + native.decode(),
    )
    const fatal = new Utf8Decoder('utf-8', { fatal: true })
    fatal.decode(head, { stream: true })
    expect(() => fatal.decode()).toThrow(TypeError)
  })
})

describe('btoa / atob', () => {
  it('match the native ones on every byte value and length', () => {
    for (let length = 0; length < 70; length++) {
      const binary = String.fromCharCode(
        ...crypto.randomBytes(length),
        ...(length === 0 ? [] : [0, 255]),
      )
      expect(btoaPolyfill(binary)).toBe(btoa(binary))
      expect(atobPolyfill(btoa(binary))).toBe(binary)
    }
  })

  it('accept whitespace and missing padding, as forgiving-base64 does', () => {
    expect(atobPolyfill(' aGVs\nbG8 ')).toBe(atob(' aGVs\nbG8 '))
    expect(atobPolyfill('aGVsbG8')).toBe(atob('aGVsbG8'))
  })

  it('reject what the native ones reject', () => {
    for (const bad of ['a', 'ab=c', '*abc', 'abc==']) {
      expect(() => atob(bad)).toThrow()
      expect(() => atobPolyfill(bad)).toThrow()
    }
    expect(() => btoaPolyfill('Ā')).toThrow()
  })
})

describe('crypto.subtle subset', () => {
  const keyBytes = crypto.randomBytes(32)
  const iv = crypto.randomBytes(12)
  const aad = crypto.randomBytes(20)
  const data = crypto.randomBytes(1000)

  it('digests like WebCrypto', async () => {
    for (const hash of ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']) {
      expect(new Uint8Array(await subtle.digest(hash, data))).toEqual(
        new Uint8Array(await webcrypto.subtle.digest(hash, data)),
      )
    }
  })

  it('AES-GCM encrypts like WebCrypto and decrypts what WebCrypto encrypts', async () => {
    const ours = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ])
    const native = await webcrypto.subtle.importKey(
      'raw',
      keyBytes,
      'AES-GCM',
      false,
      ['encrypt', 'decrypt'],
    )
    const params = { name: 'AES-GCM', iv, additionalData: aad }
    const nativeCipher = await webcrypto.subtle.encrypt(params, native, data)
    expect(new Uint8Array(await subtle.encrypt(params, ours, data))).toEqual(
      new Uint8Array(nativeCipher),
    )
    expect(
      new Uint8Array(await subtle.decrypt(params, ours, nativeCipher)),
    ).toEqual(new Uint8Array(data))
  })

  it('copies its inputs when called, as WebCrypto does', async () => {
    // openpgp's chunked AEAD rewrites its nonce and AAD buffers for the next
    // chunk while the previous encrypt is pending. Reading them late encrypted
    // under the wrong nonce: output only this shim could read back.
    const ours = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, [
      'encrypt',
    ])
    const native = await webcrypto.subtle.importKey(
      'raw',
      keyBytes,
      'AES-GCM',
      false,
      ['encrypt'],
    )
    const expected = new Uint8Array(
      await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad },
        native,
        data,
      ),
    )
    const scratchIv = Uint8Array.from(iv)
    const scratchAad = Uint8Array.from(aad)
    const scratchData = Uint8Array.from(data)
    const pending = subtle.encrypt(
      { name: 'AES-GCM', iv: scratchIv, additionalData: scratchAad },
      ours,
      scratchData,
    )
    scratchIv.fill(0)
    scratchAad.fill(0)
    scratchData.fill(0)
    expect(new Uint8Array(await pending)).toEqual(expected)
  })

  it('AES-GCM rejects tampering with OperationError', async () => {
    const key = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ])
    const cipher = new Uint8Array(
      await subtle.encrypt({ name: 'AES-GCM', iv }, key, data),
    )
    cipher[5] ^= 1
    await expect(
      subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher),
    ).rejects.toMatchObject({ name: 'OperationError' })
  })

  it('HMAC signs and verifies like WebCrypto', async () => {
    const algorithm = { name: 'HMAC', hash: 'SHA-256' }
    const ours = await subtle.importKey('raw', keyBytes, algorithm, false, [
      'sign',
      'verify',
    ])
    const native = await webcrypto.subtle.importKey(
      'raw',
      keyBytes,
      algorithm,
      false,
      ['sign'],
    )
    const mac = await webcrypto.subtle.sign('HMAC', native, data)
    expect(new Uint8Array(await subtle.sign('HMAC', ours, data))).toEqual(
      new Uint8Array(mac),
    )
    expect(await subtle.verify('HMAC', ours, mac, data)).toBe(true)
    const wrong = new Uint8Array(mac)
    wrong[0] ^= 1
    expect(await subtle.verify('HMAC', ours, wrong, data)).toBe(false)
  })

  it('HKDF derives like WebCrypto', async () => {
    const params = { name: 'HKDF', hash: 'SHA-256', salt: iv, info: aad }
    const ours = await subtle.importKey('raw', keyBytes, 'HKDF', false, [
      'deriveBits',
    ])
    const native = await webcrypto.subtle.importKey(
      'raw',
      keyBytes,
      'HKDF',
      false,
      ['deriveBits'],
    )
    expect(new Uint8Array(await subtle.deriveBits(params, ours, 256))).toEqual(
      new Uint8Array(await webcrypto.subtle.deriveBits(params, native, 256)),
    )
  })

  it('generates and exports AES keys that WebCrypto accepts', async () => {
    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    )
    const raw = await subtle.exportKey('raw', key)
    expect(raw.byteLength).toBe(32)
    await webcrypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
  })

  it('enforces usages, extractability and algorithms as WebCrypto does', async () => {
    const encryptOnly = await subtle.importKey(
      'raw',
      keyBytes,
      'AES-GCM',
      false,
      ['encrypt'],
    )
    await expect(
      subtle.decrypt({ name: 'AES-GCM', iv }, encryptOnly, data),
    ).rejects.toMatchObject({ name: 'InvalidAccessError' })
    await expect(subtle.exportKey('raw', encryptOnly)).rejects.toMatchObject({
      name: 'InvalidAccessError',
    })
    await expect(
      subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['sign']),
    ).rejects.toMatchObject({ name: 'SyntaxError' })
    const hmacKey = await subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    await expect(
      subtle.encrypt({ name: 'AES-GCM', iv }, hmacKey, data),
    ).rejects.toMatchObject({ name: 'InvalidAccessError' })
  })

  it('refuses what it does not implement with NotSupportedError', async () => {
    await expect(
      subtle.generateKey({ name: 'Ed25519' }, true, ['sign']),
    ).rejects.toMatchObject({ name: 'NotSupportedError' })
    await expect(
      subtle.importKey('jwk', {}, 'AES-GCM', false, ['encrypt']),
    ).rejects.toMatchObject({ name: 'NotSupportedError' })
    await expect(
      subtle.encrypt({ name: 'AES-CBC', iv }, {}, data),
    ).rejects.toMatchObject({ name: 'NotSupportedError' })
  })

  it('rejects the keys WebCrypto rejects, with the same error', async () => {
    const hmac = { name: 'HMAC', hash: 'SHA-256' }
    const cases: [string, (api: typeof subtle) => Promise<unknown>][] = [
      [
        'empty usages',
        (api) => api.importKey('raw', keyBytes, 'AES-GCM', false, []),
      ],
      [
        'empty HMAC usages',
        (api) => api.importKey('raw', keyBytes, hmac, false, []),
      ],
      [
        'an extractable HKDF key',
        (api) => api.importKey('raw', keyBytes, 'HKDF', true, ['deriveBits']),
      ],
      [
        'an empty HMAC key',
        (api) => api.importKey('raw', new Uint8Array(0), hmac, false, ['sign']),
      ],
      [
        'generateKey without usages',
        (api) => api.generateKey({ name: 'AES-GCM', length: 256 }, false, []),
      ],
      [
        'generateKey with a foreign usage',
        (api) =>
          api.generateKey({ name: 'AES-GCM', length: 256 }, false, ['sign']),
      ],
    ]
    const native = webcrypto.subtle as unknown as typeof subtle
    for (const [what, attempt] of cases) {
      const nativeError = (await attempt(native).then(
        () => null,
        (e: unknown) => e,
      )) as { name: string } | null
      expect(nativeError, what).not.toBeNull()
      await expect(attempt(subtle), what).rejects.toMatchObject({
        name: nativeError?.name,
      })
    }
  })

  it('keeps key bytes off the key object', async () => {
    const key = await subtle.importKey('raw', keyBytes, 'AES-GCM', true, [
      'encrypt',
    ])
    expect(JSON.stringify(key)).not.toContain(keyBytes.toString('base64'))
    expect(Object.values(key)).not.toContainEqual(expect.any(Uint8Array))
  })
})

describe('getRandomValues / randomUUID', () => {
  it('fills integer arrays from the host and refuses the rest', () => {
    const a = getRandomValues(new Uint32Array(8))
    expect(a.some((x) => x !== 0)).toBe(true)
    expect(() => getRandomValues(new Float64Array(2))).toThrow()
    expect(() => getRandomValues(new Uint8Array(65537))).toThrow()
  })

  it('makes v4 UUIDs', () => {
    expect(randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})

describe('EventTarget', () => {
  it('calls listeners in order, honours once and removal', () => {
    const target = new EventTargetPolyfill()
    const calls: string[] = []
    const a = () => calls.push('a')
    target.addEventListener('x', a)
    target.addEventListener('x', a) // duplicate, ignored
    target.addEventListener('x', () => calls.push('once'), { once: true })
    target.addEventListener('x', { handleEvent: () => calls.push('obj') })
    target.dispatchEvent(new EventPolyfill('x'))
    target.removeEventListener('x', a)
    target.dispatchEvent(new EventPolyfill('x'))
    expect(calls).toEqual(['a', 'once', 'obj', 'obj'])
  })

  it('sets target, carries CustomEvent detail and survives a throwing listener', () => {
    const target = new EventTargetPolyfill()
    const seen: unknown[] = []
    target.addEventListener('y', () => {
      throw new TypeError('listener bug')
    })
    target.addEventListener('y', (e) => {
      seen.push(e.target, (e as CustomEventPolyfill<number>).detail)
    })
    target.dispatchEvent(new CustomEventPolyfill('y', { detail: 42 }))
    expect(seen).toEqual([target, 42])
  })

  it('stops at stopImmediatePropagation and reports preventDefault', () => {
    const target = new EventTargetPolyfill()
    const calls: string[] = []
    target.addEventListener('z', (e) => {
      calls.push('first')
      e.preventDefault()
      e.stopImmediatePropagation()
    })
    target.addEventListener('z', () => calls.push('second'))
    expect(
      target.dispatchEvent(new EventPolyfill('z', { cancelable: true })),
    ).toBe(false)
    expect(calls).toEqual(['first'])
  })
})

describe('EventTarget, against the DOM', () => {
  const targets = () =>
    [
      ['ours', new EventTargetPolyfill(), (t: string) => new EventPolyfill(t)],
      ['native', new EventTarget(), (t: string) => new Event(t)],
    ] as const

  it('skips a listener removed by an earlier one in the same dispatch', () => {
    const results = targets().map(([, target, makeEvent]) => {
      const calls: string[] = []
      const second = () => calls.push('second')
      target.addEventListener('x', () => {
        calls.push('first')
        target.removeEventListener('x', second)
      })
      target.addEventListener('x', second)
      target.dispatchEvent(makeEvent('x') as Event & EventPolyfill)
      return calls
    })
    expect(results[0]).toEqual(['first'])
    expect(results[0]).toEqual(results[1])
  })

  it('lets an event that was stopped be dispatched again', () => {
    const run = (
      makeTarget: () => EventTarget,
      makeEvent: (type: string) => Event,
    ) => {
      const calls: string[] = []
      const first = makeTarget()
      first.addEventListener('x', (e: Event) => {
        calls.push('first')
        e.stopImmediatePropagation()
      })
      const second = makeTarget()
      second.addEventListener('x', () => calls.push('second'))
      const event = makeEvent('x')
      first.dispatchEvent(event)
      second.dispatchEvent(event)
      return calls
    }
    // The DOM spec unsets the stop flags when dispatch ends (§2.9, step
    // "Unset event's dispatch flag, stop propagation flag, and stop immediate
    // propagation flag"), and browsers follow it. Node does not, so this one
    // is checked against the spec rather than against node.
    expect(
      run(
        () => new EventTargetPolyfill() as unknown as EventTarget,
        (t) => new EventPolyfill(t) as unknown as Event,
      ),
    ).toEqual(['first', 'second'])
  })
})

describe('WebSocket', () => {
  type OnEvent = Parameters<FavaHost['wsConnect']>[1]
  const setUp = () => {
    const host = {
      onEvent: undefined as OnEvent | undefined,
      closes: [] as [number, string][],
      sends: [] as string[],
    }
    const g = globalThis as { __favaHost?: Partial<FavaHost> }
    g.__favaHost = {
      ...g.__favaHost,
      wsConnect: (_url, onEvent) => {
        host.onEvent = onEvent
        return 1
      },
      wsSend: (_id, text) => host.sends.push(text),
      wsClose: (_id, code, reason) => host.closes.push([code, reason]),
    }
    const WebSocketClass = createWebSocketClass()
    const socket = new WebSocketClass('wss://example.test/sync')
    const seen: { type: string; data?: unknown; wasClean?: boolean }[] = []
    for (const type of ['open', 'message', 'close', 'error']) {
      socket.addEventListener(type, (e) => {
        const event = e as unknown as { data?: unknown; wasClean?: boolean }
        seen.push({ type, data: event.data, wasClean: event.wasClean })
      })
    }
    return { host, socket, seen }
  }

  it('does not reopen a socket closed while connecting', () => {
    const { host, socket, seen } = setUp()
    socket.close()
    host.onEvent?.('open')
    expect(socket.readyState).toBe(2)
    expect(() => socket.send('x')).toThrow()
    host.onEvent?.('close', 1006, '', false)
    expect(socket.readyState).toBe(3)
    expect(seen.map((e) => e.type)).toEqual(['close'])
    expect(host.closes).toEqual([[1000, '']])
  })

  it('validates close codes and reasons like a browser', () => {
    const { socket, host } = setUp()
    expect(() => socket.close(1001)).toThrow(
      expect.objectContaining({ name: 'InvalidAccessError' }) as Error,
    )
    expect(() => socket.close(5000)).toThrow(
      expect.objectContaining({ name: 'InvalidAccessError' }) as Error,
    )
    expect(() => socket.close(1000, 'é'.repeat(62))).toThrow(
      expect.objectContaining({ name: 'SyntaxError' }) as Error,
    )
    expect(host.closes).toEqual([])
    socket.close(4001, 'bye')
    expect(host.closes).toEqual([[4001, 'bye']])
  })

  it('reports wasClean as the host says, and binary frames as ArrayBuffers', () => {
    const { host, seen } = setUp()
    host.onEvent?.('open')
    host.onEvent?.('message', 'text')
    host.onEvent?.('message', Buffer.from([1, 2, 3]).toString('base64'), true)
    host.onEvent?.('close', 1000, '', false)
    expect(seen[1].data).toBe('text')
    expect(seen[2].data).toBeInstanceOf(ArrayBuffer)
    expect([...new Uint8Array(seen[2].data as ArrayBuffer)]).toEqual([1, 2, 3])
    expect(seen[3]).toMatchObject({ type: 'close', wasClean: false })
  })
})
