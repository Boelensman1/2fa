import { type Component, createEffect } from 'solid-js'
import { Show } from 'solid-js'
import useStore from './store/useStore'
import actions from './store/actions'
import type State from './store/types/State'
import { TwoFaLib, TwoFaLibEvent } from '2falib'
import BrowserCryptoProvider from '2falib/cryptoProviders/browser'

import AppAuthenticated from './components/AppAuthenticated'
import Login from './components/Login'
import ConnectToExistingVault from './components/ConnectToExistingVault'
import CreateVault from './components/CreateVault'
import saveFunction from './utils/saveFunction'
import useSyncStoreWithLib from './utils/useSyncStoreWithLib'

const App: Component = () => {
  const [state, dispatch] = useStore()
  const syncStoreWithLib = useSyncStoreWithLib()

  // Async function to initialize the app
  const initializeApp = () => {
    const lockedRepresentation = localStorage.getItem('lockedRepresentation')
    const encryptedPrivateKey = localStorage.getItem('encryptedPrivateKey')
    const encryptedSymmetricKey = localStorage.getItem('encryptedSymmetricKey')
    const salt = localStorage.getItem('salt')
    const settings = localStorage.getItem('settings')

    if (
      !lockedRepresentation ||
      !encryptedPrivateKey ||
      !encryptedSymmetricKey ||
      !salt
    ) {
      dispatch(actions.initialize(null))
      return
    }

    if (settings) {
      const parsedSettings = JSON.parse(settings) as State['settings']
      dispatch(actions.setSettings(parsedSettings))
    }

    const cryptoLib = new BrowserCryptoProvider()
    const twoFaLib = new TwoFaLib('browser', cryptoLib)
    twoFaLib.addEventListener(TwoFaLibEvent.Changed, (event) => {
      saveFunction(event.detail.changed, event.detail.data)
      syncStoreWithLib(twoFaLib)
    })
    dispatch(actions.initialize(twoFaLib, false))
  }

  // Run initializeApp when the component mounts
  createEffect(() => {
    initializeApp()
  })

  return (
    <div class="container mx-auto p-4">
      <Show when={state.twoFaLib} fallback={<CreateVault />}>
        <Show when={state.vaultIsUnlocked} fallback={<Login />}>
          <Show
            when={!state.isConnectingToExistingVault}
            fallback={<ConnectToExistingVault />}
          >
            <AppAuthenticated />
          </Show>
        </Show>
      </Show>
    </div>
  )
}

export default App
