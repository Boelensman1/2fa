import { browser } from 'wxt/browser'

import { container, Logger, IOC_TYPES } from '../'
import { setVerboseLogging } from '../classes/Logger'
import type {
  AutofillOfferRegistry,
  ConfigContainer,
  RememberOfferRegistry,
  Db,
  OtpFieldRegistry,
  StateManager,
  VaultContainer,
} from '../types'

const log = new Logger('background-script/init')

const runInit = async () => {
  log.info('Running init')

  const stateManager = container.get<StateManager>(IOC_TYPES.StateManager)
  const state = stateManager.getState()

  try {
    const db = container.get<Db>(IOC_TYPES.DB)
    await db.init()

    const config = container.get<ConfigContainer>(IOC_TYPES.ConfigContainer)
    await config.init()
    setVerboseLogging(config.get('debug'))

    // Reports and offers are keyed by tab, so a closed tab's would otherwise
    // sit in the registries until the service worker is killed.
    const registry = container.get<OtpFieldRegistry>(IOC_TYPES.OtpFieldRegistry)
    const offers = container.get<AutofillOfferRegistry>(
      IOC_TYPES.AutofillOfferRegistry,
    )
    const rememberOffers = container.get<RememberOfferRegistry>(
      IOC_TYPES.RememberOfferRegistry,
    )
    browser.tabs.onRemoved.addListener((tabId) => {
      registry.forgetTab(tabId)
      offers.forgetTab(tabId)
      // Async, unlike the other two: this one is in session storage so that a
      // pending question survives the worker being evicted. Nothing waits on it.
      void rememberOffers.forgetTab(tabId)
    })

    // mv3 evicts this worker after ~30s idle, so a popup opening a minute
    // later lands on a cold start. Without this the vault would read as locked
    // and ask for the password again, every time.
    const vault = container.get<VaultContainer>(IOC_TYPES.VaultContainer)
    await vault.restoreSession()

    state.status = 'ready'
  } catch (error) {
    // resolve anyway: callers gate on this promise, and leaving it pending
    // would wedge every message for the life of the service worker
    log.error(error instanceof Error ? error : new Error(String(error)))
    state.status = 'error'
  }
}

let initPromise: Promise<void> | undefined

// init runs once per service worker. Whoever asks first starts it; everyone
// else awaits the same promise.
const init = () => (initPromise ??= runInit())

export const whenInitFinished = () => init()

export default init
