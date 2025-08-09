import browser from 'webextension-polyfill'

import {
  BG_ACTION_KEYS,
  Logger,
  bindDependencies,
  IOC_TYPES,
} from '../../internals'

import type { BgActionObject, StateManager } from '../../types'

const log = new Logger('background-script/handleMessage')

import handleDebugCommand from './handleDebugCommand'

const actionsAllowedWhenNotFinishedLoaded: (keyof typeof BG_ACTION_KEYS)[] = [
  BG_ACTION_KEYS.GET_STATE,
  BG_ACTION_KEYS.SEND_LOG,
  BG_ACTION_KEYS.SEND_DEBUG_COMMAND,
]

async function unboundHandleMessage(
  [stateManager]: [StateManager],
  action: BgActionObject,
  sender: browser.Runtime.MessageSender,
) {
  log.trace('Incoming message', { action, sender })
  const state = stateManager.getState()

  if (
    state.status === 'loading' &&
    !actionsAllowedWhenNotFinishedLoaded.includes(action.type)
  ) {
    // we haven't finished initialising yet
    return null
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
  }
}

const handleMessage = bindDependencies(unboundHandleMessage, [
  IOC_TYPES.StateManager,
])

function handleMessageContainer(
  action: BgActionObject,
  sender: browser.Runtime.MessageSender,
  sendResponse: (_arg: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
): true {
  void handleMessage(action, sender).then(sendResponse)
  return true
}
export default handleMessageContainer
