import { type Component, createSignal } from 'solid-js'
import useStore from '../store/useStore'
import actions from '../store/actions'
import useSyncStoreWithLib from '../utils/useSyncStoreWithLib'
import {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Passphrase,
  Salt,
  UserId,
} from '2falib'
import { syncServerUrl } from '../parameters'

const Login: Component = () => {
  const [, dispatch] = useStore()
  const [password, setPassword] = createSignal('')
  const syncStoreWithLib = useSyncStoreWithLib()

  const login = async () => {
    const [state] = useStore()
    const { twoFaLib } = state
    if (!twoFaLib) {
      throw new Error('twoFaLib not loaded')
    }

    const lockedRepresentation = localStorage.getItem('lockedRepresentation')
    const encryptedPrivateKey = localStorage.getItem('encryptedPrivateKey')
    const encryptedSymmetricKey = localStorage.getItem('encryptedSymmetricKey')
    const salt = localStorage.getItem('salt')
    const syncDevices = localStorage.getItem('syncDevices')
    const userId = localStorage.getItem('userId')

    if (
      !lockedRepresentation ||
      !encryptedPrivateKey ||
      !encryptedSymmetricKey ||
      !salt ||
      !userId
    ) {
      throw new Error('localStorage is not complete')
    }

    await twoFaLib.init(
      encryptedPrivateKey as EncryptedPrivateKey,
      encryptedSymmetricKey as EncryptedSymmetricKey,
      salt as Salt,
      password() as Passphrase,
      userId as UserId,
      syncServerUrl,
      syncDevices ? JSON.parse(syncDevices) : undefined,
    )
    await twoFaLib.persistentStorage.loadFromLockedRepresentation(
      lockedRepresentation,
    )

    syncStoreWithLib(twoFaLib)
    dispatch(actions.setAuthenticated(true))
  }

  const onSubmit = (e: Event) => {
    e.preventDefault()
    void login()
  }

  return (
    <form
      onSubmit={onSubmit}
      class="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow-md"
    >
      <h2 class="text-2xl font-bold mb-4">Login</h2>
      {/* Add your login form fields here */}
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
        Log In
      </button>
    </form>
  )
}

export default Login
