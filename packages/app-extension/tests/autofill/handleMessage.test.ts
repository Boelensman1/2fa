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
const { BG_ACTION_KEYS, CT_ACTION_KEYS } = await import('../../lib/state')
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

/** A spy, so a test can assert that no code was minted at all. */
const generateTokenForEntry = vi.fn<() => Promise<{ otp: string }>>()

/** The only write this package makes into the vault. */
const updateEntry = vi.fn<(id: string, updates: unknown) => Promise<unknown>>()

/** Stands in for an unlocked favalib, since only the selection is under test. */
const fakeVault = (entries: EntryMetaForUrl[], otp = '123456') => ({
  meta: { deviceId: 'd', deviceFriendlyName: 'n' },
  sync: null,
  vault: {
    size: entries.length,
    findEntryMetasForUrl: (url: string) =>
      url.startsWith('https://github.com') ? entries : [],
    listEntriesMetas: () => entries,
    searchEntriesMetas: () => entries,
    getEntryMeta: (id: string) => {
      const found = entries.find((entry) => entry.id === id)
      // favalib throws an EntryNotFoundError here, and the callers under test
      // are the ones that have to survive it.
      if (!found) throw new Error(`no entry ${id}`)
      return found
    },
    updateEntry: (id: string, updates: unknown) => {
      updateEntry.mockResolvedValue(undefined)
      return updateEntry(id, updates)
    },
    generateTokenForEntry: () => {
      generateTokenForEntry.mockResolvedValue({ otp })
      return generateTokenForEntry()
    },
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

/**
 * One detected field, as a frame reports it.
 *
 * Only `id`, `score` and `confidence` are ever read on this path; the rest is
 * there because the type demands it.
 */
const detectedField = (id: string, score = 60) => ({
  id,
  kind: 'single',
  confidence: 'likely',
  score,
  source: 'heuristic',
  reasons: [],
  selector: '#code',
  elementDescription: 'input#code',
  expectedLength: 6,
  segmentCount: 1,
  matchedInputSelectors: [],
  inShadowRoot: false,
  shadowHostPath: null,
})

/** Fills the registry the way production fills it: through a real report. */
const reportFrom = (
  sender: { tab: { id: number }; frameId: number; url: string },
  fields: ReturnType<typeof detectedField>[],
) =>
  send(
    {
      type: BG_ACTION_KEYS.REPORT_OTP_FIELDS,
      data: {
        fields,
        overrideMissed: false,
        scannedAt: 0,
        usedInputSelectors: [],
      },
    },
    sender,
  )

beforeEach(async () => {
  store.clear()
  sendMessage.mockReset()
  generateTokenForEntry.mockReset()
  updateEntry.mockReset()
  // The fill path sends three different ct actions and reads every answer, so
  // a single canned reply will not do. `SHOW_REMEMBER_PROMPT` answering `true`
  // is a frame saying it put the prompt up; `null` is how the background learns
  // it could not be shown.
  sendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
    Promise.resolve(
      message.type === 'DETECT_OTP_FIELDS'
        ? [detectedField('otp-1')]
        : message.type === 'SHOW_REMEMBER_PROMPT'
          ? true
          : { filled: true },
    ),
  )
  vaultContainer = container.get<VaultContainer>(IOC_TYPES.VaultContainer)
  loseTheKeys()
  container
    .get<import('../../lib/ioc/entities/AutofillOfferRegistry').default>(
      IOC_TYPES.AutofillOfferRegistry,
    )
    .forgetAll()
  container
    .get<import('../../lib/ioc/entities/OtpFieldRegistry').default>(
      IOC_TYPES.OtpFieldRegistry,
    )
    .forgetTab(7)
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

    // From the popup: locking is not something a tab context may ask for.
    await send({ type: BG_ACTION_KEYS.LOCK_VAULT }, {})

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

/**
 * The trust boundary the rest of this file's guarantees rest on.
 *
 * `menu.html` is web-accessible, so any site can frame it, and that frame is
 * an extension context with `runtime.sendMessage` and a `sender.tab`. Before
 * the allowlist, it could ask for the entry list and then a code for every id
 * in it. These tests are the pin: the popup's actions are reachable only from
 * a sender with no tab at all.
 */
describe('who may send what', () => {
  /** The popup: an extension page in its own context, so no `tab`. */
  const popupSender = { url: 'popup.html' }

  const tabOnly = [
    { type: BG_ACTION_KEYS.LIST_ENTRIES, data: { query: '', url: null } },
    { type: BG_ACTION_KEYS.GET_TOKEN, data: { entryId: 'a' } },
    { type: BG_ACTION_KEYS.GET_VAULT_STATE },
    { type: BG_ACTION_KEYS.GET_STATE },
    { type: BG_ACTION_KEYS.GET_CONFIG },
    { type: BG_ACTION_KEYS.LOCK_VAULT },
    { type: BG_ACTION_KEYS.RESET_VAULT },
    { type: BG_ACTION_KEYS.UNLOCK_VAULT, data: { password: 'hunter2' } },
    { type: BG_ACTION_KEYS.GET_FILL_TARGET, data: { tabId: 7 } },
    {
      type: BG_ACTION_KEYS.FILL_DETECTED_FIELD,
      data: { target: {}, entryId: 'a' },
    },
  ]

  it.each(tabOnly)('refuses $type from the menu iframe', async (action) => {
    unlockWith([entryMeta('a')])

    expect(await send(action, menuSender)).toBeNull()
  })

  it.each(tabOnly)('refuses $type from a content script', async (action) => {
    unlockWith([entryMeta('a')])

    expect(await send(action, contentSender)).toBeNull()
  })

  /**
   * The headline: the two calls that together read the whole vault.
   *
   * Asserted as a pair rather than separately, because it is the sequence that
   * is the attack -- ids from the first, a live code per id from the second.
   */
  it('does not let a framed menu page read the vault', async () => {
    unlockWith([entryMeta('a'), entryMeta('b')])

    const entries = await send(
      { type: BG_ACTION_KEYS.LIST_ENTRIES, data: { query: '', url: null } },
      menuSender,
    )
    const otp = await send(
      { type: BG_ACTION_KEYS.GET_TOKEN, data: { entryId: 'a' } },
      menuSender,
    )

    expect(entries).toBeNull()
    expect(otp).toBeNull()
  })

  it('still answers the popup', async () => {
    unlockWith([entryMeta('a')])

    const entries = await send(
      { type: BG_ACTION_KEYS.LIST_ENTRIES, data: { query: '', url: null } },
      popupSender,
    )

    expect(entries).toEqual({
      forSite: [],
      all: [expect.objectContaining({ id: 'a' })],
    })
  })
})

/** The frame holding the field, and the page it is embedded in. */
const pageSender = { tab: { id: 7 }, frameId: 0, url: 'https://github.com/2fa' }
const widgetSender = {
  tab: { id: 7 },
  frameId: 4,
  url: 'https://widget.example/otp',
}
const popupSender = { url: 'popup.html' }
/** The remember prompt: frame 0's shadow root, but an extension origin. */
const promptSender = { tab: { id: 7 }, frameId: 0, url: 'remember.html' }

/** The `SHOW_REMEMBER_PROMPT` the background pushed, if it pushed one. */
const promptCall = () =>
  sendMessage.mock.calls.find(
    (args) =>
      (args[1] as { type: string }).type ===
      CT_ACTION_KEYS.SHOW_REMEMBER_PROMPT,
  ) as [number, { data: { token: string } }, { frameId: number }] | undefined

/** The token it handed over -- the prompt's whole authorisation. */
const promptToken = () => promptCall()?.[1].data.token ?? ''

/** What the prompt is shown, fetched with the token it was given. */
const promptView = (token = promptToken(), sender: unknown = promptSender) =>
  send({ type: BG_ACTION_KEYS.GET_REMEMBER_OFFER, data: { token } }, sender)

const getFillTarget = () =>
  send(
    { type: BG_ACTION_KEYS.GET_FILL_TARGET, data: { tabId: 7 } },
    popupSender,
  ) as Promise<{ frameId: number; fieldId: string; host: string } | null>

describe('GET_FILL_TARGET', () => {
  it('answers with the field a frame reported', async () => {
    unlockWith([entryMeta('a')])
    await reportFrom(pageSender, [detectedField('otp-1')])

    expect(await getFillTarget()).toMatchObject({
      frameId: 0,
      fieldId: 'otp-1',
      host: 'github.com',
      inSubframe: false,
    })
    // Nothing to ask the page: it has already said.
    expect(sendMessage).not.toHaveBeenCalled()
  })

  /**
   * An mv3 worker is evicted after ~30s idle and takes the registry with it,
   * and "open the 2fa page, wait for the code, then open the popup" is exactly
   * the sequence that lands in. Answering "nothing" would make the feature
   * missing precisely when it is wanted.
   */
  it('asks the page to rescan when it knows nothing', async () => {
    unlockWith([entryMeta('a')])

    expect(await getFillTarget()).toBeNull()

    expect(sendMessage).toHaveBeenCalledTimes(1)
    const [tabId, message, target] = sendMessage.mock.calls[0] as [
      number,
      { type: string },
      undefined,
    ]
    expect(tabId).toBe(7)
    expect(message).toEqual({ type: CT_ACTION_KEYS.DETECT_OTP_FIELDS })
    // No third argument: a broadcast, because which frame owns the field is
    // the question. Safe here in a way `FILL_OTP_FIELD` is not -- it carries
    // nothing.
    expect(target).toBeUndefined()
  })

  /** The popup polls, and this branch is permanently true on most pages. */
  it('does not rescan again immediately', async () => {
    unlockWith([entryMeta('a')])

    await getFillTarget()
    await getFillTarget()
    await getFillTarget()

    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('prefers the most confident frame', async () => {
    unlockWith([entryMeta('a')])
    await reportFrom(widgetSender, [detectedField('otp-weak', 40)])
    await reportFrom(pageSender, [detectedField('otp-strong', 95)])

    expect(await getFillTarget()).toMatchObject({
      frameId: 0,
      fieldId: 'otp-strong',
    })
  })

  it('ignores a frame that reported no fields', async () => {
    unlockWith([entryMeta('a')])
    await reportFrom(pageSender, [])

    expect(await getFillTarget()).toBeNull()
  })
})

describe('FILL_DETECTED_FIELD', () => {
  const fill = (
    target: unknown,
    entryId = 'a',
    confirmed?: boolean,
  ): Promise<{ filled: boolean; reason?: string }> =>
    send(
      {
        type: BG_ACTION_KEYS.FILL_DETECTED_FIELD,
        data: { target, entryId: entryId as EntryId, confirmed },
      },
      popupSender,
    ) as Promise<{ filled: boolean; reason?: string }>

  const openOn = async (sender: typeof pageSender) => {
    await reportFrom(sender, [detectedField('otp-1')])
    const target = await getFillTarget()
    sendMessage.mockClear()
    return target
  }

  it('confirms the frame before it mints a code, then fills it', async () => {
    unlockWith([entryMeta('a')], '987654')
    const target = await openOn(pageSender)

    // No prompt: this entry already claims github.com, so there is nothing to
    // learn. The offer has its own tests below.
    expect(await fill(target)).toEqual({ filled: true })
    expect(promptCall()).toBeUndefined()

    const [confirm, deliver] = sendMessage.mock.calls as [
      [number, { type: string }, undefined],
      [
        number,
        { type: string; data: { fieldId: string; otp: string } },
        { frameId: number; documentId?: string },
      ],
    ]
    // The order is the point: the frame says what it holds, and only then is
    // there a code.
    expect(confirm[1].type).toBe(CT_ACTION_KEYS.DETECT_OTP_FIELDS)
    expect(deliver[1].type).toBe(CT_ACTION_KEYS.FILL_OTP_FIELD)
    expect(deliver[2]).toEqual({ frameId: 0, documentId: undefined })
    expect(deliver[1].data).toEqual({ fieldId: 'otp-1', otp: '987654' })
  })

  /**
   * The feature, in one test. The inline menu would never offer this entry on
   * this page; the popup does, because the user picked it by hand.
   */
  it('fills an entry whose matchers do not claim the page', async () => {
    unlockWith([entryMeta('a')], '987654')
    const target = await openOn({
      ...pageSender,
      url: 'https://elsewhere.example/login',
    })

    expect(await fill(target)).toMatchObject({ filled: true })
  })

  /**
   * The other half of that: the fill is the evidence, so the question goes up
   * on the page. The reply to the popup says nothing about it -- the popup is
   * about to close, which is the whole reason this moved.
   */
  it('puts the remember prompt on the page the entry does not claim', async () => {
    unlockWith([entryMeta('a')], '987654')
    const target = await openOn({
      ...pageSender,
      url: 'https://elsewhere.example/login?session=abc123',
    })

    expect(await fill(target)).toEqual({ filled: true })
    // Frame 0, never the frame that was filled: the question is about the page.
    expect(promptCall()?.[2]).toEqual({ frameId: 0 })

    expect(await promptView()).toEqual({
      entryLabel: 'GitHub',
      matcher: { type: 'BaseDomain', value: 'elsewhere.example' },
      // Origin and path. The session id is not kept, and would be synced to
      // every device the user has if it were.
      siteUrl: 'https://elsewhere.example/login',
      inSubframe: false,
    })
  })

  /**
   * A label and a matcher, and nothing that would let a guessed token name a
   * different write. The entry id and the page url stay in the background.
   */
  it('tells the prompt no entry id and no page url', async () => {
    unlockWith([entryMeta('a')], '987654')
    const target = await openOn({
      ...pageSender,
      url: 'https://elsewhere.example/login',
    })
    await fill(target)

    expect(await promptView()).not.toHaveProperty('entryId')
    expect(await promptView()).not.toHaveProperty('pageUrl')
  })

  /** The token is the whole of it, and it is scoped to the tab it was minted for. */
  it('refuses a prompt token replayed from another tab', async () => {
    unlockWith([entryMeta('a')], '987654')
    const target = await openOn({
      ...pageSender,
      url: 'https://elsewhere.example/login',
    })
    await fill(target)

    expect(
      await promptView(promptToken(), { ...promptSender, tab: { id: 8 } }),
    ).toBeNull()
  })

  it('refuses a guessed prompt token', async () => {
    unlockWith([entryMeta('a')], '987654')
    const target = await openOn({
      ...pageSender,
      url: 'https://elsewhere.example/login',
    })
    await fill(target)

    expect(await promptView('not-the-token')).toBeNull()
  })

  it('leaves a site the entry already has alone', async () => {
    unlockWith(
      [entryMeta('a', { url: 'https://elsewhere.example/' })],
      '987654',
    )
    const target = await openOn({
      ...pageSender,
      url: 'https://elsewhere.example/login',
    })

    await fill(target)

    expect(await promptView()).toMatchObject({ siteUrl: null })
  })

  /**
   * The rule the offer must not break. A matcher for the *frame's* host would
   * make `isTrustedFrame` vouch for that third party from then on, turning one
   * "fill it anyway" into a standing grant -- so the offer names the page.
   */
  it('offers the page, never the embedded frame it filled', async () => {
    unlockWith([entryMeta('a')], '987654')
    await reportFrom({ ...pageSender, url: 'https://elsewhere.example/' }, [])
    const target = await openOn(widgetSender)

    await fill(target, 'a', true)

    expect(await promptView()).toMatchObject({
      matcher: { type: 'BaseDomain', value: 'elsewhere.example' },
      // Said out loud in the prompt, so a yes is not read as settling the
      // embedded-frame question `FillConfirm` asked.
      inSubframe: true,
    })
  })

  /** Nothing to name, so nothing to offer. */
  it('offers nothing when the top frame has not reported', async () => {
    unlockWith([entryMeta('a')], '987654')
    const target = await openOn({
      ...widgetSender,
      url: 'https://github.com/otp-widget',
    })

    expect(await fill(target)).toEqual({ filled: true })
    expect(promptCall()).toBeUndefined()
  })

  /**
   * The check the confirm round trip exists for. Nothing clears the registry
   * on navigation, and a frame id is reused across a frame's own navigations,
   * so a popup left open while an embedded widget navigates must not be able
   * to put a code into whatever replaced it.
   */
  it('refuses a target whose frame has navigated, without minting a code', async () => {
    unlockWith([entryMeta('a')])
    const target = await openOn(pageSender)
    // The frame answers the confirmation from its new document.
    await reportFrom({ ...pageSender, url: 'https://evil.example/' }, [
      detectedField('otp-1'),
    ])

    expect(await fill(target)).toEqual({
      filled: false,
      reason: 'stale-target',
    })
    expect(generateTokenForEntry).not.toHaveBeenCalled()
  })

  it('refuses when the frame no longer answers', async () => {
    unlockWith([entryMeta('a')])
    const target = await openOn(pageSender)
    sendMessage.mockRejectedValue(new Error('no receiving end'))

    expect(await fill(target)).toEqual({ filled: false, reason: 'no-frame' })
    expect(generateTokenForEntry).not.toHaveBeenCalled()
  })

  it('refuses on a locked vault before it touches the page at all', async () => {
    unlockWith([entryMeta('a')])
    const target = await openOn(pageSender)
    loseTheKeys()

    expect(await fill(target)).toEqual({ filled: false, reason: 'locked' })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  /**
   * Bitwarden's rule for manual autofill: an embedded frame whose url the item
   * does not claim gets named, and the user says yes or no. What matters here
   * is that saying nothing yet costs nothing -- no code exists.
   */
  it('asks before filling a third-party frame, and mints nothing meanwhile', async () => {
    unlockWith([entryMeta('a')])
    await reportFrom(pageSender, [])
    const target = await openOn(widgetSender)

    expect(await fill(target)).toEqual({
      filled: false,
      reason: 'untrusted-frame',
    })
    expect(generateTokenForEntry).not.toHaveBeenCalled()
  })

  it('fills that frame once the user has said so', async () => {
    unlockWith([entryMeta('a')], '987654')
    await reportFrom(pageSender, [])
    const target = await openOn(widgetSender)

    expect(await fill(target, 'a', true)).toEqual({ filled: true })
  })

  /** The hosted second-factor widget: another origin, but one the entry names. */
  it('does not ask about a frame the entry itself claims', async () => {
    unlockWith([entryMeta('a')])
    await reportFrom(pageSender, [])
    const target = await openOn({
      ...widgetSender,
      url: 'https://github.com/otp-widget',
    })

    expect(await fill(target)).toEqual({ filled: true })
    expect(promptCall()).toBeUndefined()
  })
})

/**
 * The extension's only write into the vault.
 *
 * Every case here is about the same thing: what the prompt sends is a token and
 * a boolean, and the background decides everything else -- with the same
 * function that built the offer, so what is saved is what was shown. That is
 * what makes it safe for this action to be reachable from a tab at all.
 */
describe('ANSWER_REMEMBER_OFFER', () => {
  /** Mints a real offer the way production does: a fill on a page the entry does not claim. */
  const offerFrom = async (
    url = 'https://elsewhere.example/login?session=abc',
    entryId = 'a',
  ) => {
    await reportFrom({ ...pageSender, url }, [detectedField('otp-1')])
    const target = await getFillTarget()
    sendMessage.mockClear()
    await send(
      {
        type: BG_ACTION_KEYS.FILL_DETECTED_FIELD,
        data: { target, entryId: entryId as EntryId },
      },
      popupSender,
    )
    return promptToken()
  }

  const answer = (
    token: string,
    remember = true,
    sender: unknown = promptSender,
  ) =>
    send(
      { type: BG_ACTION_KEYS.ANSWER_REMEMBER_OFFER, data: { token, remember } },
      sender,
    )

  it('appends the matcher and fills in the site', async () => {
    unlockWith([entryMeta('a')])
    const token = await offerFrom()

    expect(await answer(token)).toEqual({ ok: true, error: null })
    // Appended, not replaced: `updateEntry` takes the whole list.
    expect(updateEntry).toHaveBeenCalledWith('a', {
      matchers: [
        { type: 'BaseDomain', value: 'github.com' },
        { type: 'BaseDomain', value: 'elsewhere.example' },
      ],
      url: 'https://elsewhere.example/login',
    })
  })

  it('does not overwrite a site the entry already has', async () => {
    unlockWith([entryMeta('a', { url: 'https://typed-by-hand.example/' })])
    const token = await offerFrom('https://elsewhere.example/login')

    await answer(token)

    expect(updateEntry).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ url: 'https://typed-by-hand.example/' }),
    )
  })

  it('writes nothing when the answer is no', async () => {
    unlockWith([entryMeta('a')])
    const token = await offerFrom()

    expect(await answer(token, false)).toEqual({ ok: true, error: null })
    expect(updateEntry).not.toHaveBeenCalled()
  })

  /** A no is an answer, and an answered offer must not come back. */
  it('retires the offer on a no', async () => {
    unlockWith([entryMeta('a')])
    const token = await offerFrom()

    await answer(token, false)

    expect(await promptView(token)).toBeNull()
    expect(await answer(token)).toEqual({
      ok: false,
      error: 'That prompt has expired',
    })
    expect(updateEntry).not.toHaveBeenCalled()
  })

  /** And on a yes, which is what stops a second click appending twice. */
  it('retires the offer once the write has landed', async () => {
    unlockWith([entryMeta('a')])
    const token = await offerFrom()

    await answer(token)

    expect(await answer(token)).toEqual({
      ok: false,
      error: 'That prompt has expired',
    })
    expect(updateEntry).toHaveBeenCalledTimes(1)
  })

  /**
   * But a *failed* write must leave it answerable. The panel stays up saying
   * what went wrong, and retiring the offer here would make its button answer
   * "expired" -- the user can unlock and try again, and nothing should stop
   * them.
   */
  it('keeps the offer alive when the write could not happen', async () => {
    unlockWith([entryMeta('a')])
    const token = await offerFrom()
    loseTheKeys()

    expect(await answer(token)).toEqual({
      ok: false,
      error: 'The vault is locked',
    })

    unlockWith([entryMeta('a')])
    expect(await answer(token)).toEqual({ ok: true, error: null })
    expect(updateEntry).toHaveBeenCalledTimes(1)
  })

  /**
   * The token is the authorisation, and it is bound to one tab. A hostile
   * frame of `remember.html` in some other tab cannot spend it.
   */
  it('refuses an answer from another tab, and writes nothing', async () => {
    unlockWith([entryMeta('a')])
    const token = await offerFrom()

    expect(
      await answer(token, true, { ...promptSender, tab: { id: 8 } }),
    ).toEqual({ ok: false, error: 'That prompt has expired' })
    expect(updateEntry).not.toHaveBeenCalled()
  })

  it('refuses a guessed token, and writes nothing', async () => {
    unlockWith([entryMeta('a')])
    await offerFrom()

    expect(await answer('not-the-token')).toEqual({
      ok: false,
      error: 'That prompt has expired',
    })
    expect(updateEntry).not.toHaveBeenCalled()
  })

  /**
   * A no-op success rather than an error: another device may have synced the
   * matcher in while the prompt was on screen, and the user asked for a state
   * that is now true.
   */
  it('writes nothing when the entry has come to claim the page anyway', async () => {
    unlockWith([entryMeta('a')])
    const token = await offerFrom('https://elsewhere.example/login')
    // The matcher arrives from another device while the prompt is up.
    unlockWith([
      entryMeta('a', {
        matchers: [
          { type: 'BaseDomain', value: 'github.com' },
          { type: 'BaseDomain', value: 'elsewhere.example' },
        ],
      }),
    ])
    const claimsEverything = internals(vaultContainer).favaLib
    if (claimsEverything) {
      claimsEverything.vault.findEntryMetasForUrl = () => [entryMeta('a')]
    }

    expect(await answer(token)).toEqual({ ok: true, error: null })
    expect(updateEntry).not.toHaveBeenCalled()
  })
})

/**
 * Putting the prompt back after the page navigated out from under it.
 *
 * The cost of asking on the page rather than in the popup: pressing Enter
 * submits, and the document that was holding the prompt is replaced. The offer
 * itself is in session storage and survives, so the prompt is remounted when
 * frame 0 next reports.
 */
describe('re-showing the prompt after a navigation', () => {
  /**
   * Lets the fire-and-forget re-show finish.
   *
   * `REPORT_OTP_FIELDS` deliberately does not await it -- its answer is the
   * selector list the reporting frame is waiting on to rescan, and a prompt is
   * not worth delaying that for. So the test waits instead, and the three
   * negative cases below need it as much as the positive one: without it they
   * would pass on timing rather than on the rule they are about.
   */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  const fillOn = async (url: string) => {
    await reportFrom({ ...pageSender, url }, [detectedField('otp-1')])
    await settle()
    const target = await getFillTarget()
    await send(
      {
        type: BG_ACTION_KEYS.FILL_DETECTED_FIELD,
        data: { target, entryId: 'a' as EntryId },
      },
      popupSender,
    )
    const token = promptToken()
    sendMessage.mockClear()
    return token
  }

  it('shows it again on the page the submit landed on', async () => {
    unlockWith([entryMeta('a')])
    const token = await fillOn('https://elsewhere.example/login')

    await reportFrom(
      { ...pageSender, url: 'https://elsewhere.example/home' },
      [],
    )
    await settle()

    // Same offer, same token: the question did not change, only the document
    // it is drawn on.
    expect(promptCall()?.[1].data.token).toBe(token)
  })

  /**
   * The guard that keeps this from being a bug of its own. A prompt about one
   * site appearing over another the user opened in the meantime reads as the
   * extension malfunctioning.
   */
  it('does not follow the tab to another site', async () => {
    unlockWith([entryMeta('a')])
    await fillOn('https://elsewhere.example/login')

    await reportFrom({ ...pageSender, url: 'https://unrelated.example/' }, [])
    await settle()

    expect(promptCall()).toBeUndefined()
  })

  /** An SPA re-reports on every dom change; one prompt per document, not per report. */
  it('does not remount it on the document it is already on', async () => {
    unlockWith([entryMeta('a')])
    await fillOn('https://elsewhere.example/login')

    await reportFrom(
      { ...pageSender, url: 'https://elsewhere.example/login' },
      [detectedField('otp-1')],
    )
    await settle()

    expect(promptCall()).toBeUndefined()
  })

  /** Only the page asks this question, so only the page is asked it. */
  it('ignores a report from an embedded frame', async () => {
    unlockWith([entryMeta('a')])
    await fillOn('https://elsewhere.example/login')

    await reportFrom(
      { ...widgetSender, url: 'https://elsewhere.example/w' },
      [],
    )
    await settle()

    expect(promptCall()).toBeUndefined()
  })
})
