import { Accessor, createMemo, createSignal, onCleanup, Show } from 'solid-js'
import useStore from '../store/useStore'
import useSyncStoreWithLib from '../utils/useSyncStoreWithLib'
import type { EntryMeta, EntryId } from 'favalib'

const EntryComponent = (props: {
  entry: EntryMeta
  currentTime: Accessor<number>
}) => {
  const [state] = useStore()
  const syncStoreWithLib = useSyncStoreWithLib()
  const favaLib = state.favaLib!
  const [copyStatus, setCopyStatus] = createSignal('')
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [renameMode, setRenameMode] = createSignal(false)
  const [renameIssuer, setRenameIssuer] = createSignal('')
  const [renameName, setRenameName] = createSignal('')

  const closeMenu = () => setMenuOpen(false)
  const onDocumentClick = () => closeMenu()
  document.addEventListener('click', onDocumentClick)
  onCleanup(() => document.removeEventListener('click', onDocumentClick))

  const generateTOTP = (entryId: EntryId, timestamp: number) => {
    try {
      const { otp, validFrom, validTill } = favaLib.vault.generateTokenForEntry(
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

  const handleKebabClick = (event: MouseEvent) => {
    event.stopPropagation()
    setMenuOpen(!menuOpen())
  }

  const handleMenuDelete = (event: MouseEvent) => {
    event.stopPropagation()
    setMenuOpen(false)

    const confirmDelete = confirm(
      `Are you sure you want to delete the entry for ${props.entry.issuer}?`,
    )

    if (confirmDelete) {
      void favaLib.vault.deleteEntry(props.entry.id).then(() => {
        syncStoreWithLib(favaLib)
      })
    }
  }

  const handleStartRename = (event: MouseEvent) => {
    event.stopPropagation()
    setMenuOpen(false)
    setRenameIssuer(props.entry.issuer)
    setRenameName(props.entry.name)
    setRenameMode(true)
  }

  const handleRenameSave = (event: MouseEvent) => {
    event.stopPropagation()
    const issuer = renameIssuer().trim()
    const name = renameName().trim()
    if (!issuer && !name) return

    void favaLib.vault
      .updateEntry(props.entry.id, { issuer, name })
      .then(() => {
        syncStoreWithLib(favaLib)
        setRenameMode(false)
      })
  }

  const handleRenameCancel = (event: MouseEvent) => {
    event.stopPropagation()
    setRenameMode(false)
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
        <Show
          when={!renameMode()}
          fallback={
            <div on:click={(e) => e.stopPropagation()}>
              <div class="flex flex-col gap-2">
                <input
                  type="text"
                  value={renameIssuer()}
                  onInput={(e) => setRenameIssuer(e.currentTarget.value)}
                  placeholder="Issuer"
                  class="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                />
                <input
                  type="text"
                  value={renameName()}
                  onInput={(e) => setRenameName(e.currentTarget.value)}
                  placeholder="Name"
                  class="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                />
                <div class="flex gap-2">
                  <button
                    on:click={handleRenameSave}
                    class="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    on:click={handleRenameCancel}
                    class="bg-gray-300 text-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-400 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          }
        >
          <div class="flex justify-between items-center">
            <span class="font-medium break-words max-w-[calc(100%-160px)]">
              {props.entry.issuer}
            </span>
            <div class="flex items-center">
              <span class="font-mono text-lg mr-3">{displayOtp()}</span>
              <div class="relative">
                <button
                  on:click={handleKebabClick}
                  class="p-1 rounded hover:bg-gray-200 transition-colors z-10"
                  title="More options"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5 text-gray-600"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <circle cx="10" cy="4" r="1.5" />
                    <circle cx="10" cy="10" r="1.5" />
                    <circle cx="10" cy="16" r="1.5" />
                  </svg>
                </button>
                <Show when={menuOpen()}>
                  <div class="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-20 min-w-[120px]">
                    <button
                      on:click={handleStartRename}
                      class="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 transition-colors"
                    >
                      Rename
                    </button>
                    <button
                      on:click={handleMenuDelete}
                      class="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </Show>
              </div>
            </div>
          </div>
          <span class="text-sm text-gray-600 break-words">
            {props.entry.name}
          </span>
        </Show>
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
        <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div class="bg-green-500 text-white px-3 py-1 rounded text-sm shadow-md">
            {copyStatus()}
          </div>
        </div>
      )}
    </li>
  )
}

export default EntryComponent
