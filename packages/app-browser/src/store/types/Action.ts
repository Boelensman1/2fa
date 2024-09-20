import type { types } from '../actions'
import type { TwoFaLib, EntryMeta } from '2falib'

interface SetEntriesAction {
  type: typeof types.SET_ENTRIES
  payload: EntryMeta[]
}

interface SetAuthenticatedAction {
  type: typeof types.SET_AUTHENTICATED
  payload: boolean
}

interface InitializeAction {
  type: typeof types.INITIALIZE
  payload: TwoFaLib | null
}

interface SetSettingsAction {
  type: typeof types.SET_SETTINGS
  payload: {
    maskEntries: boolean
  }
}

type Action =
  | SetEntriesAction
  | SetAuthenticatedAction
  | InitializeAction
  | SetSettingsAction

export default Action
