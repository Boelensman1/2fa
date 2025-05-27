import { createSignal } from 'solid-js'
import useStore from '../store/useStore'
import useSyncStoreWithLib from '../utils/useSyncStoreWithLib'

const Importer = () => {
  const [state] = useStore()
  const syncStoreWithLib = useSyncStoreWithLib()
  const [isDragging, setIsDragging] = createSignal(false)

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const { twoFaLib } = state
    if (!twoFaLib) {
      throw new Error('twoFaLib not loaded')
    }

    const file = e.dataTransfer?.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        const fileContents = reader.result?.toString()
        if (fileContents) {
          void twoFaLib.exportImport
            .importFromTextFile(fileContents)
            .then((results) => {
              results.forEach((result) => {
                if (result.error) {
                  console.warn(
                    `Failed to import line ${result.lineNr}`,
                    result.error,
                  )
                }
              })
              syncStoreWithLib(twoFaLib)
            })
        }
      }
      reader.readAsText(file)
    }
  }

  return (
    <div class="mt-4">
      <h2 class="text-xl font-semibold mb-2">Import items</h2>
      <div
        class={`border-2 border-dashed p-8 text-center ${
          isDragging() ? 'border-blue-500 bg-blue-100' : 'border-gray-300'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <p>
          {isDragging() ? 'Drop the file here' : 'Drag and drop a file here'}
        </p>
      </div>
    </div>
  )
}

export default Importer
