import type { EntryMeta, TwoFaLib } from 'favalib'

interface State {
  entries: EntryMeta[]
  vaultExists: boolean
  twoFaLib: TwoFaLib | null
  isConnectingToExistingVault: boolean
  settings: {
    maskEntries: boolean
  }
}

export default State
