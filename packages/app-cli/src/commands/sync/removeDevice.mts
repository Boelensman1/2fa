import { Option } from 'clipanion'
import { select, confirm } from '@inquirer/prompts'
import type { DeviceId } from 'favalib'

import BaseCommand from '../../BaseCommand.mjs'

class RemoveDeviceCommand extends BaseCommand {
  static override paths = [['sync', 'remove-device']]
  override requiresSyncConnection = true
  requireFavaLib = true

  static usage = BaseCommand.Usage({
    category: 'Sync',
    description: 'Remove a device from the vault sync set',
    details: `Removes a synced device from your vault. The removal is synced to all other
      connected devices. Pass --device-id to skip the interactive picker.`,
    examples: [
      ['Pick a device to remove interactively', 'sync remove-device'],
      ['Remove a specific device', 'sync remove-device --device-id <id>'],
    ],
  })

  deviceId = Option.String('--device-id', { required: false })
  force = Option.Boolean('--force', {
    description: 'Remove without confirmation',
  })

  async exec() {
    if (!this.favaLib.sync) {
      throw new Error('No server url set')
    }

    const devices = this.favaLib.sync.getSyncDevices()
    if (devices.length === 0) {
      this.output('No devices to remove.\n')
      return { success: false }
    }

    // Resolve target device
    let targetId: DeviceId
    if (this.deviceId) {
      const match = devices.find((d) => d.deviceId === this.deviceId)
      if (!match) {
        throw new Error(`No synced device found with id: ${this.deviceId}`)
      }
      targetId = match.deviceId
    } else {
      targetId = await select({
        message: 'Select a device to remove:',
        choices: devices.map((d) => ({
          name: `${d.deviceFriendlyName ?? '(no name)'} (${d.deviceType ?? 'unknown'}) — ${d.deviceId}`,
          value: d.deviceId,
        })),
      })
    }

    // Confirmation (skippable with --force)
    const target = devices.find((d) => d.deviceId === targetId)
    const label = target?.deviceFriendlyName ?? targetId
    if (!this.force) {
      const ok = await confirm({
        message: `Remove "${label}"? This will sync to all devices.`,
        default: false,
      })
      if (!ok) {
        this.output('Device removal cancelled.\n')
        return { success: false, cancelled: true }
      }
    }

    await this.favaLib.removeSyncDevice(targetId)

    this.output(`Removed device: ${label}\n`)
    return { success: true }
  }
}

export default RemoveDeviceCommand
