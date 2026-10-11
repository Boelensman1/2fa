/**
 * Runs the engine bundle the way iOS does, as closely as node allows: in a
 * fresh vm context, which starts with only the ECMAScript built-ins (no URL,
 * no TextEncoder, no crypto, no timers), with WebAssembly and console removed
 * as well. The host contract (src/host.mts) is implemented here with node's
 * own primitives, standing in for FavaHost.swift.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import vm from 'node:vm'
import { WebSocket as NodeWebSocket } from 'ws'

import type { FavaHost } from '../src/host.mjs'
import type { EngineError } from '../src/engine.mjs'

/** A loaded engine and what its host recorded. */
export interface TestEngine {
  /** favaEngine.call with JSON handled. Rejects with an EngineCallError. */
  call: <T = unknown>(method: string, ...args: unknown[]) => Promise<T>
  /** Every vault the engine saved, oldest first. */
  saves: string[]
  /** Every event the engine emitted. */
  events: { type: string; detail: unknown }[]
  /** How many argon2id derivations the host ran. */
  argon2Calls: () => number
  /** Evaluates an expression inside the engine's context. */
  evaluate: (code: string) => unknown
  /** Closes sockets and cancels timers. */
  dispose: () => void
}

/** A rejection from favaEngine.call, decoded. */
export class EngineCallError extends Error {
  readonly kind: string

  /**
   * @param error - The decoded engine error.
   */
  constructor(error: EngineError) {
    super(error.message)
    this.name = 'EngineCallError'
    this.kind = error.kind
  }
}

/**
 * node:crypto's argon2Sync, added in Node 24.7; the workspace's `@types/node`
 * predates it.
 */
const { argon2Sync } = crypto as unknown as {
  argon2Sync(
    this: void,
    algorithm: 'argon2id',
    parameters: {
      message: Uint8Array
      nonce: Uint8Array
      passes: number
      memory: number
      parallelism: number
      tagLength: number
    },
  ): Buffer
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const unb64 = (text: string) => Buffer.from(text, 'base64')

/**
 * Loads a bundle into a bare context.
 * @param bundlePath - The built bundle.
 * @param deviceType - Passed to configure().
 * @returns The engine.
 */
export const loadEngine = async (
  bundlePath: string,
  deviceType = 'test-ios',
): Promise<TestEngine> => {
  const saves: string[] = []
  const events: { type: string; detail: unknown }[] = []
  const timers = new Map<number, NodeJS.Timeout>()
  const sockets = new Map<number, NodeWebSocket>()
  let nextId = 1
  let argon2Calls = 0

  const host: FavaHost = {
    randomBytes: (count) => b64(crypto.randomBytes(count)),
    argon2id: (
      password,
      salt,
      iterations,
      memoryKiB,
      parallelism,
      hashLength,
    ) => {
      argon2Calls++
      return b64(
        argon2Sync('argon2id', {
          message: unb64(password),
          nonce: unb64(salt),
          passes: iterations,
          memory: memoryKiB,
          parallelism,
          tagLength: hashLength,
        }),
      )
    },
    setTimeout: (callback, ms) => {
      const id = nextId++
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id)
          callback()
        }, ms),
      )
      return id
    },
    clearTimeout: (id) => {
      clearTimeout(timers.get(id))
      timers.delete(id)
    },
    log: (level, message) => {
      if (level === 'error' && process.env.FAVA_TEST_LOGS === '1') {
        console.error(`[engine] ${message}`)
      }
    },
    wsConnect: (url, onEvent) => {
      const id = nextId++
      const ws = new NodeWebSocket(url)
      sockets.set(id, ws)
      ws.on('open', () => onEvent('open'))
      ws.on('message', (data: Buffer) =>
        onEvent('message', data.toString('utf8')),
      )
      ws.on('error', (error) => onEvent('error', error.message))
      ws.on('close', (code, reason) => {
        sockets.delete(id)
        onEvent('close', code, reason.toString('utf8'))
      })
      return id
    },
    wsSend: (id, text) => sockets.get(id)?.send(text),
    wsClose: (id, code, reason) => sockets.get(id)?.close(code, reason),
    save: (locked) => {
      saves.push(locked)
    },
    emit: (type, detailJson) => {
      events.push({ type, detail: JSON.parse(detailJson) as unknown })
    },
  }

  const context = vm.createContext({})
  vm.runInContext(
    'delete globalThis.WebAssembly; delete globalThis.console',
    context,
  )
  context.__favaHost = host
  vm.runInContext(fs.readFileSync(bundlePath, 'utf8'), context, {
    filename: 'fava-engine.js',
  })

  const engine = context.favaEngine as {
    call(method: string, argsJson: string): Promise<string>
  }
  const call = async <T,>(method: string, ...args: unknown[]): Promise<T> => {
    try {
      return JSON.parse(await engine.call(method, JSON.stringify(args))) as T
    } catch (error) {
      throw new EngineCallError(
        JSON.parse((error as { message: string }).message) as EngineError,
      )
    }
  }
  await call('configure', { deviceType, passwordExtraDict: ['phone'] })

  return {
    call,
    saves,
    events,
    argon2Calls: () => argon2Calls,
    evaluate: (code) => vm.runInContext(code, context) as unknown,
    dispose: () => {
      for (const timer of timers.values()) clearTimeout(timer)
      for (const ws of sockets.values()) ws.terminate()
    },
  }
}

/** A password that passes favalib's strength check. */
export const PASSWORD = 'correct-horse-battery-staple-ios-9!'

/** RFC 6238's example secret, as base32. */
export const TOTP_SECRET = 'JBSWY3DPEHPK3PXP'

/** The code TOTP_SECRET gives at 1700000000000 ms (SHA-1, 6 digits, 30 s). */
export const TOTP_AT_1700000000000 = '324550'
