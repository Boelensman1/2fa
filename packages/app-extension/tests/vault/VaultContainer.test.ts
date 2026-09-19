import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EntryMeta, EntryMetaForUrl } from 'favalib'

vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: vi.fn() } },
}))

/** A stand-in for wxt's storage, keyed exactly as `Db` keys it. */
const store = new Map<string, string>()

vi.mock('wxt/utils/storage', () => ({
  storage: {
    setItem: (key: string, value: string) => {
      store.set(key, value)
      return Promise.resolve()
    },
    getItem: (key: string) => Promise.resolve(store.get(key) ?? null),
    removeItem: (key: string) => {
      store.delete(key)
      return Promise.resolve()
    },
    clear: () => {
      store.clear()
      return Promise.resolve()
    },
  },
}))

/**
 * favalib is mocked wholesale.
 *
 * The real thing would need argon2 and a 4096-bit rsa keygen per test, and
 * what is under test here is the status machine and the list selection, not
 * favalib's crypto -- which has its own suite in ../lib.
 */
const createNewFavaLibVault = vi.fn()
const loadFavaLibFromLockedRepesentation = vi.fn()
const loadFavaLibFromUnlockedSession = vi.fn()
const getPasswordStrength = vi.fn()

vi.mock('../../lib/vault/creationUtils', () => ({
  default: {
    createNewFavaLibVault: (...args: unknown[]) =>
      createNewFavaLibVault(...args) as unknown,
    loadFavaLibFromLockedRepesentation: (...args: unknown[]) =>
      loadFavaLibFromLockedRepesentation(...args) as unknown,
    loadFavaLibFromUnlockedSession: (...args: unknown[]) =>
      loadFavaLibFromUnlockedSession(...args) as unknown,
    getPasswordStrength: (...args: unknown[]) =>
      getPasswordStrength(...args) as unknown,
  },
}))

const { default: VaultContainer } =
  await import('../../lib/ioc/entities/VaultContainer')
const { default: Db } = await import('../../lib/ioc/entities/Db')

type EntryOverrides = Partial<Omit<EntryMeta, 'id'>> & { id?: string }

const entry = (overrides: EntryOverrides = {}): EntryMeta =>
  ({
    id: 'entry-1',
    name: 'me@example.com',
    issuer: 'GitHub',
    type: 'TOTP',
    matchers: [],
    url: null,
    inputSelector: null,
    addedAt: 0,
    updatedAt: null,
    ...overrides,
  }) as EntryMeta

interface FakeFavaLib {
  listed: EntryMeta[]
  searched: EntryMeta[]
  forUrl: EntryMetaForUrl[]
  saveFunction?: (_blob: string) => Promise<void> | void
  listeners: Record<string, (() => void)[]>
  emit: (_event: string) => void
  /** What `exportUnlockedSession` hands back; a new generation returns a new one. */
  session: string
}

const makeFavaLib = (overrides: Partial<FakeFavaLib> = {}) => {
  const fake = {
    listed: [] as EntryMeta[],
    searched: [] as EntryMeta[],
    forUrl: [] as EntryMetaForUrl[],
    listeners: {} as Record<string, (() => void)[]>,
    session: 'unlocked-session',
    ...overrides,
  }

  const favaLib = {
    ready: Promise.resolve(),
    meta: { deviceId: 'device-1', deviceFriendlyName: 'Test device' },
    storage: {
      setSaveFunction: (fn: (_blob: string) => Promise<void> | void) => {
        fake.saveFunction = fn
      },
      forceSave: () => fake.saveFunction?.('locked-representation'),
      exportUnlockedSession: () => fake.session,
    },
    addEventListener: (event: string, cb: () => void) => {
      ;(fake.listeners[event] ??= []).push(cb)
    },
    setDeviceFriendlyName: vi.fn(() => Promise.resolve()),
    setSyncServerUrl: vi.fn(() => Promise.resolve()),
    sync: {
      serverUrl: 'ws://localhost:8080',
      webSocketConnected: true,
      closeServerConnection: () => undefined,
      respondToAddDeviceFlow: vi.fn(() => Promise.resolve()),
    },
    vault: {
      get size() {
        return fake.listed.length
      },
      listEntriesMetas: () => fake.listed,
      searchEntriesMetas: () => fake.searched,
      findEntryMetasForUrl: () => fake.forUrl,
      generateTokenForEntry: () =>
        Promise.resolve({ otp: '123456', validFrom: 0, validTill: 30000 }),
    },
  }

  const emit = (event: string) =>
    fake.listeners[event]?.forEach((listener) => listener())

  return { favaLib, emit }
}

const build = () => new VaultContainer(new Db())

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
})

describe('status', () => {
  it('is no-vault when nothing has been stored', async () => {
    await expect(build().getStatus()).resolves.toBe('no-vault')
  })

  it('is locked when a blob exists but nothing is in memory', async () => {
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')

    await expect(new VaultContainer(db).getStatus()).resolves.toBe('locked')
  })

  it('is unlocked after creating a vault in create mode', async () => {
    const { favaLib } = makeFavaLib()
    createNewFavaLibVault.mockResolvedValue({ favaLib })
    const container = build()

    await container.createVault('pw' as never, 'create')

    await expect(container.getStatus()).resolves.toBe('unlocked')
  })

  it('is pairing after creating a vault in connect mode', async () => {
    const { favaLib } = makeFavaLib()
    createNewFavaLibVault.mockResolvedValue({ favaLib })
    const container = build()

    await container.createVault('pw' as never, 'connect')

    await expect(container.getStatus()).resolves.toBe('pairing')
  })

  it('leaves connect mode unsaved until pairing delivers a vault', async () => {
    // A vault written before pairing completes would unlock to nothing if the
    // user walked away, and would then read as `locked` rather than `no-vault`.
    const { favaLib } = makeFavaLib()
    createNewFavaLibVault.mockResolvedValue({ favaLib })

    await build().createVault('pw' as never, 'connect')

    expect(store.has('local:meta:lockedRepresentation')).toBe(false)
  })

  it('saves immediately in create mode', async () => {
    const { favaLib } = makeFavaLib()
    createNewFavaLibVault.mockResolvedValue({ favaLib })

    await build().createVault('pw' as never, 'create')

    expect(store.get('local:meta:lockedRepresentation')).toBe(
      'locked-representation',
    )
  })

  it('leaves pairing once favalib says the vault arrived', async () => {
    const { favaLib, emit } = makeFavaLib()
    createNewFavaLibVault.mockResolvedValue({ favaLib })
    const container = build()
    await container.createVault('pw' as never, 'connect')

    emit('connectToExistingVaultFinished')

    await expect(container.getStatus()).resolves.toBe('unlocked')
  })
})

describe('unlock and lock', () => {
  it('unlocks a stored vault', async () => {
    const { favaLib } = makeFavaLib()
    loadFavaLibFromLockedRepesentation.mockResolvedValue(favaLib)
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    const container = new VaultContainer(db)

    await container.unlock('pw' as never)

    await expect(container.getStatus()).resolves.toBe('unlocked')
  })

  it('refuses to unlock when there is no vault', async () => {
    await expect(build().unlock('pw' as never)).rejects.toThrow(
      /no vault to unlock/i,
    )
  })

  it('goes back to locked, keeping the blob', async () => {
    const { favaLib } = makeFavaLib()
    loadFavaLibFromLockedRepesentation.mockResolvedValue(favaLib)
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    const container = new VaultContainer(db)
    await container.unlock('pw' as never)

    await container.lock()

    await expect(container.getStatus()).resolves.toBe('locked')
    expect(store.has('local:meta:lockedRepresentation')).toBe(true)
  })

  it('stores the unlocked session, and never the password', async () => {
    const { favaLib } = makeFavaLib()
    loadFavaLibFromLockedRepesentation.mockResolvedValue(favaLib)
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    const container = new VaultContainer(db)

    await container.unlock('pw' as never)

    expect(store.get('session:unlockedSession')).toBe('unlocked-session')
    // The blob favalib exports replaced the master password here. Nothing may
    // put that back: it opens every key generation of this vault, and is very
    // often the user's password somewhere else too.
    expect([...store.values()]).not.toContain('pw')
  })

  it('drops the session on lock', async () => {
    const { favaLib } = makeFavaLib()
    loadFavaLibFromLockedRepesentation.mockResolvedValue(favaLib)
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    const container = new VaultContainer(db)
    await container.unlock('pw' as never)
    expect(store.has('session:unlockedSession')).toBe(true)

    await container.lock()

    expect(store.has('session:unlockedSession')).toBe(false)
  })

  it('drops what the popup was typing on lock', async () => {
    // A lock is the user saying stop holding my things, and the drafts hold
    // the sync server secret and a pairing code.
    const { favaLib } = makeFavaLib()
    loadFavaLibFromLockedRepesentation.mockResolvedValue(favaLib)
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    const container = new VaultContainer(db)
    await container.unlock('pw' as never)
    store.set('session:draft:syncServer', 'secret-in-progress')
    store.set('session:draft:pair', 'half-a-connection-code')
    store.set('session:draft:entryEdit', 'entry-edit-in-progress')

    await container.lock()

    expect(
      [...store.keys()].filter((key) => key.startsWith('session:draft:')),
    ).toEqual([])
  })

  it('re-exports the session after a password change', async () => {
    // The blob is bound to a key GENERATION, and changePassword moves it.
    // Keeping the pre-rotation one would make favalib refuse it at the next
    // eviction, which reads as the vault locking itself for no reason.
    const { favaLib, emit } = makeFavaLib({ session: 'session-gen-1' })
    loadFavaLibFromLockedRepesentation.mockResolvedValue(favaLib)
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    const container = new VaultContainer(db)
    await container.unlock('pw' as never)

    favaLib.storage.exportUnlockedSession = () => 'session-gen-2'
    emit('passwordChanged')
    // The listener is not awaited by favalib's dispatch, so give the write a turn.
    await Promise.resolve()
    await Promise.resolve()

    expect(store.get('session:unlockedSession')).toBe('session-gen-2')
  })

  it('does not store the session where the background is persistent', async () => {
    // Firefox is built as mv2, whose background page is never evicted, so
    // restoreSession has no reader there. Writing key material for nobody is
    // exposure bought for nothing.
    vi.stubEnv('MANIFEST_VERSION', '2')
    try {
      const { favaLib } = makeFavaLib()
      loadFavaLibFromLockedRepesentation.mockResolvedValue(favaLib)
      const db = new Db()
      await db.upsertMetaKV('lockedRepresentation', 'blob')
      const container = new VaultContainer(db)

      await container.unlock('pw' as never)

      await expect(container.getStatus()).resolves.toBe('unlocked')
      expect(store.has('session:unlockedSession')).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('does not try to restore where the background is persistent', async () => {
    vi.stubEnv('MANIFEST_VERSION', '2')
    try {
      const db = new Db()
      await db.upsertMetaKV('lockedRepresentation', 'blob')
      // Even with a session left behind by an earlier mv3 build, mv2 must not
      // reach for it.
      await db.setSessionValue('unlockedSession', 'unlocked-session')
      const container = new VaultContainer(db)

      await container.restoreSession()

      await expect(container.getStatus()).resolves.toBe('locked')
      expect(loadFavaLibFromUnlockedSession).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('reset forgets the vault but keeps the config', async () => {
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    await db.upsertMetaKV('config', '{"debug":true}')
    store.set('session:draft:entryEdit', 'entry-edit-in-progress')

    await new VaultContainer(db).reset()
    expect(store.has('session:draft:entryEdit')).toBe(false)

    expect(store.has('local:meta:lockedRepresentation')).toBe(false)
    // db.reset() is storage.clear('local') and would take this with it.
    expect(store.get('local:meta:config')).toBe('{"debug":true}')
  })
})

describe('restoreSession', () => {
  it('re-unlocks from the session blob after a worker restart', async () => {
    const { favaLib } = makeFavaLib()
    loadFavaLibFromUnlockedSession.mockResolvedValue(favaLib)
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    await db.setSessionValue('unlockedSession', 'unlocked-session')

    // A fresh container is exactly what a restarted service worker builds.
    const restarted = new VaultContainer(db)
    await restarted.restoreSession()

    await expect(restarted.getStatus()).resolves.toBe('unlocked')
    // Both halves, in favalib's order. No password is involved, which is the
    // whole reason this path exists: the old one ran a full argon2id unlock on
    // every worker boot.
    expect(loadFavaLibFromUnlockedSession).toHaveBeenCalledWith(
      'blob',
      'unlocked-session',
    )
    expect(loadFavaLibFromLockedRepesentation).not.toHaveBeenCalled()
  })

  it('stays locked when there is no session blob', async () => {
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    const container = new VaultContainer(db)

    await container.restoreSession()

    await expect(container.getStatus()).resolves.toBe('locked')
    expect(loadFavaLibFromUnlockedSession).not.toHaveBeenCalled()
  })

  it('drops a session left behind for a vault that was forgotten', async () => {
    // Nothing else clears it in that order: `reset` does, but a vault can also
    // go while the worker is down. The session opens nothing now, so holding
    // key material for it buys nothing.
    const db = new Db()
    await db.setSessionValue('unlockedSession', 'unlocked-session')
    const container = new VaultContainer(db)

    await container.restoreSession()

    await expect(container.getStatus()).resolves.toBe('no-vault')
    expect(store.has('session:unlockedSession')).toBe(false)
    expect(loadFavaLibFromUnlockedSession).not.toHaveBeenCalled()
  })

  it('locks rather than throwing when the session no longer fits the vault', async () => {
    // favalib's contract for every throw out of the session path is the same:
    // discard it and ask for the password. Exported-before-a-password-change
    // is the case that actually happens.
    loadFavaLibFromUnlockedSession.mockRejectedValue(
      new Error('This unlocked session does not fit the stored vault'),
    )
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    await db.setSessionValue('unlockedSession', 'stale-session')
    const container = new VaultContainer(db)

    await expect(container.restoreSession()).resolves.toBeUndefined()

    await expect(container.getStatus()).resolves.toBe('locked')
    expect(store.has('session:unlockedSession')).toBe(false)
  })
})

describe('setSyncServer', () => {
  const unlockedContainer = async (overrides: Partial<FakeFavaLib> = {}) => {
    const { favaLib } = makeFavaLib(overrides)
    loadFavaLibFromLockedRepesentation.mockResolvedValue(favaLib)
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    const container = new VaultContainer(db)
    await container.unlock('pw' as never)
    return { container, favaLib }
  }

  it('passes the url and the secret through to favalib', async () => {
    const { container, favaLib } = await unlockedContainer()

    await container.setSyncServer('wss://sync.example.com', 'the-secret')

    expect(favaLib.setSyncServerUrl).toHaveBeenCalledWith(
      'wss://sync.example.com',
      'the-secret',
    )
  })

  it('refuses before there is a vault to configure', async () => {
    await expect(
      build().setSyncServer('wss://sync.example.com', 'the-secret'),
    ).rejects.toThrow(/create a vault/i)
  })

  it('surfaces a server that rejected the secret', async () => {
    // setSyncServerUrl resolves only once the server has accepted, so its
    // rejection is the only signal a wrong secret gives -- swallowing it would
    // leave the user with a connection that silently never works.
    const { container, favaLib } = await unlockedContainer()
    favaLib.setSyncServerUrl.mockRejectedValue(
      new Error('Could not connect to the sync server'),
    )

    await expect(
      container.setSyncServer('wss://sync.example.com', 'wrong'),
    ).rejects.toThrow(/could not connect/i)
  })
})

describe('listEntries', () => {
  const unlocked = async (overrides: Partial<FakeFavaLib>) => {
    const { favaLib } = makeFavaLib(overrides)
    loadFavaLibFromLockedRepesentation.mockResolvedValue(favaLib)
    const db = new Db()
    await db.upsertMetaKV('lockedRepresentation', 'blob')
    const container = new VaultContainer(db)
    await container.unlock('pw' as never)
    return container
  }

  it('returns nothing while locked', () => {
    expect(build().listEntries('', null)).toEqual({ forSite: [], all: [] })
  })

  it('lists everything when the query is empty', async () => {
    const container = await unlocked({ listed: [entry(), entry({ id: 'b' })] })

    expect(container.listEntries('', null).all).toHaveLength(2)
  })

  it('delegates a non-empty query to favalib rather than filtering here', async () => {
    const container = await unlocked({
      listed: [entry(), entry({ id: 'b' })],
      searched: [entry({ id: 'b' })],
    })

    const { all } = container.listEntries('git', null)

    expect(all.map((listed) => listed.id)).toEqual(['b'])
  })

  it('groups the active tab url separately', async () => {
    const matcher = { type: 'BaseDomain' as const, value: 'github.com' }
    const container = await unlocked({
      listed: [entry()],
      forUrl: [{ ...entry(), matchedBy: matcher }] as EntryMetaForUrl[],
    })

    const { forSite } = container.listEntries('', 'https://github.com/login')

    expect(forSite.map((listed) => listed.matchedBy)).toEqual([matcher])
  })

  it('drops the site group while searching', async () => {
    // A query is a deliberate narrowing; a second list beside it that ignores
    // the query contradicts it.
    const container = await unlocked({
      listed: [entry()],
      searched: [entry()],
      forUrl: [
        { ...entry(), matchedBy: { type: 'Host', value: 'github.com' } },
      ] as EntryMetaForUrl[],
    })

    expect(
      container.listEntries('git', 'https://github.com/login').forSite,
    ).toEqual([])
  })

  it('never exposes a secret to the popup', async () => {
    // EntryMeta carries no payload, but the mapper is what guarantees that
    // nothing added to it later leaks by accident.
    const container = await unlocked({
      listed: [
        {
          ...entry(),
          payload: { secret: 'TOPSECRET' },
        } as unknown as EntryMeta,
      ],
    })

    const [listed] = container.listEntries('', null).all

    expect(JSON.stringify(listed)).not.toContain('TOPSECRET')
    expect(listed).not.toHaveProperty('payload')
  })
})

describe('summary', () => {
  it('reports zero entries while pairing, not the placeholder vault', async () => {
    const { favaLib } = makeFavaLib({ listed: [entry()] })
    createNewFavaLibVault.mockResolvedValue({ favaLib })
    const container = build()
    await container.createVault('pw' as never, 'connect')

    const summary = await container.getSummary()

    expect(summary.status).toBe('pairing')
    expect(summary.entryCount).toBe(0)
  })

  it('is empty and disconnected when there is no vault', async () => {
    const summary = await build().getSummary()

    expect(summary).toEqual({
      status: 'no-vault',
      deviceId: null,
      syncServerUrl: null,
      deviceFriendlyName: null,
      syncConnected: false,
      entryCount: 0,
    })
  })
})
