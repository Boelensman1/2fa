import { useContext } from 'solid-js'
import context from '../store/Context'
import actions from '../store/actions'
import type { FavaLib } from 'favalib'

const useSyncStoreWithLib = () => {
  const [, dispatch] = useContext(context)

  const syncStoreWithLib = (favaLib: FavaLib) => {
    dispatch(actions.setEntries(favaLib.vault.listEntriesMetas()))
  }

  return syncStoreWithLib
}

export default useSyncStoreWithLib
