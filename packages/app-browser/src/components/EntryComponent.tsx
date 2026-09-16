import {
  Accessor,
  createMemo,
  createResource,
  createSignal,
  For,
  Index,
  onCleanup,
  Show,
} from 'solid-js'
import {
  MAX_INPUT_SELECTOR_LENGTH,
  MAX_MATCHER_VALUE_LENGTH,
  MAX_MATCHERS_PER_ENTRY,
  MAX_URL_LENGTH,
  URL_MATCHER_TYPES,
  validateUrlMatcher,
} from 'favalib'
import useStore from '../store/useStore'
import useSyncStoreWithLib from '../utils/useSyncStoreWithLib'
import type { EntryMeta, EntryId, UrlMatcher, UrlMatcherType } from 'favalib'

const EntryComponent = (props: {
  entry: EntryMeta
  currentTime: Accessor<number>
}) => {
  const [state] = useStore()
  const syncStoreWithLib = useSyncStoreWithLib()
  const favaLib = state.favaLib!
  const [copyStatus, setCopyStatus] = createSignal('')
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [editMode, setEditMode] = createSignal(false)
  const [editIssuer, setEditIssuer] = createSignal('')
  const [editName, setEditName] = createSignal('')
  const [editUrl, setEditUrl] = createSignal('')
  const [editMatchers, setEditMatchers] = createSignal<UrlMatcher[]>([])
  const [editInputSelector, setEditInputSelector] = createSignal('')
  const [editError, setEditError] = createSignal<string | null>(null)
  const [qrCode, setQrCode] = createSignal('')

  const closeMenu = () => setMenuOpen(false)
  const onDocumentClick = () => closeMenu()
  document.addEventListener('click', onDocumentClick)
  onCleanup(() => document.removeEventListener('click', onDocumentClick))

  const generateTOTP = async (entryId: EntryId, timestamp: number) => {
    try {
      const { otp, validFrom, validTill } =
        await favaLib.vault.generateTokenForEntry(entryId, timestamp)
      const totalTime = validTill - validFrom
      const remainingTime = validTill - timestamp
      const progress = (remainingTime / totalTime) * 100
      return { otp, progress }
    } catch (error) {
      console.error('Error generating TOTP:', error)
      return { otp: 'Invalid', progress: 0 }
    }
  }

  const [totpData] = createResource(
    // Re-evaluate whenever the entry or the current time changes
    () => ({ id: props.entry.id, timestamp: props.currentTime() }),
    ({ id, timestamp }) => generateTOTP(id, timestamp),
  )
  const displayOtp = createMemo(() => {
    const otp = totpData()?.otp ?? ''
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

  const handleShare = (event: MouseEvent) => {
    event.stopPropagation()
    setMenuOpen(false)

    void favaLib.exportImport
      .generateQrCodeForEntry(props.entry.id)
      .then((qrDataUrl) => {
        setQrCode(qrDataUrl)
      })
      .catch((err) => {
        console.error('Failed to generate QR code:', err)
      })
  }

  const handleCloseQr = (event: MouseEvent) => {
    event.stopPropagation()
    setQrCode('')
  }

  const handleStartEdit = (event: MouseEvent) => {
    event.stopPropagation()
    setMenuOpen(false)
    setEditIssuer(props.entry.issuer)
    setEditName(props.entry.name)
    setEditUrl(props.entry.url ?? '')
    setEditMatchers(props.entry.matchers.map((matcher) => ({ ...matcher })))
    setEditInputSelector(props.entry.inputSelector ?? '')
    setEditError(null)
    setEditMode(true)
  }

  const updateMatcher = (index: number, patch: Partial<UrlMatcher>) => {
    setEditMatchers((matchers) =>
      matchers.map((matcher, i) =>
        i === index ? { ...matcher, ...patch } : matcher,
      ),
    )
  }

  const addMatcher = (event: MouseEvent) => {
    event.stopPropagation()
    setEditMatchers((matchers) => [
      ...matchers,
      { type: 'BaseDomain', value: '' },
    ])
  }

  const removeMatcher = (event: MouseEvent, index: number) => {
    event.stopPropagation()
    setEditMatchers((matchers) => matchers.filter((_, i) => i !== index))
  }

  const handleEditSave = (event: MouseEvent) => {
    event.stopPropagation()
    const issuer = editIssuer().trim()
    const name = editName().trim()
    if (!issuer && !name) {
      setEditError('An entry needs an issuer or a name')
      return
    }

    // Drop the blank rows the "Add matcher" button leaves behind, then hold
    // the rest to exactly the rules the lib enforces.
    const matchers = editMatchers()
      .map((matcher) => ({ ...matcher, value: matcher.value.trim() }))
      .filter((matcher) => matcher.value.length > 0)

    for (const matcher of matchers) {
      const reason = validateUrlMatcher(matcher)
      if (reason) {
        setEditError(reason)
        return
      }
    }

    const url = editUrl().trim()
    const inputSelector = editInputSelector().trim()

    void favaLib.vault
      .updateEntry(props.entry.id, {
        issuer,
        name,
        matchers,
        url: url.length > 0 ? url : null,
        inputSelector: inputSelector.length > 0 ? inputSelector : null,
      })
      .then(() => {
        syncStoreWithLib(favaLib)
        setEditError(null)
        setEditMode(false)
      })
      .catch((err: unknown) => {
        setEditError(err instanceof Error ? err.message : 'Could not save')
      })
  }

  const handleEditCancel = (event: MouseEvent) => {
    event.stopPropagation()
    setEditError(null)
    setEditMode(false)
  }

  const copyToClipboard = () => {
    const otp = totpData()?.otp
    if (!otp) return
    navigator.clipboard
      .writeText(otp)
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
          when={!editMode()}
          fallback={
            <div on:click={(e) => e.stopPropagation()}>
              <div class="flex flex-col gap-2">
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-semibold text-gray-600">
                    Issuer
                  </span>
                  <input
                    type="text"
                    value={editIssuer()}
                    onInput={(e) => setEditIssuer(e.currentTarget.value)}
                    placeholder="GitHub"
                    class="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                  />
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-semibold text-gray-600">Name</span>
                  <input
                    type="text"
                    value={editName()}
                    onInput={(e) => setEditName(e.currentTarget.value)}
                    placeholder="you@example.com"
                    class="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                  />
                </label>
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-semibold text-gray-600">
                    Website url
                  </span>
                  <input
                    type="text"
                    value={editUrl()}
                    onInput={(e) => setEditUrl(e.currentTarget.value)}
                    placeholder="https://github.com/login"
                    maxlength={MAX_URL_LENGTH}
                    class="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                  />
                  <span class="text-xs text-gray-500">
                    Shown to you only, never used to decide where this entry
                    fits.
                  </span>
                </label>
                <div class="flex flex-col gap-1">
                  <span class="text-xs font-semibold text-gray-600">
                    Site matchers
                  </span>
                  <Index
                    each={editMatchers()}
                    fallback={
                      <span class="text-xs text-gray-500">
                        No matchers, so this entry is never offered on a site.
                      </span>
                    }
                  >
                    {(matcher, index) => (
                      <div class="flex gap-1">
                        <select
                          value={matcher().type}
                          onChange={(e) =>
                            updateMatcher(index, {
                              type: e.currentTarget.value as UrlMatcherType,
                            })
                          }
                          class="border border-gray-300 rounded px-1 py-1 text-xs"
                        >
                          <For each={URL_MATCHER_TYPES}>
                            {(type) => <option value={type}>{type}</option>}
                          </For>
                        </select>
                        <input
                          type="text"
                          value={matcher().value}
                          onInput={(e) =>
                            updateMatcher(index, {
                              value: e.currentTarget.value,
                            })
                          }
                          placeholder="github.com"
                          maxlength={MAX_MATCHER_VALUE_LENGTH}
                          class="border border-gray-300 rounded px-2 py-1 text-xs flex-1 min-w-0"
                        />
                        <button
                          on:click={(e) => removeMatcher(e, index)}
                          class="px-2 py-1 text-xs text-red-600 hover:bg-gray-200 rounded"
                          title="Remove this matcher"
                        >
                          &times;
                        </button>
                      </div>
                    )}
                  </Index>
                  <button
                    on:click={addMatcher}
                    disabled={editMatchers().length >= MAX_MATCHERS_PER_ENTRY}
                    class="self-start px-2 py-1 text-xs text-blue-600 hover:bg-gray-200 rounded disabled:text-gray-400 disabled:hover:bg-transparent"
                  >
                    Add matcher
                  </button>
                </div>
                <label class="flex flex-col gap-1">
                  <span class="text-xs font-semibold text-gray-600">
                    One-time-code input
                  </span>
                  <input
                    type="text"
                    value={editInputSelector()}
                    onInput={(e) => setEditInputSelector(e.currentTarget.value)}
                    placeholder="input#otp-code"
                    maxlength={MAX_INPUT_SELECTOR_LENGTH}
                    class="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                  />
                  <span class="text-xs text-gray-500">
                    A css selector overriding the extension's guess at the code
                    field.
                  </span>
                </label>
                <Show when={editError()}>
                  <span class="text-xs text-red-600">{editError()}</span>
                </Show>
                <div class="flex gap-2">
                  <button
                    on:click={handleEditSave}
                    class="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    on:click={handleEditCancel}
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
                      on:click={handleStartEdit}
                      class="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      on:click={handleShare}
                      class="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 transition-colors"
                    >
                      Share
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
            width: `${totpData()?.progress ?? 0}%`,
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
      <Show when={qrCode()}>
        <div
          class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          on:click={handleCloseQr}
        >
          <div
            class="bg-white rounded-lg p-6 flex flex-col items-center gap-4 max-w-[90vw]"
            on:click={(e) => e.stopPropagation()}
          >
            <div class="flex flex-col items-center text-center">
              <span class="font-medium break-words">{props.entry.issuer}</span>
              <span class="text-sm text-gray-600 break-words">
                {props.entry.name}
              </span>
            </div>
            <img
              src={qrCode()}
              alt={`QR code for ${props.entry.issuer}`}
              class="w-64 h-64"
            />
            <button
              on:click={handleCloseQr}
              class="bg-gray-300 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-400 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </Show>
    </li>
  )
}

export default EntryComponent
