import { For, createSignal, onCleanup, createMemo } from 'solid-js'
import useStore from '../store/useStore'
import EntryComponent from './EntryComponent'

const ItemList = () => {
  const [state] = useStore()
  const [currentTime, setCurrentTime] = createSignal(Date.now())
  const [searchTerm, setSearchTerm] = createSignal('')

  // Update the current time every second
  const timer = setInterval(() => setCurrentTime(Date.now()), 1000)

  // Clean up the interval when the component is unmounted
  onCleanup(() => clearInterval(timer))

  const filteredEntries = createMemo(() => {
    if (!searchTerm()) return state.entries
    return state.twoFaLib!.searchEntriesMetas(searchTerm())
  })

  return (
    <div class="mt-4">
      <h2 class="text-xl font-semibold mb-2">Added Items</h2>
      <input
        type="text"
        placeholder="Search items..."
        value={searchTerm()}
        onInput={(e) => setSearchTerm(e.currentTarget.value)}
        class="w-full p-2 mb-4 border rounded"
      />
      <ul class="space-y-2">
        <For each={filteredEntries()}>
          {(entry) => (
            <EntryComponent entry={entry} currentTime={currentTime} />
          )}
        </For>
      </ul>
    </div>
  )
}

export default ItemList
