import { type Component } from 'solid-js'
import useStore from '../store/useStore'
import actions from '../store/actions'

const Settings: Component = () => {
  const [state, dispatch] = useStore()

  const toggleMaskEntries = () => {
    dispatch(actions.setSettings({ maskEntries: !state.settings.maskEntries }))
  }

  return (
    <div class="mt-4">
      <h2 class="text-xl font-semibold mb-2">Settings</h2>
      <div class="flex items-center">
        <input
          type="checkbox"
          id="maskEntries"
          checked={state.settings.maskEntries}
          onChange={toggleMaskEntries}
          class="mr-2"
        />
        <label for="maskEntries">Mask TOTP tokens</label>
      </div>
    </div>
  )
}

export default Settings
