import { createSignal } from 'solid-js'
import useStore from '../store/useStore'
import useSyncStoreWithLib from '../utils/useSyncStoreWithLib'

const Add = () => {
  const [name, setName] = createSignal('')
  const [secret, setSecret] = createSignal('')
  const [issuer, setIssuer] = createSignal('')
  const [digits, setDigits] = createSignal<6 | 8>(6)
  const syncStoreWithLib = useSyncStoreWithLib()

  const add = async () => {
    if (!name() || !secret() || !issuer()) {
      return
    }

    const [state] = useStore()
    const { twoFaLib } = state
    if (!twoFaLib) {
      throw new Error('twoFaLib not loaded')
    }
    await twoFaLib.vault.addEntry({
      name: name(),
      type: 'TOTP',
      issuer: issuer(),
      payload: {
        secret: secret(),
        digits: digits(),
        algorithm: 'SHA-1',
        period: 30,
      },
    })
    syncStoreWithLib(twoFaLib)
    // save to localStorage
    setName('')
    setSecret('')
    setIssuer('')
    setDigits(6)
  }

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    void add()
  }

  return (
    <form
      onSubmit={handleSubmit}
      class="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow-md"
    >
      <div class="mb-4">
        <input
          type="text"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          placeholder="Name"
          required
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div class="mb-4">
        <input
          type="text"
          value={secret()}
          onInput={(e) => setSecret(e.currentTarget.value)}
          placeholder="Secret"
          required
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div class="mb-4">
        <input
          type="text"
          value={issuer()}
          onInput={(e) => setIssuer(e.currentTarget.value)}
          placeholder="Issuer"
          required
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div class="mb-4">
        <label class="block text-gray-700 text-sm font-bold mb-2">
          Digits:
          <select
            value={digits()}
            onChange={(e) =>
              setDigits(parseInt(e.currentTarget.value) as 6 | 8)
            }
            class="ml-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={6}>6</option>
            <option value={8}>8</option>
          </select>
        </label>
      </div>
      <button
        type="submit"
        class="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition duration-200"
      >
        Add Item
      </button>
    </form>
  )
}

export default Add
