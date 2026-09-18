import { type Component, createSignal, onCleanup, Show } from 'solid-js'
import useStore from '../store/useStore'
import useSyncStoreWithLib from '../utils/useSyncStoreWithLib'

interface ImportFile {
  name: string
  contents: string
  encrypted: boolean
}

const Importer: Component = () => {
  const [state] = useStore()
  const syncStoreWithLib = useSyncStoreWithLib()
  const [isDragging, setIsDragging] = createSignal(false)
  const [pendingFile, setPendingFile] = createSignal<ImportFile | null>(null)
  const [password, setPassword] = createSignal('')
  const [busy, setBusy] = createSignal<'reading' | 'importing' | null>(null)
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [resultMessage, setResultMessage] = createSignal<string | null>(null)
  let disposed = false

  const clearFile = () => {
    setPendingFile(null)
    setPassword('')
  }

  onCleanup(() => {
    disposed = true
    clearFile()
  })

  const importFile = async (file: ImportFile, exportPassword?: string) => {
    const { favaLib } = state
    if (!favaLib) return

    setBusy('importing')
    setErrorMessage(null)
    setResultMessage(null)
    try {
      const results = await favaLib.exportImport.importFromTextFile(
        file.contents,
        exportPassword,
      )
      if (disposed) return

      const imported = results.filter(
        (result) => result.entryId !== null,
      ).length
      const failed = results.length - imported
      clearFile()
      if (results.length === 0) {
        setResultMessage('No entries found.')
      } else if (imported === 0) {
        setErrorMessage(
          `No entries imported. Failed: ${failed}. Choose a Fava text export.`,
        )
      } else {
        setResultMessage(`Imported: ${imported}. Failed: ${failed}.`)
      }
    } catch {
      if (disposed) return
      setErrorMessage(
        file.encrypted
          ? 'Could not import the file. Check the export password and that the file is a valid encrypted text export.'
          : 'Could not import the file. Check that it is a valid text export and try again.',
      )
    } finally {
      // A save failure can occur after some entries were added. Reflect the
      // library's actual state, including when the panel closed during import.
      if (state.favaLib === favaLib) syncStoreWithLib(favaLib)
      if (!disposed) {
        setPassword('')
        setBusy(null)
      }
    }
  }

  const selectFiles = async (files: FileList | undefined | null) => {
    if (busy() || !files?.length) return

    clearFile()
    setErrorMessage(null)
    setResultMessage(null)
    if (files.length !== 1) {
      setErrorMessage('Please choose one file at a time.')
      return
    }

    const file = files[0]
    setBusy('reading')
    let contents: string
    try {
      contents = (await file.text()).trimStart()
    } catch {
      if (!disposed) {
        setErrorMessage('Could not read the file. Please select it again.')
        setBusy(null)
      }
      return
    }
    // Closing the panel while reading must not start an import afterwards.
    if (disposed) return

    const selected = {
      name: file.name,
      contents,
      encrypted: contents.startsWith('-----BEGIN PGP MESSAGE-----'),
    }
    setPendingFile(selected)
    if (selected.encrypted) {
      setBusy(null)
    } else {
      await importFile(selected)
    }
  }

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault()
    const file = pendingFile()
    if (busy() || !file || (file.encrypted && !password())) return
    void importFile(file, file.encrypted ? password() : undefined)
  }

  const handleCancel = () => {
    if (busy()) return
    clearFile()
    setErrorMessage(null)
    setResultMessage(null)
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    if (!busy()) setIsDragging(true)
  }

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    setIsDragging(false)
    void selectFiles(event.dataTransfer?.files)
  }

  return (
    <section class="mt-4" aria-labelledby="import-heading" aria-busy={!!busy()}>
      <h2 id="import-heading" class="text-xl font-semibold mb-2">
        Import items
      </h2>
      <p id="import-help" class="text-sm text-gray-600 mb-4">
        Choose or drop a Fava text export (.txt) or password-protected text
        export (.txt.pgp). Plain text files import immediately. HTML exports and
        vault files are not supported.
      </p>
      <div
        class={`border-2 border-dashed p-8 text-center ${
          isDragging() ? 'border-blue-500 bg-blue-100' : 'border-gray-300'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <p class="mb-4">
          {isDragging() ? 'Drop the file here' : 'Drag and drop a file here'}
        </p>
        <label class="block text-sm font-medium text-gray-700">
          Choose file
          <input
            type="file"
            aria-describedby="import-help"
            disabled={!!busy()}
            onChange={(event) => {
              void selectFiles(event.currentTarget.files)
              // Allow selecting the same file again after success or failure.
              event.currentTarget.value = ''
            }}
            class="block mx-auto mt-2 max-w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-blue-500 file:text-white disabled:opacity-50"
          />
        </label>
      </div>

      <Show when={pendingFile()}>
        {(file) => (
          <form onSubmit={handleSubmit} class="mt-4">
            <p class="text-sm text-gray-700 mb-2 break-words">
              Selected file: {file().name}
            </p>
            <Show when={file().encrypted}>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                Export password
                <input
                  type="password"
                  value={password()}
                  onInput={(event) => setPassword(event.currentTarget.value)}
                  autocomplete="off"
                  aria-describedby="import-password-help"
                  disabled={!!busy()}
                  required
                  class="block mt-1 w-full max-w-md px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <p id="import-password-help" class="text-sm text-gray-600 mb-4">
                Enter the password used when exporting this file.
              </p>
            </Show>
            <div class="flex gap-2">
              <button
                type="submit"
                disabled={!!busy() || (file().encrypted && !password())}
                class="bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Import
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={!!busy()}
                class="bg-gray-200 text-gray-800 py-2 px-4 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </Show>
      <p role="status" class="text-sm text-gray-700 mt-2">
        {busy() === 'reading'
          ? 'Reading file…'
          : busy() === 'importing'
            ? 'Importing…'
            : resultMessage()}
      </p>
      <Show when={errorMessage()}>
        <p role="alert" class="text-red-600 mt-2">
          {errorMessage()}
        </p>
      </Show>
    </section>
  )
}

export default Importer
