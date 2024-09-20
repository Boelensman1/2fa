import { type Component, createSignal } from 'solid-js'
import { createTwoFaLib, Passphrase } from '2falib'
import BrowserCryptoProvider from '2falib/cryptoProviders/browser'
import useStore from '../store/useStore'
import actions from '../store/actions'
import saveFunction from '../utils/saveFunction'

const CreateVault: Component = () => {
  const [, dispatch] = useStore()
  const [password, setPassword] = createSignal('')

  const createVault = async () => {
    const cryptoLib = new BrowserCryptoProvider()
    const passphrase = password() as Passphrase
    const { twoFaLib } = await createTwoFaLib(
      cryptoLib,
      passphrase,
      saveFunction,
    )

    dispatch(actions.setAuthenticated(true))
    dispatch(actions.initialize(twoFaLib))
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
      <h2 class="text-2xl font-bold mb-4">Create vault</h2>
      <div class="mb-4">
        <label
          for="password"
          class="block text-sm font-medium text-gray-700 mb-1"
        >
          Password
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
        class="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition duration-200"
      >
        Create Vault
      </button>
    </form>
  )
}

export default CreateVault
