import { type Component, createSignal, createEffect } from 'solid-js'
import { Password, TwoFaLibEvent } from 'favalib'
import type { ZxcvbnResult } from '@zxcvbn-ts/core'

import useStore from '../store/useStore'
import actions from '../store/actions'
import saveFunction from '../utils/saveFunction'
import useSyncStoreWithLib from '../utils/useSyncStoreWithLib'
import PasswordStrengthMeter from './PasswordStrengthMeter'
import creationUtils from '../utils/creationUtils'

const CreateVault: Component = () => {
  const [, dispatch] = useStore()
  const [password, setPassword] = createSignal<Password>('' as Password)
  const [mode, setMode] = createSignal<'create' | 'connect'>('create')
  const syncStoreWithLib = useSyncStoreWithLib()
  const [passwordStrength, setPasswordStrength] =
    createSignal<ZxcvbnResult | null>(null)

  const createVault = async () => {
    const { twoFaLib } = await creationUtils.createNewTwoFaLibVault(password())

    twoFaLib.storage.setSaveFunction((newLockedRepresentationString) => {
      saveFunction(newLockedRepresentationString)
      syncStoreWithLib(twoFaLib)
    })

    twoFaLib.addEventListener(
      TwoFaLibEvent.ConnectToExistingVaultFinished,
      () => {
        dispatch(actions.setConnectingToExistingVault(false))
      },
    )
    if (mode() === 'create') {
      void twoFaLib.storage.forceSave()
    }

    dispatch(actions.setConnectingToExistingVault(mode() === 'connect'))
    dispatch(actions.initialize(twoFaLib))
  }

  const onSubmit = (e: Event) => {
    e.preventDefault()
    void createVault()
  }

  const calculatePasswordStrength = async (
    password: Password,
  ): Promise<ZxcvbnResult> => {
    return await creationUtils.getPasswordStrength(password, ['browser'])
  }

  createEffect(() => {
    void calculatePasswordStrength(password()).then(setPasswordStrength)
  })

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
          onInput={(e) => setPassword(e.currentTarget.value as Password)}
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          autocomplete="new-password"
          required
        />
        <PasswordStrengthMeter
          password={password()}
          passwordStrength={passwordStrength()}
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
