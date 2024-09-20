import { type Component, createEffect } from 'solid-js'
import { Show } from 'solid-js'
import useStore from './store/useStore'
import actions from './store/actions'
import { TwoFaLib } from '2falib'
import BrowserCryptoProvider from '2falib/cryptoProviders/browser'

import AppAuthenticated from './components/AppAuthenticated'
import Login from './components/Login'
import CreateVault from './components/CreateVault'
import saveFunction from './utils/saveFunction'

const App: Component = () => {
  const [state, dispatch] = useStore()

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
      const parsedSettings = JSON.parse(settings)
      dispatch(actions.setSettings(parsedSettings))
    }

    const cryptoLib = new BrowserCryptoProvider()
    const twoFaLib = new TwoFaLib(cryptoLib, saveFunction)
    dispatch(actions.initialize(twoFaLib))
  }

  // Run initializeApp when the component mounts
  createEffect(() => {
    initializeApp()
  })

  return (
    <div class="container mx-auto p-4">
      <Show when={state.twoFaLib} fallback={<CreateVault />}>
        <Show when={state.vaultIsUnlocked} fallback={<Login />}>
          <AppAuthenticated />
        </Show>
      </Show>
    </div>
  )
}

export default App
