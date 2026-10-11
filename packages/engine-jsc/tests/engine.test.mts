/**
 * The built bundle, through favaEngine.call, in a context with nothing but
 * the ECMAScript built-ins -- what an iOS JSContext gives it.
 */
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import {
  getFavaLibVaultCreationUtils,
  type DeviceType,
  type EntryMetaWithToken,
  type LockedRepresentationString,
  type Password,
} from 'favalib'
import { nodeProviders } from 'favalib/platformProviders/node'

import {
  EngineCallError,
  loadEngine,
  PASSWORD,
  TOTP_AT_1700000000000,
  TOTP_SECRET,
  type TestEngine,
} from './harness.mjs'

const newEntry = (name: string, secret = TOTP_SECRET) => ({
  name,
  issuer: 'Fava',
  type: 'TOTP',
  payload: { secret, period: 30, algorithm: 'SHA-1', digits: 6 },
})

let engine: TestEngine
beforeEach(async () => {
  engine = await loadEngine(inject('productionBundle'))
})
afterEach(() => engine.dispose())

describe('the context', () => {
  it('starts without the web platform, like a JSContext', async () => {
    // The polyfills fill these in; WebAssembly stays absent.
    expect(engine.evaluate('typeof WebAssembly')).toBe('undefined')
    const bare: unknown = await import('node:vm').then((vm): unknown =>
      vm.runInNewContext(
        '[typeof URL, typeof TextEncoder, typeof crypto, typeof setTimeout, typeof EventTarget]',
      ),
    )
    expect(bare).toEqual([
      'undefined',
      'undefined',
      'undefined',
      'undefined',
      'undefined',
    ])
    expect(
      engine.evaluate('[typeof URL, typeof crypto.subtle, typeof WebSocket]'),
    ).toEqual(['function', 'object', 'function'])
  })
})

describe('the host timers', () => {
  it('treat clearTimeout and clearInterval as interchangeable', async () => {
    engine.evaluate(`
      globalThis.__fired = []
      const interval = setInterval(() => __fired.push('interval'), 5)
      clearTimeout(interval)
      const timeout = setTimeout(() => __fired.push('timeout'), 5)
      clearInterval(timeout)
      const kept = setInterval(() => {
        __fired.push('kept')
        clearInterval(kept)
      }, 5)
    `)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(engine.evaluate('__fired')).toEqual(['kept'])
  })
})

describe('without a vault', () => {
  it('reports usage errors with a stable kind', async () => {
    await expect(engine.call('listEntries')).rejects.toMatchObject({
      kind: 'usage',
    })
    await expect(engine.call('noSuchMethod')).rejects.toMatchObject({
      kind: 'usage',
    })
    await expect(engine.call('toString')).rejects.toMatchObject({
      kind: 'usage',
    })
    expect(await engine.call('status')).toEqual({
      unlocked: false,
      syncConfigured: false,
      syncConnected: false,
    })
  })

  it('rates passwords', async () => {
    const weak = await engine.call<{ score: number }>(
      'passwordStrength',
      'password1',
    )
    const strong = await engine.call<{ score: number }>(
      'passwordStrength',
      PASSWORD,
    )
    expect(weak.score).toBeLessThan(strong.score)
  })
})

describe('a vault', () => {
  beforeEach(async () => {
    await engine.call('createVault', PASSWORD)
  })

  it('is saved through the host when created and when changed', async () => {
    expect(engine.saves.length).toBeGreaterThan(0)
    const before = engine.saves.length
    await engine.call('addEntry', newEntry('A'))
    expect(engine.saves.length).toBeGreaterThan(before)
    expect(engine.events.map((e) => e.type)).toContain('changed')
  })

  it('generates the RFC 6238 code', async () => {
    const id = await engine.call<string>('addEntry', newEntry('A'))
    const token = await engine.call<{ otp: string }>('token', id, 1700000000000)
    expect(token.otp).toBe(TOTP_AT_1700000000000)
  })

  it('lists, searches, updates and deletes entries', async () => {
    const a = await engine.call<string>('addEntry', newEntry('Alpha'))
    await engine.call('addEntry', newEntry('Beta'))
    const all = await engine.call<EntryMetaWithToken[]>('listEntries')
    expect(all.map((e) => e.name).sort()).toEqual(['Alpha', 'Beta'])
    expect(all[0].token.otp).toMatch(/^\d{6}$/)
    const found = await engine.call<EntryMetaWithToken[]>('listEntries', 'alp')
    expect(found.map((e) => e.name)).toEqual(['Alpha'])
    await engine.call('updateEntry', a, { name: 'Alpha 2' })
    await engine.call('deleteEntry', a)
    const left = await engine.call<EntryMetaWithToken[]>('listEntries')
    expect(left.map((e) => e.name)).toEqual(['Beta'])
  })

  it('imports otpauth uris, which needs URL and URLSearchParams', async () => {
    await engine.call(
      'importUri',
      'otpauth://totp/ACME:alice%40example.com?secret=GEZDGNBVGY3TQOJQ&issuer=ACME&digits=8&period=60',
    )
    const [entry] = await engine.call<EntryMetaWithToken[]>('listEntries')
    expect(entry).toMatchObject({ name: 'alice@example.com', issuer: 'ACME' })
    expect(entry.token.otp).toMatch(/^\d{8}$/)
  })

  it('matches entries to urls for AutoFill', async () => {
    await engine.call('addEntry', {
      ...newEntry('GitHub'),
      matchers: [{ type: 'BaseDomain', value: 'github.com' }],
    })
    await engine.call('addEntry', newEntry('Other'))
    const hits = await engine.call<EntryMetaWithToken[]>(
      'entriesForUrl',
      'https://github.com/login',
    )
    expect(hits.map((e) => e.name)).toEqual(['GitHub'])
  })

  it('round-trips an encrypted export (openpgp with argon2 on the host)', async () => {
    await engine.call('addEntry', newEntry('Exported'))
    const before = engine.argon2Calls()
    const exported = await engine.call<string>(
      'exportText',
      'export-password-1',
    )
    expect(exported).toContain('-----BEGIN PGP MESSAGE-----')
    expect(engine.argon2Calls()).toBeGreaterThan(before)
    const results = await engine.call<{ entryId: string | null }[]>(
      'importText',
      exported,
      'export-password-1',
    )
    expect(results.filter((r) => r.entryId)).toHaveLength(1)
    await expect(
      engine.call('importText', exported, 'wrong-password'),
    ).rejects.toBeInstanceOf(EngineCallError)
  })

  it('refuses a plaintext export unless the user was warned', async () => {
    await expect(engine.call('exportText', null)).rejects.toMatchObject({
      kind: 'favalib',
    })
    const plaintext = await engine.call<string>('exportText', null, true)
    expect(plaintext).toContain('fava-export-version')
  })

  it('locks, and unlocks with the password', async () => {
    await engine.call('addEntry', newEntry('Kept'))
    const saved = engine.saves.at(-1)
    await engine.call('lock')
    await expect(engine.call('listEntries')).rejects.toMatchObject({
      kind: 'usage',
    })
    await engine.call('unlockWithPassword', saved, PASSWORD, false)
    const entries = await engine.call<EntryMetaWithToken[]>('listEntries')
    expect(entries.map((e) => e.name)).toEqual(['Kept'])
  })

  it('discards an unlock that a lock overtook', async () => {
    const saved = engine.saves.at(-1)
    await engine.call('lock')
    // Not awaited: the lock is called while the unlock is still in flight.
    const unlocking = engine.call('unlockWithPassword', saved, PASSWORD, false)
    await engine.call('lock')
    await expect(unlocking).rejects.toMatchObject({ kind: 'usage' })
    expect(await engine.call('status')).toMatchObject({ unlocked: false })
  })

  it('keeps the later of two overlapping unlocks', async () => {
    const saved = engine.saves.at(-1)
    const session = await engine.call<string>('exportUnlockedSession')
    await engine.call('lock')
    const first = engine.call('unlockWithPassword', saved, PASSWORD, false)
    const second = engine.call('unlockWithSession', saved, session, false)
    await expect(first).rejects.toMatchObject({ kind: 'usage' })
    await second
    expect(await engine.call('status')).toMatchObject({ unlocked: true })
  })

  it.each(['lock', 'createVault', 'unlockWithSession'])(
    '%s cancels a server change without reconnecting the discarded vault',
    async (method) => {
      // A controllable host connection: the first server accepts us, the
      // second stays pending until the vault is dropped.
      engine.evaluate(`
        globalThis.__sockets = []
        __favaHost.wsConnect = (url, onEvent) => {
          __sockets.push({ url, onEvent, closed: false })
          return __sockets.length
        }
        __favaHost.wsSend = () => {}
        __favaHost.wsClose = (id) => {
          const socket = __sockets[id - 1]
          socket.closed = true
          socket.onEvent('close', 1000, '', true)
        }
      `)
      const connected = engine.call(
        'setSyncServer',
        'wss://first.test',
        'secret',
      )
      engine.evaluate(`
        __sockets[0].onEvent('open')
        __sockets[0].onEvent('message', JSON.stringify({
          type: 'authChallenge', data: { nonce: 'test-nonce' }
        }))
        __sockets[0].onEvent('message', JSON.stringify({ type: 'authAccepted' }))
      `)
      await connected
      const saved = engine.saves.at(-1)
      const session = await engine.call<string>('exportUnlockedSession')
      const changing = engine.call(
        'setSyncServer',
        'wss://pending.test',
        'secret',
      )
      const cancelled = expect(changing).rejects.toMatchObject({
        kind: 'usage',
      })

      if (method === 'unlockWithSession') {
        await engine.call(method, saved, session, false)
      } else if (method === 'createVault') {
        await engine.call(method, PASSWORD)
      } else {
        await engine.call(method)
      }
      await cancelled
      expect(engine.evaluate('__sockets.map(s => [s.url, s.closed])')).toEqual([
        ['wss://first.test', true],
        ['wss://pending.test', true],
      ])
      expect(await engine.call('status')).toMatchObject({
        unlocked: method !== 'lock',
        syncConnected: false,
      })
    },
  )

  it('does not save a password change after its vault was locked', async () => {
    const savesBefore = engine.saves.length
    const changing = engine.call('changePassword', PASSWORD, `${PASSWORD}-new`)
    const cancelled = expect(changing).rejects.toMatchObject({ kind: 'usage' })
    await engine.call('lock')
    await cancelled
    expect(engine.saves).toHaveLength(savesBefore)
    expect(engine.events.map((e) => e.type)).not.toContain('passwordChanged')
  })

  it('refuses a wrong password', async () => {
    const saved = engine.saves.at(-1)
    await engine.call('lock')
    const error = await engine
      .call('unlockWithPassword', saved, 'not-the-password-at-all', false)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EngineCallError)
    expect((error as EngineCallError).kind).not.toBe('internal')
  })

  it('unlocks from an exported session without any key derivation', async () => {
    await engine.call('addEntry', newEntry('Session'))
    const session = await engine.call<string>('exportUnlockedSession')
    const saved = engine.saves.at(-1)

    // A cold engine, as an AutoFill extension would start.
    const extension = await loadEngine(inject('productionBundle'))
    try {
      await extension.call('unlockWithSession', saved, session, false)
      expect(extension.argon2Calls()).toBe(0)
      const [entry] = await extension.call<EntryMetaWithToken[]>('listEntries')
      expect(entry.name).toBe('Session')
    } finally {
      extension.dispose()
    }
  })

  it('stops accepting the old session after a password change', async () => {
    const oldSession = await engine.call<string>('exportUnlockedSession')
    await engine.call('changePassword', PASSWORD, `${PASSWORD}-new`)
    expect(engine.events.map((e) => e.type)).toContain('passwordChanged')
    const saved = engine.saves.at(-1)
    await engine.call('lock')
    await expect(
      engine.call('unlockWithSession', saved, oldSession, false),
    ).rejects.toBeInstanceOf(EngineCallError)
    await engine.call('unlockWithPassword', saved, `${PASSWORD}-new`, false)
  })

  it('rolls back a password change when the host cannot save', async () => {
    const session = await engine.call<string>('exportUnlockedSession')
    const saved = engine.saves.at(-1)
    engine.evaluate(`
      const save = __favaHost.save
      __favaHost.save = () => {
        __favaHost.save = save
        throw new Error('disk full')
      }
    `)
    await expect(
      engine.call('changePassword', PASSWORD, `${PASSWORD}-new`),
    ).rejects.toMatchObject({
      message: expect.stringContaining('disk full') as string,
    })
    expect(engine.saves.at(-1)).toBe(saved)
    expect(await engine.call('exportUnlockedSession')).toBe(session)
    expect(engine.events.map((e) => e.type)).not.toContain('passwordChanged')
    await engine.call('addEntry', newEntry('Saved after rollback'))
    await engine.call('lock')
    await engine.call(
      'unlockWithPassword',
      engine.saves.at(-1),
      PASSWORD,
      false,
    )
    expect(await engine.call<{ name: string }[]>('listEntries')).toMatchObject([
      { name: 'Saved after rollback' },
    ])
  })

  it('refuses a sync server url that is not ws:// or wss://', async () => {
    // Only a 'development' build lets other schemes through, so this also
    // checks that the bundle was built with NODE_ENV=production.
    await expect(
      engine.call('setSyncServer', 'https://localhost:1', 'secret'),
    ).rejects.toMatchObject({
      kind: 'initialization',
      message: expect.stringContaining('wss') as string,
    })
  })
})

describe('format compatibility with favalib on node', () => {
  const nodeUtils = (
    save: (s: LockedRepresentationString) => void = () => undefined,
  ) =>
    getFavaLibVaultCreationUtils(
      nodeProviders,
      'node-peer' as DeviceType,
      ['phone'],
      save,
    )

  it('node opens the vault the engine wrote, and reads its export', async () => {
    await engine.call('createVault', PASSWORD)
    await engine.call('addEntry', newEntry('FromEngine'))
    const exported = await engine.call<string>(
      'exportText',
      'export-password-2',
    )

    const lib = await nodeUtils().loadFavaLibFromLockedRepesentation(
      engine.saves.at(-1) as LockedRepresentationString,
      PASSWORD as Password,
      { connectToSyncServer: false },
    )
    expect(lib.vault.listEntriesMetas().map((e) => e.name)).toEqual([
      'FromEngine',
    ])
    const imported = await lib.exportImport.importFromTextFile(
      exported,
      'export-password-2',
    )
    expect(imported.filter((r) => r.entryId)).toHaveLength(1)
  })

  it('the engine opens the vault node wrote, and reads its export', async () => {
    let saved = '' as LockedRepresentationString
    const { favaLib } = await nodeUtils((s) => {
      saved = s
    }).createNewFavaLibVault(PASSWORD as Password)
    await favaLib.vault.addEntry({
      ...newEntry('FromNode'),
      type: 'TOTP',
      payload: {
        secret: TOTP_SECRET,
        period: 30,
        algorithm: 'SHA-1',
        digits: 6,
      },
    })
    await favaLib.storage.forceSave()
    const exported = await favaLib.exportImport.exportEntries(
      'text',
      'export-password-3',
    )

    await engine.call('unlockWithPassword', saved, PASSWORD, false)
    const entries = await engine.call<EntryMetaWithToken[]>('listEntries')
    expect(entries.map((e) => e.name)).toEqual(['FromNode'])
    const results = await engine.call<{ entryId: string | null }[]>(
      'importText',
      exported,
      'export-password-3',
    )
    expect(results.filter((r) => r.entryId)).toHaveLength(1)
  })
})
