import { browser } from 'wxt/browser'

import { container, Logger, IOC_TYPES } from '../'
import { setVerboseLogging } from '../classes/Logger'
import type {
  ConfigContainer,
  Db,
  OtpFieldRegistry,
  StateManager,
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

    // Reports are keyed by tab and frame, so a closed tab's would otherwise
    // sit in the registry until the service worker is killed.
    const registry = container.get<OtpFieldRegistry>(IOC_TYPES.OtpFieldRegistry)
    browser.tabs.onRemoved.addListener((tabId) => {
      registry.forgetTab(tabId)
    })

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
