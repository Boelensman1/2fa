import type State from './types/State'
import type Action from './types/Action'

import { types } from './actions'

const reducer = (action: Action, draft: State) => {
  switch (action.type) {
    case types.SET_ENTRIES: {
      draft.entries = action.payload
      break
    }
    case types.INITIALIZE: {
      if (action.payload) {
        draft.twoFaLib = action.payload
      } else {
        draft.twoFaLib = null
      }
      break
    }
    case types.SET_AUTHENTICATED: {
      draft.vaultIsUnlocked = action.payload
      break
    }
    case types.SET_SETTINGS: {
      draft.settings = action.payload
      break
    }
  }
}

export default reducer
