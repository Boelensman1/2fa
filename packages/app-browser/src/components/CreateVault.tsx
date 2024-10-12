import {
  type Component,
  createSignal,
  createMemo,
  createEffect,
  For,
} from 'solid-js'
import {
  getTwoFaLibVaultCreationUtils,
  Passphrase,
  TwoFaLibEvent,
} from '2falib'
import BrowserCryptoProvider from '2falib/cryptoProviders/browser'
import type { ZxcvbnResult } from '@zxcvbn-ts/core'

import { deviceType, passphraseExtraDict, syncServerUrl } from '../parameters'

import useStore from '../store/useStore'
import actions from '../store/actions'
import saveFunction from '../utils/saveFunction'
import useSyncStoreWithLib from '../utils/useSyncStoreWithLib'

const passphraseGuessesToPercentage = (guessesLog10: number) => {
  return Math.min(100, Math.round(Math.max(0, guessesLog10 - 1)) * 10)
}

const CreateVault: Component = () => {
  const [, dispatch] = useStore()
  const [password, setPassword] = createSignal<Passphrase>('' as Passphrase)
  const [mode, setMode] = createSignal<'create' | 'connect'>('create')
  const syncStoreWithLib = useSyncStoreWithLib()
  const [passwordStrength, setPasswordStrength] =
    createSignal<ZxcvbnResult | null>(null)

  const creationUtils = createMemo(() =>
    getTwoFaLibVaultCreationUtils(new BrowserCryptoProvider()),
  )

  const createVault = async () => {
    const passphrase = password()
    const { twoFaLib } = await creationUtils().createNewTwoFaLibVault(
      deviceType,
      passphrase,
      passphraseExtraDict,
      syncServerUrl,
    )

    twoFaLib.addEventListener(TwoFaLibEvent.Changed, (event) => {
      saveFunction(event.detail.changed, event.detail.data)
      syncStoreWithLib(twoFaLib)
    })
    twoFaLib.addEventListener(
      TwoFaLibEvent.ConnectToExistingVaultFinished,
      () => {
        dispatch(actions.setConnectingToExistingVault(false))
      },
    )
    if (mode() === 'create') {
      void twoFaLib.persistentStorage.save()
    }

    dispatch(actions.setAuthenticated(true))
    dispatch(actions.setConnectingToExistingVault(mode() === 'connect'))
    dispatch(actions.initialize(twoFaLib))
  }

  const onSubmit = (e: Event) => {
    e.preventDefault()
    void createVault()
  }

  const calculatePasswordStrength = async (
    passphrase: Passphrase,
  ): Promise<ZxcvbnResult> => {
    return await creationUtils().getPassphraseStrength(passphrase, ['browser'])
  }

  createEffect(() => {
    void calculatePasswordStrength(password()).then(setPasswordStrength)
  })

  const getPasswordStrengthColor = (score: number) => {
    const colors = [
      'bg-red-500',
      'bg-orange-500',
      'bg-yellow-500',
      'bg-green-500',
      'bg-blue-500',
    ]
    return colors[score] || colors[0]
  }

  const renderPasswordSuggestions = () => {
    if (!passwordStrength() || password() === '') return null
    const { score, feedback } = passwordStrength()!
    return (
      <div class="mt-2 text-sm">
        <p
          class={`font-medium ${score > 2 ? 'text-green-600' : 'text-red-600'}`}
        >
          {score > 2 ? 'Strong password' : 'Weak password'}
        </p>
        {feedback.warning && <p class="text-orange-500">{feedback.warning}</p>}
        {feedback.suggestions.length > 0 && (
          <ul class="list-disc list-inside text-gray-600">
            <For each={feedback.suggestions}>
              {(suggestion) => <li>{suggestion}</li>}
            </For>
          </ul>
        )}
      </div>
    )
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
          onInput={(e) => setPassword(e.currentTarget.value as Passphrase)}
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          autocomplete="new-password"
          required
        />
        <div class="mt-2">
          <div class="flex justify-between mb-1">
            <span class="text-xs font-medium text-gray-500">
              Password strength:
            </span>
            <span class="text-xs font-medium text-gray-500">
              {passphraseGuessesToPercentage(
                passwordStrength()?.guessesLog10 ?? 0,
              )}
              %
            </span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-2.5">
            <div
              class={`${getPasswordStrengthColor(passwordStrength()?.score ?? 0)} h-2.5 rounded-full transition-all duration-300`}
              style={{
                width: `${passphraseGuessesToPercentage(
                  passwordStrength()?.guessesLog10 ?? 0,
                )}%`,
              }}
            />
          </div>
          {renderPasswordSuggestions()}
        </div>
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
