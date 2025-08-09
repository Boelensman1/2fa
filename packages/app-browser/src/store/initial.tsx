import State from './types/State'

const initial: State = {
  entries: [],
  favaLib: null,
  vaultExists: false,
  isConnectingToExistingVault: false,
  settings: {
    maskEntries: false,
  },
}

export default initial
