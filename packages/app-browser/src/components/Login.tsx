import { type Component, createSignal, Show } from 'solid-js'
import {
  FavaLibEvent,
  StorageVersionError,
  UnsupportedStorageVersionError,
  type LockedRepresentationString,
  type Password,
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
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  // A vault we cannot read is still a vault. Resetting wipes localStorage, and
  // unlike the CLI this app keeps no backup, so offering Reset next to a
  // "cannot read this version" message would invite people to destroy
  // recoverable data. Both storage-version directions set this.
  const [vaultIsUnreadable, setVaultIsUnreadable] = createSignal(false)
  const syncStoreWithLib = useSyncStoreWithLib()

  const login = async (enteredPassword: Password) => {
    const lockedRepresentation = localStorage.getItem('lockedRepresentation')
    if (!lockedRepresentation) {
      throw new Error('localStorage is not complete')
    }

    const favaLib = await creationUtils.loadFavaLibFromLockedRepesentation(
      lockedRepresentation as LockedRepresentationString,
      enteredPassword,
    )

    favaLib.storage.setSaveFunction((newLockedRepresentationString) => {
      saveFunction(newLockedRepresentationString)
      syncStoreWithLib(favaLib)
    })

    favaLib.addEventListener(FavaLibEvent.Log, (event) => {
      switch (event.detail.severity) {
        case 'info':
          console.log(event.detail.message)
          break
        case 'warning':
          console.warn(event.detail.message)
          break
        case 'error':
          console.error(event.detail.message)
          break
      }
    })

    syncStoreWithLib(favaLib)
    dispatch(actions.initialize(favaLib))
  }

  const onSubmit = (e: Event) => {
    e.preventDefault()
    setErrorMessage(null)
    login(password() as Password).catch((err: unknown) => {
      // The two directions get opposite advice, which is why they are separate
      // error types. Reloading fetches a newer app and fixes the first; nothing
      // this app can do fixes the second, because there is no migration from
      // the older format — the entries have to come across as an export.
      if (err instanceof UnsupportedStorageVersionError) {
        setVaultIsUnreadable(true)
        setErrorMessage(
          'This vault was saved in an older storage format that this version ' +
            'cannot read, and there is no automatic upgrade. Open it with the ' +
            'version of the app that wrote it, export your entries, and import ' +
            'them here. Your data is intact — do not reset.',
        )
        return
      }
      if (err instanceof StorageVersionError) {
        setVaultIsUnreadable(true)
        setErrorMessage(
          'This vault was saved by a newer version of the app, so this version ' +
            'cannot read it safely. Reload the page to pick up the latest ' +
            'version. Your data is intact — do not reset.',
        )
        return
      }
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not unlock the vault.',
      )
    })
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
        <Show when={errorMessage()}>
          <p class="text-red-500 mt-2">{errorMessage()}</p>
        </Show>
        <Show when={!vaultIsUnreadable()}>
          <button
            type="button"
            onClick={onReset}
            class="w-full bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 transition duration-200 mt-2"
          >
            Reset
          </button>
        </Show>
      </form>
      <div class="fixed bottom-2 right-2 text-xs text-gray-500">
        version {version}
      </div>
    </div>
  )
}

export default Login
