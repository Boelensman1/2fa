import { createSignal, createEffect, For } from 'solid-js'
import useStore from '../store/useStore'
import { PublicSyncDevice, TwoFaLibEvent } from 'favalib'

const ListSyncDevices = () => {
  const [state] = useStore()
  const [devices, setDevices] = createSignal<PublicSyncDevice[]>([])

  createEffect(() => {
    const { twoFaLib } = state
    if (twoFaLib) {
      const updateDevices = () => {
        const currentDevices = twoFaLib.sync?.getSyncDevices()
        setDevices(currentDevices ?? [])
      }

      twoFaLib.addEventListener(TwoFaLibEvent.Changed, updateDevices)
      updateDevices() // Initial load

      return () => {
        twoFaLib.removeEventListener(TwoFaLibEvent.Changed, updateDevices)
      }
    }
  })

  return (
    <div>
      <h2 class="text-xl font-semibold mb-2">Connected Devices</h2>
      <ul>
        <For each={devices()}>
          {(device) => (
            <li>
              {device.deviceId} {device.deviceType} {device.deviceFriendlyName}
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}

export default ListSyncDevices
