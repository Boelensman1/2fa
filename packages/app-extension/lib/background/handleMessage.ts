import type { Browser } from 'wxt/browser'

import { BG_ACTION_KEYS, Logger, bindDependencies, IOC_TYPES } from '../'
import { ctActions } from '../state'
import { notifyConnectors } from '../util'

import type {
  AutofillOfferRegistry,
  AutofillOfferSummary,
  BgActionObject,
  Config,
  ConfigContainer,
  FillResult,
  OtpFieldRegistry,
  OtpFieldReport,
  RememberOfferRegistry,
  RememberOfferView,
  SiteOffer,
  StateManager,
  VaultActionResult,
  VaultContainer,
} from '../types'
import type { EntryId } from 'favalib'

const log = new Logger('background-script/handleMessage')

import { setVerboseLogging } from '../classes/Logger'

import { describeVaultError } from '../ioc/entities/VaultContainer'

import {
  hostOf,
  isTrustedFrame,
  pickFillTarget,
  stillHoldsTarget,
} from './fillTarget'
import { siteOfferFor } from './rememberSite'
import handleDebugCommand from './handleDebugCommand'
import { whenInitFinished } from './init'

// Actions that must answer *during* init rather than wait for it:
// GET_STATE because reporting status: 'loading' is the whole point of it,
// SEND_LOG and SEND_DEBUG_COMMAND because logging and log-level control are
// how a slow or stuck init gets diagnosed in the first place.
//
// REPORT_OTP_FIELDS is deliberately not here. The first report arrives at
// document_idle, while the service worker may still be booting, and it needs
// the registry that init builds -- so it waits, rather than being answered
// early with nothing to write to.
const actionsThatMustNotWaitForInit: BgActionObject['type'][] = [
  BG_ACTION_KEYS.GET_STATE,
  BG_ACTION_KEYS.SEND_LOG,
  BG_ACTION_KEYS.SEND_DEBUG_COMMAND,
]

/**
 * The only actions a context running inside a tab may send.
 *
 * `sender.tab` is filled in by the browser for anything living in a tab and is
 * absent for an extension page in its own context -- which is the popup. It is
 * not part of the message and cannot be forged.
 *
 * This is not a theoretical hardening. `menu.html` is in
 * `web_accessible_resources`, so any site can frame it, and a frame loaded
 * from that url *is* an extension context: it has `runtime.sendMessage`, and
 * `sender.tab.id` is the tab it sits in. Until this list existed, such a frame
 * could call `LIST_ENTRIES` for the ids and `GET_TOKEN` for each one and read
 * every code in the vault -- and `RESET_VAULT` to destroy it. The offer token
 * protects the menu's own actions; it never protected these.
 *
 * An allowlist rather than a list of popup-only actions, deliberately. A
 * denylist fails open on exactly the commit that adds an action and forgets to
 * update it; this way a new action is unreachable from a page until someone
 * says otherwise. It is also the smaller and far more stable half.
 *
 * Why each member is here:
 * - `REPORT_OTP_FIELDS`, `SEND_LOG` -- the content script's whole job
 * - `OPEN_`/`CLOSE_AUTOFILL_MENU` -- sent by the content script on focus
 * - `GET_MENU_ENTRIES`, `FILL_OTP_FIELD` -- sent by the menu iframe, and
 *   already gated on an unguessable per-tab offer token
 * - `GET_REMEMBER_OFFER`, `ANSWER_REMEMBER_OFFER` -- sent by the remember
 *   prompt iframe, gated on a token of its own. The second of those *writes to
 *   the vault*, which is only acceptable because the payload is a boolean: the
 *   matcher is rebuilt in the background from the offer the token resolves to,
 *   so a caller who guessed a token still cannot choose what gets written
 *
 * Note that an extension page opened as an ordinary *tab* is refused too: it
 * has a `sender.tab` like anything else. That only reaches someone typing a
 * `chrome-extension://.../popup.html` url by hand; `make dev` does not.
 */
const actionsReachableFromATab: BgActionObject['type'][] = [
  BG_ACTION_KEYS.REPORT_OTP_FIELDS,
  BG_ACTION_KEYS.SEND_LOG,
  BG_ACTION_KEYS.OPEN_AUTOFILL_MENU,
  BG_ACTION_KEYS.CLOSE_AUTOFILL_MENU,
  BG_ACTION_KEYS.GET_MENU_ENTRIES,
  BG_ACTION_KEYS.FILL_OTP_FIELD,
  BG_ACTION_KEYS.GET_REMEMBER_OFFER,
  BG_ACTION_KEYS.ANSWER_REMEMBER_OFFER,
]

async function unboundHandleMessage(
  [
    stateManager,
    configContainer,
    otpFieldRegistry,
    autofillOfferRegistry,
    rememberOfferRegistry,
    vaultContainer,
  ]: [
    StateManager,
    ConfigContainer,
    OtpFieldRegistry,
    AutofillOfferRegistry,
    RememberOfferRegistry,
    VaultContainer,
  ],
  action: BgActionObject,
  sender: Browser.runtime.MessageSender,
) {
  log.trace('Incoming message', { action, sender })

  // Before init, and before anything reads the payload: a refusal must not
  // depend on how far the worker has got.
  if (
    sender.tab !== undefined &&
    !actionsReachableFromATab.includes(action.type)
  ) {
    // Warn rather than refusing silently. A silent null here is
    // indistinguishable from a bug in the caller, and this is the first thing
    // to look at when the popup works and something else does not.
    log.warn(
      `Refusing ${action.type} from a tab context (frame ${String(
        sender.frameId ?? 0,
      )}, ${sender.url ?? 'unknown url'})`,
    )
    return null
  }

  if (!actionsThatMustNotWaitForInit.includes(action.type)) {
    await whenInitFinished()
  }

  const state = stateManager.getState()

  /**
   * Takes every open menu down.
   *
   * Both halves matter: dropping the offers makes an in-flight fill fail
   * closed, and the broadcast is what makes the menu already on screen
   * disappear rather than sitting there listing entries from a locked vault.
   */
  const forgetOffers = async () => {
    autofillOfferRegistry.forgetAll()
    await notifyConnectors('vaultStateChanged')
  }

  switch (action.type) {
    case BG_ACTION_KEYS.SEND_DEBUG_COMMAND: {
      const result = await handleDebugCommand(action, sender)
      return result
    }

    case BG_ACTION_KEYS.GET_STATE: {
      return { ...state }
    }

    case BG_ACTION_KEYS.SEND_LOG: {
      log.outputEntryToConsole(action.data)
      return
    }

    case BG_ACTION_KEYS.GET_CONFIG: {
      return configContainer.getFullConfig()
    }

    case BG_ACTION_KEYS.SAVE_CONFIG: {
      const updates = action.data
      for (const key of Object.keys(updates) as (keyof Config)[]) {
        const value = updates[key]
        if (value !== undefined) await configContainer.set(key, value)
      }
      setVerboseLogging(configContainer.get('debug'))
      await notifyConnectors('configUpdated')
      return configContainer.getFullConfig()
    }

    case BG_ACTION_KEYS.RESET_CONFIG: {
      await configContainer.reset()
      setVerboseLogging(configContainer.get('debug'))
      await notifyConnectors('configUpdated')
      return configContainer.getFullConfig()
    }

    case BG_ACTION_KEYS.REPORT_OTP_FIELDS: {
      const { tab, frameId, documentId, url } = sender
      if (tab?.id === undefined) return null

      otpFieldRegistry.record({
        tabId: tab.id,
        frameId: frameId ?? 0,
        // Chrome only, and preferred over the frame id when delivering a code:
        // a frame id is reused across that frame's own navigations, a document
        // id never is.
        documentId,
        // From the browser, not from the payload: a content script must not be
        // trusted to name its own origin.
        url: url ?? '',
        fields: action.data.fields,
        overrideMissed: action.data.overrideMissed,
        scannedAt: action.data.scannedAt,
      })

      log.info(
        `Detected ${String(action.data.fields.length)} otp field(s)`,
        action.data.fields,
      )
      // The debug view is still the only way to see what the heuristic did on
      // a real page; the fixture suite cannot answer that. The popup renders it.
      state.debugString = describeReport(otpFieldRegistry.forTab(tab.id))

      // A submit takes the page, and the in-page remember prompt with it --
      // the one weakness of asking here rather than in the popup. The offer
      // outlives the navigation in session storage, so put it back on the page
      // that loaded. Frame 0 only: the question is about the page.
      //
      // Not awaited. This handler's answer is the selector list a frame is
      // waiting on to rescan, and a prompt is not worth delaying it for.
      if ((frameId ?? 0) === 0) {
        void reshowRememberPrompt(rememberOfferRegistry, tab.id, url ?? '')
      }

      // The frame scanned without knowing the user's overrides, because only
      // the vault knows them. Handing them back lets it rescan with them --
      // which is what finally makes `EntryMeta.inputSelector` work end to end.
      return { inputSelectors: vaultContainer.inputSelectorsForUrl(url ?? '') }
    }

    case BG_ACTION_KEYS.OPEN_AUTOFILL_MENU: {
      const { tab, frameId, documentId, url } = sender
      const nothing: AutofillOfferSummary = {
        state: 'off',
        token: null,
        count: 0,
      }
      if (tab?.id === undefined || url === undefined) return nothing
      if (!configContainer.get('inlineMenu')) return nothing

      const status = await vaultContainer.getStatus()
      // Nothing to unlock and nothing to offer, so say nothing at all rather
      // than advertising the extension to the page.
      if (status === 'no-vault' || status === 'pairing') return nothing
      if (status === 'locked') {
        return { state: 'locked', token: null, count: 0 }
      }

      // The *frame's* url, from the browser. A field on an embedded
      // third-party origin must not be offered the outer page's entries.
      const entries = vaultContainer.entriesForUrl(url)
      if (entries.length === 0) {
        return { state: 'no-match', token: null, count: 0 }
      }

      const offer = autofillOfferRegistry.open({
        tabId: tab.id,
        frameId: frameId ?? 0,
        documentId,
        url,
        fieldId: action.data.fieldId,
        entries,
      })

      return { state: 'ready', token: offer.token, count: entries.length }
    }

    case BG_ACTION_KEYS.CLOSE_AUTOFILL_MENU: {
      const tabId = sender.tab?.id
      if (tabId !== undefined) {
        autofillOfferRegistry.close(action.data.token, tabId)
      }
      return null
    }

    case BG_ACTION_KEYS.GET_MENU_ENTRIES: {
      const tabId = sender.tab?.id
      if (tabId === undefined) return null
      // `resolve` checks the tab as well as the token. The menu page is
      // web-accessible, so a hostile site can frame it and ask -- an
      // unguessable token is the only thing that separates our menu from
      // theirs, since theirs is an extension page too.
      const offer = autofillOfferRegistry.resolve(action.data.token, tabId)
      return offer?.entries ?? null
    }

    case BG_ACTION_KEYS.FILL_OTP_FIELD: {
      const tabId = sender.tab?.id
      if (tabId === undefined) return failed('no-offer')

      const offer = autofillOfferRegistry.resolve(action.data.token, tabId)
      if (!offer) return failed('no-offer')
      if (!vaultContainer.isUnlocked) return failed('locked')
      // The menu may only fill what this offer listed. It is one postMessage
      // away from the page, so its request is a suggestion, not an authority.
      if (!offer.entries.some((entry) => entry.id === action.data.entryId)) {
        return failed('unknown-entry')
      }

      let otp: string
      try {
        otp = await vaultContainer.generateToken(action.data.entryId)
      } catch (error) {
        log.warn(`Could not generate a code: ${describeVaultError(error)}`)
        return failed('gone')
      }

      // One frame, never a broadcast: the payload is a live code, and every
      // frame on the page has its own isolated world to read it in.
      const result = await ctActions.fillOtpField(
        tabId,
        { frameId: offer.frameId, documentId: offer.documentId },
        { fieldId: offer.fieldId, otp },
      )

      autofillOfferRegistry.close(offer.token, tabId)
      return result ?? failed('no-frame')
    }

    case BG_ACTION_KEYS.GET_VAULT_STATE: {
      return vaultContainer.getSummary()
    }

    case BG_ACTION_KEYS.CREATE_VAULT: {
      return attempt(() =>
        vaultContainer.createVault(action.data.password, action.data.mode),
      )
    }

    case BG_ACTION_KEYS.PAIR_DEVICE: {
      return attempt(() =>
        vaultContainer.pair(
          action.data.connectionString,
          action.data.deviceFriendlyName,
        ),
      )
    }

    case BG_ACTION_KEYS.SET_SYNC_SERVER: {
      return attempt(() =>
        vaultContainer.setSyncServer(
          action.data.serverUrl,
          action.data.serverSecret,
        ),
      )
    }

    case BG_ACTION_KEYS.UNLOCK_VAULT: {
      return attempt(() => vaultContainer.unlock(action.data.password))
    }

    case BG_ACTION_KEYS.LOCK_VAULT: {
      await vaultContainer.lock()
      await forgetOffers()
      return null
    }

    case BG_ACTION_KEYS.RESET_VAULT: {
      await vaultContainer.reset()
      await forgetOffers()
      return null
    }

    case BG_ACTION_KEYS.LIST_ENTRIES: {
      return vaultContainer.listEntries(action.data.query, action.data.url)
    }

    case BG_ACTION_KEYS.GET_TOKEN: {
      return vaultContainer.generateToken(action.data.entryId)
    }

    case BG_ACTION_KEYS.GET_FILL_TARGET: {
      const { tabId } = action.data
      const target = pickFillTarget(otpFieldRegistry.forTab(tabId))
      if (target) return target

      // Nothing known, which after an mv3 eviction is the common case rather
      // than the rare one: the worker dies after ~30s idle, and "open the 2fa
      // page, wait for the code, then open the popup" is exactly the sequence
      // that lands in. So ask the page instead of answering no.
      //
      // Broadcast, because which frame owns the field is the question being
      // asked, and this action is safe to broadcast in a way `FILL_OTP_FIELD`
      // is not -- it carries nothing. The reply is ignored: a broadcast hands
      // back whichever frame answers first, and it is each frame's own
      // *report* that this is really after, since only a report carries a
      // browser-supplied url saying where the fields were.
      //
      // Throttled per tab, because this branch is permanently true on a page
      // with no otp field on it, and the popup polls.
      if (otpFieldRegistry.mayRescan(tabId)) {
        void ctActions.detectOtpFields(tabId)
      }

      return null
    }

    case BG_ACTION_KEYS.FILL_DETECTED_FIELD: {
      const { target, entryId, confirmed } = action.data
      if (!vaultContainer.isUnlocked) return failed('locked')

      // Make the frame say what it holds *now*, before a code exists. It
      // re-reports under its browser-supplied url as part of answering, so the
      // registry read below is current by the time this resolves.
      //
      // This is what stands in for the inline menu's offer token. The registry
      // is keyed by frame and nothing invalidates it on navigation, and a
      // frame id is reused across that frame's own navigations -- so a popup
      // left open while an embedded widget navigated could otherwise name a
      // document that no longer exists. A dead frame rejects here and never
      // gets a code.
      const answered = await ctActions.detectOtpFields(target.tabId, {
        frameId: target.frameId,
        documentId: target.documentId,
      })
      if (answered === null) return failed('no-frame')

      const report = otpFieldRegistry.forFrame(target.tabId, target.frameId)
      if (!stillHoldsTarget(report, target)) return failed('stale-target')

      // The top frame's own report, not the popup's idea of the tab url:
      // browser-supplied, and it needs no permission we do not have.
      const pageUrl = otpFieldRegistry.forFrame(target.tabId, 0)?.url ?? null

      // Bitwarden's rule for manual autofill, and the one place this feature
      // says no. *Which entry* is unrestricted on purpose -- the user picked
      // it, and reaching an entry whose matchers do not claim the site is the
      // whole point. *Which frame* is not: a code typed into some embedded
      // third party is a code given to that third party.
      const trusted = isTrustedFrame({
        frameId: report.frameId,
        frameUrl: report.url,
        pageUrl,
        entryClaimsFrame: vaultContainer
          .entriesForUrl(report.url)
          .some((entry) => entry.id === entryId),
      })
      if (!trusted && confirmed !== true) {
        // The popup turns this into a question naming `target.url`. Note where
        // it sits: no code has been generated yet, and none will be unless the
        // user comes back having said yes.
        return failed('untrusted-frame')
      }

      let otp: string
      try {
        otp = await vaultContainer.generateToken(entryId)
      } catch (error) {
        log.warn(`Could not generate a code: ${describeVaultError(error)}`)
        return failed('gone')
      }

      const result = await ctActions.fillOtpField(
        target.tabId,
        // From the refreshed report rather than from the payload: same frame,
        // but its document id is whatever the frame just said it was.
        { frameId: report.frameId, documentId: report.documentId },
        { fieldId: target.fieldId, otp },
      )

      if (!result) return failed('no-frame')

      // The fill is the evidence: the user picked this entry for this page, and
      // the popup offers every entry for any site, so very often it does not
      // claim the page at all. Asked about the *page*, never the frame that was
      // filled -- see `SiteOffer`.
      //
      // Asked *on the page* rather than in the popup, which is where this used
      // to live. A browser action popup is destroyed the moment it loses focus,
      // and clicking the page to press Enter is the very next thing the user
      // does after a fill -- so the question was being put at the one moment it
      // was certain to be dismissed unanswered.
      if (result.filled) {
        await offerToRememberSite(rememberOfferRegistry, vaultContainer, {
          tabId: target.tabId,
          entryId,
          pageUrl,
          inSubframe: report.frameId !== 0,
        })
      }

      return result
    }

    case BG_ACTION_KEYS.GET_REMEMBER_OFFER: {
      const tabId = sender.tab?.id
      if (tabId === undefined) return null

      // `resolve` checks the tab as well as the token. `remember.html` is
      // web-accessible, so a hostile site can frame it and ask; an unguessable
      // token is the only thing that separates our prompt from theirs, since
      // theirs is an extension page too.
      const pending = await rememberOfferRegistry.resolve(
        action.data.token,
        tabId,
      )
      if (!pending) return null

      // A label, a matcher and a flag. Never the entry id, never the page url:
      // the prompt has no use for either, and a token that leaked should not
      // come with the makings of a different write.
      const view: RememberOfferView = {
        entryLabel: pending.entryLabel,
        pageHost: pending.pageHost,
        matcher: pending.offer.matcher,
        siteUrl: pending.offer.siteUrl,
        inSubframe: pending.inSubframe,
      }
      return view
    }

    case BG_ACTION_KEYS.ANSWER_REMEMBER_OFFER: {
      const tabId = sender.tab?.id
      if (tabId === undefined) return { ok: false, error: 'No tab' }

      const pending = await rememberOfferRegistry.resolve(
        action.data.token,
        tabId,
      )
      if (!pending) return { ok: false, error: 'That prompt has expired' }

      // A no is an answer, and an answered offer must not be put back on the
      // next page this tab loads.
      if (!action.data.remember) {
        await rememberOfferRegistry.close(pending.token, tabId)
        return { ok: true, error: null }
      }

      if (!vaultContainer.isUnlocked) {
        return { ok: false, error: 'The vault is locked' }
      }

      const written = await attempt(async () => {
        // Recomputed rather than read back off the pending offer, by the same
        // function that built it: what is written is then what was shown,
        // whatever the caller sent -- and the caller sent a boolean anyway. A
        // null offer is a no-op success: another device may have synced the
        // matcher in while the prompt was up, and there is nothing left to do
        // and nothing wrong.
        const offer = entrySiteOffer(
          vaultContainer,
          pending.entryId,
          pending.offer.pageUrl,
        )
        if (offer) {
          await vaultContainer.addSiteToEntry(pending.entryId, offer)
        }
      })

      // Retired only once it has actually been written. A failed write leaves
      // the prompt on screen saying so, and retiring the offer here would turn
      // that into a dead panel whose button answers "expired" -- the user could
      // unlock and try again, and nothing should stop them. A success does
      // retire it, which is also what stops a second click appending twice.
      if (written.ok) await rememberOfferRegistry.close(pending.token, tabId)
      return written
    }

    case BG_ACTION_KEYS.GET_PASSWORD_STRENGTH: {
      return vaultContainer.getPasswordStrength(action.data.password)
    }
  }
}

const failed = (reason: FillResult['reason']): FillResult => ({
  filled: false,
  reason,
})

/**
 * What a fill on this page suggests writing onto this entry, if anything.
 *
 * Here rather than in `VaultContainer` so that the rule stays in the pure,
 * tested module and the vault stays a vault: the container answers "does this
 * entry claim that url" and "what are its matchers", and `siteOfferFor`
 * decides. Called twice -- once for the offer, once for the write.
 * @param vaultContainer - The unlocked vault.
 * @param entryId - The entry that was filled.
 * @param pageUrl - The top frame's url, or null when it has not reported.
 * @returns The offer, or null when there is nothing to ask about.
 */
const entrySiteOffer = (
  vaultContainer: VaultContainer,
  entryId: EntryId,
  pageUrl: string | null,
): SiteOffer | null => {
  const entry = vaultContainer.entryFor(entryId)
  if (!entry) return null

  return siteOfferFor({
    pageUrl,
    entryClaimsPage:
      pageUrl !== null &&
      vaultContainer.entriesForUrl(pageUrl).some((it) => it.id === entryId),
    matchers: entry.matchers,
    siteUrl: entry.url,
  })
}

/**
 * Puts the "remember this site?" question on the page, if there is one to ask.
 *
 * Shaped like `entrySiteOffer`: the vault questions are answered here and the
 * rule stays in the pure module. It fails quietly on purpose -- the fill has
 * already succeeded and the code is in the field, so a page that cannot host
 * the prompt should cost the user a matcher, never the fill.
 * @param registry - Where the pending offer is kept.
 * @param vaultContainer - The unlocked vault.
 * @param about - The tab, the entry, the page url and where the code went.
 */
const offerToRememberSite = async (
  registry: RememberOfferRegistry,
  vaultContainer: VaultContainer,
  about: {
    tabId: number
    entryId: EntryId
    pageUrl: string | null
    inSubframe: boolean
  },
): Promise<void> => {
  const offer = entrySiteOffer(vaultContainer, about.entryId, about.pageUrl)
  const entry = vaultContainer.entryFor(about.entryId)
  if (!offer || !entry) return

  // The prompt names this page, because it is often drawn on a different one.
  // A page that cannot be named honestly is not asked about at all -- the same
  // rule `pickFillTarget` applies to a frame it cannot disclose.
  const pageHost = hostOf(offer.pageUrl)
  if (pageHost === null) return

  const pending = await registry.open({
    tabId: about.tabId,
    entryId: about.entryId,
    // Resolved here rather than in the prompt, which is never told the entry.
    entryLabel: entry.issuer || entry.name || 'That entry',
    pageHost,
    offer,
    inSubframe: about.inSubframe,
    // The page it is about is also the page it is first shown on, so the
    // re-show check below does not immediately fire on this same document.
    shownOnUrl: offer.pageUrl,
  })

  // `true` is the frame confirming it mounted; anything else -- a null from a
  // frame that is not listening, an undefined from a handler that threw -- is not.
  const shown = await ctActions.showRememberPrompt(about.tabId, pending.token)
  if (shown !== true) {
    // Worth a line: from the user's side an offer that is never shown and an
    // offer that was never made look identical, and this is the difference.
    log.warn(
      'Nothing answered SHOW_REMEMBER_PROMPT; the offer will expire unanswered.',
    )
  }
}

/**
 * Puts an unanswered prompt back after the page navigated out from under it.
 *
 * The cost of asking on the page instead of in the popup: a submit replaces the
 * document and takes the prompt with it, and submitting is exactly what the
 * user does next. The offer itself is in session storage and survives, so the
 * prompt is remounted when frame 0 reports from a page it has not been shown on.
 *
 * **It follows the tab wherever it goes, host included.** Logging in routinely
 * lands somewhere other than the login domain -- an idp hands off to the app, a
 * `accounts.` host redirects to a bare one -- and those are exactly the entries
 * with no matcher yet, which is the case this whole feature exists for. A
 * same-host guard would have switched it off for them.
 *
 * What makes that safe to read is that the prompt names the host it is asking
 * about rather than saying "this site" (`RememberOfferView.pageHost`), so a
 * panel drawn on a page it is not about still says something true. The
 * `shownOnUrl` comparison remains: an SPA re-reports on every dom change, and
 * the prompt should not be remounted on the document it is already sitting on.
 * @param registry - Where the pending offer is kept.
 * @param tabId - The reporting tab.
 * @param url - Frame 0's url, as the browser supplied it.
 */
const reshowRememberPrompt = async (
  registry: RememberOfferRegistry,
  tabId: number,
  url: string,
): Promise<void> => {
  const pending = await registry.forTab(tabId)
  if (!pending) return
  if (pending.shownOnUrl === url) return

  // Marked before it is sent, so a frame that reports twice in quick
  // succession cannot mount two prompts.
  await registry.markShownOn(tabId, url)
  await ctActions.showRememberPrompt(tabId, pending.token)
}

/**
 * Runs a vault action and reports its outcome instead of throwing.
 *
 * A handler that rejects reaches the popup as a generic runtime error with the
 * real reason stripped off, and the reason is the whole message here -- "wrong
 * password" and "password is too weak" are what the user has to act on.
 */
const attempt = async (
  action: () => Promise<unknown>,
): Promise<VaultActionResult> => {
  try {
    await action()
    return { ok: true, error: null }
  } catch (error) {
    const message = describeVaultError(error)
    log.warn(`Vault action failed: ${message}`)
    return { ok: false, error: message }
  }
}

/**
 * Renders one detected field for the popup's debug pane.
 *
 * Four lines, because the reader's first question is always "which box on the
 * page is that?" -- `elementDescription` answers it the way devtools would,
 * and `css` is the line to paste into the console. They are kept apart rather
 * than merged: the description keeps framework-generated ids that the
 * selector builder throws away, so the two disagree often and usefully.
 */
const describeField = (field: OtpFieldReport['fields'][number]): string => {
  const kind =
    field.kind === 'segmented'
      ? `segmented×${String(field.segmentCount)}`
      : 'single'

  const lines = [
    `  ${field.id}  ${field.confidence} ${String(field.score)}  ${kind}  ${field.source}`,
    `    at   ${field.elementDescription}`,
    `    css  ${field.selector}`,
  ]

  // Without the host chain a shadow-rooted field's css path is a selector
  // that document.querySelector can never match, which reads as a bug.
  if (field.shadowHostPath !== null) {
    lines.push(`    host ${field.shadowHostPath} (shadowRoot)`)
  }

  lines.push(
    `    why  ${field.reasons.map((reason) => reason.code).join(', ')}`,
  )

  return lines.join('\n')
}

/**
 * Renders every frame's report for one tab into the popup's debug pane.
 *
 * Frames that found nothing are left out. Every frame reports once at load
 * whether or not it found anything, and on a page with no second-factor form
 * -- which is nearly every page -- listing them all buries whatever is worth
 * reading under a wall of urls.
 *
 * The exception is a frame whose saved `inputSelector` matched nothing. That
 * is a finding in itself, and it can only ever appear on a frame that has no
 * fields to list.
 */
const describeReport = (reports: OtpFieldReport[]): string =>
  reports
    .filter((report) => report.fields.length > 0 || report.overrideMissed)
    .flatMap((report) => [
      `${report.url} (frame ${String(report.frameId)})${report.overrideMissed ? ' [inputSelector matched nothing]' : ''}`,
      ...report.fields.map(describeField),
    ])
    .join('\n')

const handleMessage = bindDependencies(unboundHandleMessage, [
  IOC_TYPES.StateManager,
  IOC_TYPES.ConfigContainer,
  IOC_TYPES.OtpFieldRegistry,
  IOC_TYPES.AutofillOfferRegistry,
  IOC_TYPES.RememberOfferRegistry,
  IOC_TYPES.VaultContainer,
])

function handleMessageContainer(
  action: BgActionObject,
  sender: Browser.runtime.MessageSender,
  sendResponse: (_arg: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
): true {
  void handleMessage(action, sender)
    .catch((error: unknown) => {
      // never leave the sender hanging on a rejected handler
      log.error(error instanceof Error ? error : new Error(String(error)))
      return null
    })
    .then(sendResponse)
  return true
}
export default handleMessageContainer
