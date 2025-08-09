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
      draft.favaLib = action.payload
      draft.vaultExists = true
      break
    }
    case types.SET_CONNECTING_TO_EXISTING_VAULT: {
      draft.isConnectingToExistingVault = action.payload
      break
    }
    case types.SET_SETTINGS: {
      draft.settings = action.payload
      break
    }
    case types.SET_VAULT_EXISTS: {
      draft.vaultExists = action.payload
      break
    }
  }
}

export default reducer
