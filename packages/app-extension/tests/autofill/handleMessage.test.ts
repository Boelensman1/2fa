import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EntryId, EntryMetaForUrl } from 'favalib'

/**
 * The background's half of autofill, driven through the real message handler.
 *
 * Worth testing here rather than by hand, because every rule that keeps a code
 * from reaching the wrong place lives in these cases: which url an entry is
 * matched against, which tab may redeem a token, which entries a fill may name
 * and which frame the code is delivered to. None of that is visible from the
 * ui, and all of it fails silently in the safe direction, so a regression
 * would look exactly like "autofill is a bit flaky".
 */
const sendMessage = vi.fn()

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage: vi.fn(), getURL: (path: string) => path },
    tabs: {
      sendMessage: (...args: unknown[]) => sendMessage(...args) as unknown,
      query: () => Promise.resolve([]),
      onRemoved: { addListener: vi.fn() },
    },
  },
}))

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

vi.mock('../../lib/vault/creationUtils', () => ({
  default: {
    createNewFavaLibVault: vi.fn(),
    loadFavaLibFromLockedRepesentation: vi.fn(),
    getPasswordStrength: vi.fn(),
  },
}))

const { default: container, IOC_TYPES } = await import('../../lib/ioc')
const { BG_ACTION_KEYS } = await import('../../lib/state')
const { default: handleMessageContainer } =
  await import('../../lib/background/handleMessage')
const { default: init } = await import('../../lib/background/init')
type VaultContainer = import('../../lib/ioc/entities/VaultContainer').default

const entryMeta = (
  id: string,
  over: Partial<EntryMetaForUrl> = {},
): EntryMetaForUrl => ({
  id: id as EntryId,
  name: 'frank@appeal.nl',
  issuer: 'GitHub',
  type: 'TOTP',
  matchers: [{ type: 'BaseDomain', value: 'github.com' }],
  matchedBy: { type: 'BaseDomain', value: 'github.com' },
  url: null,
  inputSelector: null,
  addedAt: 0,
  updatedAt: null,
  ...over,
})

/** Stands in for an unlocked favalib, since only the selection is under test. */
const fakeVault = (entries: EntryMetaForUrl[], otp = '123456') => ({
  meta: { deviceId: 'd', deviceFriendlyName: 'n' },
  sync: null,
  vault: {
    size: entries.length,
    findEntryMetasForUrl: (url: string) =>
      url.startsWith('https://github.com') ? entries : [],
    generateTokenForEntry: () => Promise.resolve({ otp }),
  },
})

/** `handleMessage` answers through a callback and returns true synchronously. */
const send = (action: unknown, sender: unknown): Promise<unknown> =>
  new Promise((resolve) => {
    handleMessageContainer(action as never, sender as never, resolve as never)
  })

const contentSender = {
  tab: { id: 7 },
  frameId: 3,
  url: 'https://github.com/login',
}
/** The menu iframe: same tab, its own frame, an extension origin. */
const menuSender = { tab: { id: 7 }, frameId: 9, url: 'menu.html' }

let vaultContainer: VaultContainer

/**
 * Reaches past `private favaLib` to install the stand-in above.
 *
 * The alternative is running the real unlock, which means argon2 and a
 * 4096-bit rsa keygen per test for crypto that has its own suite in ../lib.
 */
const internals = (vault: VaultContainer) =>
  vault as unknown as { favaLib: ReturnType<typeof fakeVault> | null }

const unlockWith = (entries: EntryMetaForUrl[], otp?: string) => {
  internals(vaultContainer).favaLib = fakeVault(entries, otp)
}

const loseTheKeys = () => {
  internals(vaultContainer).favaLib = null
}

beforeEach(async () => {
  store.clear()
  sendMessage.mockReset()
  sendMessage.mockResolvedValue({ filled: true })
  vaultContainer = container.get<VaultContainer>(IOC_TYPES.VaultContainer)
  loseTheKeys()
  container
    .get<import('../../lib/ioc/entities/AutofillOfferRegistry').default>(
      IOC_TYPES.AutofillOfferRegistry,
    )
    .forgetAll()
  await init()
  await container
    .get<import('../../lib/ioc/entities/ConfigContainer').default>(
      IOC_TYPES.ConfigContainer,
    )
    .set('inlineMenu', true)
})

const openMenu = (sender: unknown = contentSender) =>
  send(
    { type: BG_ACTION_KEYS.OPEN_AUTOFILL_MENU, data: { fieldId: 'otp-1' } },
    sender,
  ) as Promise<{ state: string; token: string | null; count: number }>

describe('OPEN_AUTOFILL_MENU', () => {
  it('offers the entries that match the frame url', async () => {
    unlockWith([entryMeta('a'), entryMeta('b')])

    const offer = await openMenu()

    expect(offer.state).toBe('ready')
    expect(offer.count).toBe(2)
    expect(offer.token).toEqual(expect.any(String))
  })

  /**
   * The whole point of matching on `sender.url`. A field on a third-party
   * origin embedded in a page must not be offered that page's entries -- the
   * shape of the credential-theft report Bitwarden shipped in 2023.
   */
  it('offers nothing to a frame on another origin', async () => {
    unlockWith([entryMeta('a')])

    const offer = await openMenu({
      ...contentSender,
      url: 'https://evil.example/widget',
    })

    expect(offer.state).toBe('no-match')
    expect(offer.token).toBeNull()
  })

  it('offers the unlock prompt, and no token, when locked', async () => {
    store.set('local:meta:lockedRepresentation', 'blob')

    const offer = await openMenu()

    expect(offer.state).toBe('locked')
    expect(offer.token).toBeNull()
  })

  it('says nothing at all when there is no vault', async () => {
    expect((await openMenu()).state).toBe('off')
  })

  it('says nothing at all when the user turned the menu off', async () => {
    unlockWith([entryMeta('a')])
    await container
      .get<import('../../lib/ioc/entities/ConfigContainer').default>(
        IOC_TYPES.ConfigContainer,
      )
      .set('inlineMenu', false)

    expect((await openMenu()).state).toBe('off')
  })
})

describe('GET_MENU_ENTRIES', () => {
  it('gives the menu the entries its token was opened with', async () => {
    unlockWith([entryMeta('a')])
    const { token } = await openMenu()

    const entries = (await send(
      { type: BG_ACTION_KEYS.GET_MENU_ENTRIES, data: { token } },
      menuSender,
    )) as { id: string }[]

    expect(entries.map((entry) => entry.id)).toEqual(['a'])
  })

  /**
   * The menu page is web-accessible, so any site can frame it and ask. Only
   * the token separates our menu from theirs -- checking that the sender is an
   * extension page would not, because theirs is one too.
   */
  it('refuses a token presented from a different tab', async () => {
    unlockWith([entryMeta('a')])
    const { token } = await openMenu()

    const entries = await send(
      { type: BG_ACTION_KEYS.GET_MENU_ENTRIES, data: { token } },
      { ...menuSender, tab: { id: 8 } },
    )

    expect(entries).toBeNull()
  })

  it('refuses a guessed token', async () => {
    unlockWith([entryMeta('a')])
    await openMenu()

    expect(
      await send(
        { type: BG_ACTION_KEYS.GET_MENU_ENTRIES, data: { token: '1' } },
        menuSender,
      ),
    ).toBeNull()
  })
})

describe('FILL_OTP_FIELD', () => {
  it('delivers the code to the field frame, and only that frame', async () => {
    unlockWith([entryMeta('a')], '987654')
    const { token } = await openMenu()

    const result = await send(
      {
        type: BG_ACTION_KEYS.FILL_OTP_FIELD,
        data: { token, entryId: 'a' as EntryId },
      },
      menuSender,
    )

    expect(result).toEqual({ filled: true })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    const [tabId, message, target] = sendMessage.mock.calls[0] as [
      number,
      { type: string; data: { fieldId: string; otp: string } },
      { frameId: number },
    ]
    expect(tabId).toBe(7)
    // The frame that holds the field, not the frame that asked.
    expect(target).toEqual({ frameId: 3 })
    expect(message.data).toEqual({ fieldId: 'otp-1', otp: '987654' })
  })

  it('refuses an entry the offer did not list', async () => {
    unlockWith([entryMeta('a')])
    const { token } = await openMenu()

    const result = await send(
      {
        type: BG_ACTION_KEYS.FILL_OTP_FIELD,
        data: { token, entryId: 'b' as EntryId },
      },
      menuSender,
    )

    expect(result).toEqual({ filled: false, reason: 'unknown-entry' })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('refuses once the vault has locked, and closes the open menu', async () => {
    unlockWith([entryMeta('a')])
    const { token } = await openMenu()

    await send({ type: BG_ACTION_KEYS.LOCK_VAULT }, { tab: { id: 7 } })

    // Locking drops every offer, so the token is gone before the entry check
    // is ever reached -- the fill fails closed either way.
    expect(
      await send(
        {
          type: BG_ACTION_KEYS.FILL_OTP_FIELD,
          data: { token, entryId: 'a' as EntryId },
        },
        menuSender,
      ),
    ).toEqual({ filled: false, reason: 'no-offer' })
  })

  /**
   * Belt to the braces above: even if an offer somehow outlived a lock, there
   * are no keys to generate a code with and the fill must say so rather than
   * throwing its way out of the handler.
   */
  it('refuses on a vault that lost its keys without dropping the offer', async () => {
    unlockWith([entryMeta('a')])
    const { token } = await openMenu()
    loseTheKeys()

    expect(
      await send(
        {
          type: BG_ACTION_KEYS.FILL_OTP_FIELD,
          data: { token, entryId: 'a' as EntryId },
        },
        menuSender,
      ),
    ).toEqual({ filled: false, reason: 'locked' })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('spends the token, so a replayed fill does nothing', async () => {
    unlockWith([entryMeta('a')])
    const { token } = await openMenu()
    const fill = {
      type: BG_ACTION_KEYS.FILL_OTP_FIELD,
      data: { token, entryId: 'a' as EntryId },
    }

    await send(fill, menuSender)
    const replayed = await send(fill, menuSender)

    expect(replayed).toEqual({ filled: false, reason: 'no-offer' })
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})

describe('REPORT_OTP_FIELDS', () => {
  it("answers with the frame's inputSelector overrides", async () => {
    unlockWith([
      entryMeta('a', { inputSelector: '#code' }),
      entryMeta('b', { inputSelector: null }),
    ])

    const response = await send(
      {
        type: BG_ACTION_KEYS.REPORT_OTP_FIELDS,
        data: {
          fields: [],
          overrideMissed: false,
          scannedAt: 0,
          usedInputSelectors: [],
        },
      },
      contentSender,
    )

    expect(response).toEqual({ inputSelectors: ['#code'] })
  })

  it('answers with nothing for a frame no entry claims', async () => {
    unlockWith([entryMeta('a', { inputSelector: '#code' })])

    const response = await send(
      {
        type: BG_ACTION_KEYS.REPORT_OTP_FIELDS,
        data: {
          fields: [],
          overrideMissed: false,
          scannedAt: 0,
          usedInputSelectors: [],
        },
      },
      { ...contentSender, url: 'https://evil.example/' },
    )

    expect(response).toEqual({ inputSelectors: [] })
  })
})
