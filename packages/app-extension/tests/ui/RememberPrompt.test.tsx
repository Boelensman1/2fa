import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/**
 * The remember prompt, as it actually runs: an extension page in an iframe on
 * someone else's site.
 *
 * Worth rendering rather than unit-testing the component, because everything
 * that can go wrong here is in the wiring. It is handed a token in a url hash
 * and must ask for its own contents; it must answer *both* ways, since a
 * silent dismissal would leave the offer pending and put it back on the next
 * page the tab loads; and it must tell its host when to take it down, because
 * nothing else can -- the host cannot see inside a cross-origin child.
 */
vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: vi.fn(), getURL: (p: string) => p } },
}))

const getRememberOffer = vi.fn()
const answerRememberOffer = vi.fn()

vi.mock('@/lib/state', () => ({
  bgActions: {
    getRememberOffer: (...args: unknown[]) =>
      getRememberOffer(...args) as unknown,
    answerRememberOffer: (...args: unknown[]) =>
      answerRememberOffer(...args) as unknown,
  },
}))

// happy-dom does no layout and ships no ResizeObserver; the panel reports its
// height through one, and a missing global would throw in the effect.
globalThis.ResizeObserver = class {
  observe() {
    /* no layout to observe */
  }
  disconnect() {
    /* nothing to disconnect */
  }
  unobserve() {
    /* nothing to unobserve */
  }
}

const { default: Remember } = await import('../../entrypoints/remember/App')

;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

/** Everything this document posts to its host. Its only channel out. */
const posted = vi.fn()

const flush = (work: () => void) => act(() => Promise.resolve(work()))

const offer = {
  entryLabel: 'GitHub',
  matcher: { type: 'BaseDomain', value: 'elsewhere.example' },
  siteUrl: 'https://elsewhere.example/login',
  inSubframe: false,
}

/** Mounts the page the way the content script does: a token in the hash. */
const open = async (token = 'the-token') => {
  window.location.hash = `#token=${token}`
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await flush(() => root.render(<Remember />))
}

/** By visible text, so the header's dismiss control and "Not now" stay distinct. */
const button = (label: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!found) throw new Error(`no button labelled ${label}`)
  return found
}

const click = (label: string) =>
  flush(() => {
    button(label).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

/** What the host is told, and the only channel out of this document. */
const closeRequests = () =>
  posted.mock.calls.filter(
    ([message]) => (message as { action?: string }).action === 'close',
  )

beforeEach(() => {
  getRememberOffer.mockReset()
  answerRememberOffer.mockReset()
  getRememberOffer.mockResolvedValue(offer)
  answerRememberOffer.mockResolvedValue({ ok: true, error: null })
  posted.mockReset()
  vi.spyOn(window.parent, 'postMessage').mockImplementation(posted)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('the remember prompt', () => {
  it('asks for its own contents with the token it was handed', async () => {
    await open('abc-123')

    expect(getRememberOffer).toHaveBeenCalledWith('abc-123')
  })

  it('names the entry and shows the matcher literally', async () => {
    await open()

    expect(container.textContent).toContain('GitHub')
    expect(container.textContent).toContain('BaseDomain elsewhere.example')
  })

  /**
   * The one thing it must not imply. The matcher is for the page's host, so a
   * yes does not settle the embedded-frame question `FillConfirm` asked -- and
   * that is said out loud rather than left to be discovered.
   */
  it('says the frame is not what is being remembered', async () => {
    getRememberOffer.mockResolvedValue({ ...offer, inSubframe: true })
    await open()

    expect(container.textContent).toContain('embedded frame')
    expect(container.textContent).toContain('not that frame')
  })

  it('leaves the site line out when there is no site to set', async () => {
    getRememberOffer.mockResolvedValue({ ...offer, siteUrl: null })
    await open()

    expect(container.textContent).not.toContain('Its site will be set to')
  })

  it('writes on a yes, then asks to be taken down', async () => {
    await open()

    await click('Remember this site')

    expect(answerRememberOffer).toHaveBeenCalledWith('the-token', true)
    expect(closeRequests()).toHaveLength(1)
  })

  /**
   * A no is an answer and has to be sent. Silence would leave the offer
   * pending, and the prompt would reappear on the page the submit lands on.
   */
  it('answers on a no as well', async () => {
    await open()

    await click('Not now')

    expect(answerRememberOffer).toHaveBeenCalledWith('the-token', false)
    expect(closeRequests()).toHaveLength(1)
  })

  /** The corner ✕ is the same answer, in the place a panel is expected to put it. */
  it('treats the header dismiss control as a no', async () => {
    await open()

    await click('×')

    expect(answerRememberOffer).toHaveBeenCalledWith('the-token', false)
    expect(closeRequests()).toHaveLength(1)
  })

  /**
   * A failed write must not look like a successful one. The panel stays up
   * saying so, rather than closing and leaving the user believing the site was
   * remembered.
   */
  it('stays up and says so when the write fails', async () => {
    answerRememberOffer.mockResolvedValue({ ok: false, error: 'Nope' })
    await open()

    await click('Remember this site')

    expect(container.textContent).toContain('Nope')
    expect(closeRequests()).toHaveLength(0)
  })

  /** An expired, unknown or foreign token. Nothing to show, and nothing to say. */
  it('asks to be taken down when the token resolves to nothing', async () => {
    getRememberOffer.mockResolvedValue(null)
    await open()

    expect(closeRequests()).toHaveLength(1)
    expect(container.textContent).toBe('')
  })

  /**
   * It must never take focus: the user is on their way to pressing Enter on
   * the page, and standing between them and that key is the whole reason this
   * moved out of the popup.
   */
  it('takes no focus', async () => {
    await open()

    expect(container.querySelector('[autofocus]')).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })
})
