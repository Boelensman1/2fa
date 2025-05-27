import { type Component, createSignal } from 'solid-js'
import {
  TwoFaLibEvent,
  type LockedRepresentationString,
  type Passphrase,
} from 'favalib'
import useStore from '../store/useStore'
import actions from '../store/actions'
import useSyncStoreWithLib from '../utils/useSyncStoreWithLib'
import { version } from '../parameters'
import saveFunction from '../utils/saveFunction'
import creationUtils from '../utils/creationUtils'

const Login: Component = () => {
  const [, dispatch] = useStore()
  const [password, setPassword] = createSignal('')
  const syncStoreWithLib = useSyncStoreWithLib()

  const login = async () => {
    const lockedRepresentation = localStorage.getItem('lockedRepresentation')
    if (!lockedRepresentation) {
      throw new Error('localStorage is not complete')
    }

    const twoFaLib = await creationUtils.loadTwoFaLibFromLockedRepesentation(
      lockedRepresentation as LockedRepresentationString,
      password() as Passphrase,
    )

    twoFaLib.storage.setSaveFunction((newLockedRepresentationString) => {
      saveFunction(newLockedRepresentationString)
      syncStoreWithLib(twoFaLib)
    })

    twoFaLib.addEventListener(TwoFaLibEvent.Log, (event) => {
      switch (event.detail.severity) {
        case 'info':
          console.log(event.detail.message)
          break
        case 'warning':
          console.warn(event.detail.message)
          break
      }
    })

    syncStoreWithLib(twoFaLib)
    dispatch(actions.initialize(twoFaLib))
  }

  const onSubmit = (e: Event) => {
    e.preventDefault()
    void login()
  }

  const onReset = () => {
    if (confirm('Are you sure you want to reset?')) {
      localStorage.clear()
      window.location.reload()
    }
  }

  return (
    <div>
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
            autocomplete="current-password"
            required
          />
        </div>
        <button
          type="submit"
          class="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition duration-200"
        >
          Log In
        </button>
        <button
          type="button"
          onClick={onReset}
          class="w-full bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 transition duration-200 mt-2"
        >
          Reset
        </button>
      </form>
      <div class="fixed bottom-2 right-2 text-xs text-gray-500">
        version {version}
      </div>
    </div>
  )
}

export default Login
