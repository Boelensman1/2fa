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
  StateManager,
  VaultActionResult,
  VaultContainer,
} from '../types'

const log = new Logger('background-script/handleMessage')

import { setVerboseLogging } from '../classes/Logger'

import { describeVaultError } from '../ioc/entities/VaultContainer'

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
]

async function unboundHandleMessage(
  [
    stateManager,
    configContainer,
    otpFieldRegistry,
    autofillOfferRegistry,
    vaultContainer,
  ]: [
    StateManager,
    ConfigContainer,
    OtpFieldRegistry,
    AutofillOfferRegistry,
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
      const { tab, frameId, url } = sender
      if (tab?.id === undefined) return null

      otpFieldRegistry.record({
        tabId: tab.id,
        frameId: frameId ?? 0,
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
