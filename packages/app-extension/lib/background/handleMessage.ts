import type { Browser } from 'wxt/browser'

import { BG_ACTION_KEYS, Logger, bindDependencies, IOC_TYPES } from '../'
import { notifyConnectors } from '../util'

import type {
  BgActionObject,
  Config,
  ConfigContainer,
  OtpFieldRegistry,
  OtpFieldReport,
  StateManager,
} from '../types'

const log = new Logger('background-script/handleMessage')

import { setVerboseLogging } from '../classes/Logger'

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

async function unboundHandleMessage(
  [stateManager, configContainer, otpFieldRegistry]: [
    StateManager,
    ConfigContainer,
    OtpFieldRegistry,
  ],
  action: BgActionObject,
  sender: Browser.runtime.MessageSender,
) {
  log.trace('Incoming message', { action, sender })

  if (!actionsThatMustNotWaitForInit.includes(action.type)) {
    await whenInitFinished()
  }

  const state = stateManager.getState()

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
      // Until there is a vault to fill from, the debug view is the only way to
      // see what the heuristic did. The popup already renders debugString.
      state.debugString = describeReport(otpFieldRegistry.forTab(tab.id))
      return null
    }
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
