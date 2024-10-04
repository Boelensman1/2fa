import { type Component, createSignal } from 'solid-js'
import { createTwoFaLib, Passphrase } from '2falib'
import BrowserCryptoProvider from '2falib/cryptoProviders/browser'

import { syncServerUrl } from '../parameters'

import useStore from '../store/useStore'
import actions from '../store/actions'
import saveFunction from '../utils/saveFunction'
import useSyncStoreWithLib from '../utils/useSyncStoreWithLib'

const CreateVault: Component = () => {
  const [, dispatch] = useStore()
  const [password, setPassword] = createSignal('')
  const [mode, setMode] = createSignal<'create' | 'connect'>('create')
  const syncStoreWithLib = useSyncStoreWithLib()

  const createVault = async () => {
    const cryptoLib = new BrowserCryptoProvider()
    const passphrase = password() as Passphrase
    const { twoFaLib } = await createTwoFaLib(
      'browser',
      cryptoLib,
      passphrase,
      saveFunction(syncStoreWithLib),
      syncServerUrl,
    )

    const isConnecting = mode() === 'connect'
    localStorage.setItem('connecting', String(isConnecting))

    dispatch(actions.setAuthenticated(true))
    dispatch(actions.initialize(twoFaLib, isConnecting))
  }

  const onSubmit = (e: Event) => {
    e.preventDefault()
    void createVault()
  }

  return (
    <form
      onSubmit={onSubmit}
      class="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow-md"
    >
      <h2 class="text-2xl font-bold mb-4">
        {mode() === 'create' ? 'Create vault' : 'Connect to existing vault'}
      </h2>
      <div class="mb-4">
        <label
          for="password"
          class="block text-sm font-medium text-gray-700 mb-1"
        >
          New password
        </label>
        <input
          type="password"
          id="password"
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
      </div>
      <button
        type="submit"
        class="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition duration-200 mb-4"
      >
        {mode() === 'create' ? 'Create Vault' : 'Connect to Vault'}
      </button>
      <button
        type="button"
        onClick={() => setMode(mode() === 'create' ? 'connect' : 'create')}
        class="w-full bg-gray-200 text-gray-800 py-2 px-4 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 transition duration-200"
      >
        {mode() === 'create'
          ? 'Or connect to Existing Vault'
          : 'Create New Vault'}
      </button>
    </form>
  )
}

export default CreateVault
