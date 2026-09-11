import type { Browser } from 'wxt/browser'

import { Logger, bindDependencies, IOC_TYPES } from '../'

// manually import getLoggers as we otherwise get a circular dependency
import { getLoggers } from '../classes/Logger'

import type { SendDebugCommandActionObject, StateManager } from '../types'

const log = new Logger('background-script/handleDebugCommand')

const unboundHandleDebugCommand = async (
  [stateManager]: [StateManager],
  action: SendDebugCommandActionObject,
  _sender: Browser.runtime.MessageSender,
  // eslint-disable-next-line @typescript-eslint/require-await
) => {
  log.info(`Incoming debug command ${action.data}`)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const state = stateManager.getState()
  switch (action.data) {
    case 'enableTraceLogging': {
      getLoggers().forEach((logger) => (logger.outputLevel = 10))
      return
    }
    default: {
      log.error(new Error(`Debug command not recognised: ${action.data}`))
    }
  }
}

export default bindDependencies(unboundHandleDebugCommand, [
  IOC_TYPES.StateManager,
])
