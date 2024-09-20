import { Accessor, createMemo, createSignal } from 'solid-js'
import useStore from '../store/useStore'
import useSyncStoreWithLib from '../utils/useSyncStoreWithLib'
import type { EntryMeta, EntryId } from '2falib'

const EntryComponent = (props: {
  entry: EntryMeta
  currentTime: Accessor<number>
}) => {
  const [state] = useStore()
  const syncStoreWithLib = useSyncStoreWithLib()
  const twoFaLib = state.twoFaLib!
  const [copyStatus, setCopyStatus] = createSignal('')

  const generateTOTP = (entryId: EntryId, timestamp: number) => {
    try {
      const { otp, validFrom, validTill } = twoFaLib.generateTokenForEntry(
        entryId,
        timestamp,
      )
      const totalTime = validTill - validFrom
      const remainingTime = validTill - timestamp
      const progress = (remainingTime / totalTime) * 100
      return { otp, progress }
    } catch (error) {
      console.error('Error generating TOTP:', error)
      return { otp: 'Invalid', progress: 0 }
    }
  }

  const totpData = createMemo(() => {
    return generateTOTP(
      props.entry.id,
      // Force re-evaluation by using currentTime()
      props.currentTime(),
    )
  })
  const displayOtp = createMemo(() => {
    const { otp } = totpData()
    return state.settings.maskEntries ? '•'.repeat(otp.length) : otp
  })

  const handleDelete = (event: Event) => {
    event.stopPropagation()

    const confirmDelete = confirm(
      `Are you sure you want to delete the entry for ${props.entry.issuer}?`,
    )

    if (confirmDelete) {
      void twoFaLib.deleteEntry(props.entry.id).then(() => {
        syncStoreWithLib(twoFaLib)
      })
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard
      .writeText(totpData().otp)
      .then(() => {
        setCopyStatus('Copied!')
        setTimeout(() => setCopyStatus(''), 2000)
      })
      .catch((err) => {
        console.error('Failed to copy text: ', err)
        setCopyStatus('Failed to copy')
      })
  }

  return (
    <li
      class="bg-gray-100 p-3 rounded-md cursor-pointer transition-colors relative"
      onClick={copyToClipboard}
      title="Click to copy TOTP"
    >
      <div class="flex flex-col mb-2">
        <div class="flex justify-between items-center">
          <span class="font-medium">{props.entry.issuer}</span>
          <div class="flex items-center">
            <span class="font-mono text-lg mr-3">{displayOtp()}</span>
            <button
              onClick={handleDelete}
              class="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600 transition-colors z-10"
            >
              Delete
            </button>
          </div>
        </div>
        <span class="text-sm text-gray-600">{props.entry.name}</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2.5">
        <div
          class="bg-blue-600 h-2.5 rounded-full"
          style={{
            width: `${totpData().progress}%`,
            transition: 'width 1s linear',
          }}
        />
      </div>
      {copyStatus() && (
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="bg-green-500 text-white px-3 py-1 rounded text-sm shadow-md">
            {copyStatus()}
          </div>
        </div>
      )}
    </li>
  )
}

export default EntryComponent
