import { type Component, createSignal, Show } from 'solid-js'
import Add from './Add'
import ItemList from './ItemList'
import Importer from './Importer'
import Settings from './Settings'

const AppAuthenticated: Component = () => {
  const [showAdd, setShowAdd] = createSignal(false)
  const [showImporter, setShowImporter] = createSignal(false)
  const [showSettings, setShowSettings] = createSignal(false)

  return (
    <div class="container mx-auto p-4">
      <ItemList />

      <div class="mt-4 space-x-4">
        <button
          onClick={() => setShowAdd(!showAdd())}
          class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          {showAdd() ? 'Hide Add' : 'Show Add'}
        </button>
        <button
          onClick={() => setShowImporter(!showImporter())}
          class="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          {showImporter() ? 'Hide Importer' : 'Show Importer'}
        </button>
        <button
          onClick={() => setShowSettings(!showSettings())}
          class="bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          {showSettings() ? 'Hide Settings' : 'Show Settings'}
        </button>
      </div>

      <Show when={showAdd()}>
        <Add />
      </Show>

      <Show when={showImporter()}>
        <Importer />
      </Show>

      <Show when={showSettings()}>
        <Settings />
      </Show>
    </div>
  )
}

export default AppAuthenticated
