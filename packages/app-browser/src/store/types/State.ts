import type { EntryMeta, FavaLib } from 'favalib'

interface State {
  entries: EntryMeta[]
  vaultExists: boolean
  favaLib: FavaLib | null
  isConnectingToExistingVault: boolean
  settings: {
    maskEntries: boolean
  }
}

export default State
