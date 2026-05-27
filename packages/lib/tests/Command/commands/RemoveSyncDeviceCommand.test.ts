import { describe, it, expect, vi } from 'vitest'
import type FavaLibMediator from '../../../src/FavaLibMediator.mjs'
import RemoveSyncDeviceCommand from '../../../src/Command/commands/RemoveSyncDeviceCommand.mjs'
import type { RemoveSyncDeviceData } from '../../../src/Command/commands/RemoveSyncDeviceCommand.mjs'
import {
  InvalidCommandError,
  FavaLibError,
} from '../../../src/FavaLibError.mjs'
import type {
  DeviceId,
  DeviceType,
} from '../../../src/interfaces/SyncTypes.mjs'

describe('RemoveSyncDeviceCommand', () => {
  const mockDeviceId = 'remote-device' as DeviceId
  const mockDeviceType = 'test-type' as DeviceType

  // Builds a fresh mock mediator whose syncManager really removes from its
  // syncDevices array, mirroring SyncManager.removeSyncDevice.
  const makeMediator = () => {
    const syncDevices = [
      {
        deviceId: mockDeviceId,
        deviceInfo: { deviceType: mockDeviceType },
      },
    ]
    const removeSyncDevice = vi.fn((deviceId: DeviceId) => {
      const index = syncDevices.findIndex((d) => d.deviceId === deviceId)
      if (index === -1) {
        return undefined
      }
      const [removed] = syncDevices.splice(index, 1)
      return removed
    })
    const syncManager = { syncDevices, removeSyncDevice }
    const mediator = {
      getComponent: (component: string) =>
        component === 'syncManager' ? syncManager : undefined,
    } as unknown as FavaLibMediator
    return { mediator, syncManager, syncDevices }
  }

  const commandData: RemoveSyncDeviceData = { deviceId: mockDeviceId }

  it('should create a RemoveSyncDeviceCommand instance', () => {
    const command = new RemoveSyncDeviceCommand(commandData)
    expect(command).toBeInstanceOf(RemoveSyncDeviceCommand)
    expect(command.type).toBe('RemoveSyncDevice')
    expect(command.data).toEqual(commandData)
  })

  it('should remove the matching device on execute', async () => {
    const { mediator, syncManager, syncDevices } = makeMediator()
    const command = new RemoveSyncDeviceCommand(commandData)

    await command.execute(mediator)

    expect(syncManager.removeSyncDevice).toHaveBeenCalledWith(mockDeviceId)
    expect(syncDevices.find((d) => d.deviceId === mockDeviceId)).toBeUndefined()
  })

  it('should be idempotent when the device is absent', async () => {
    const { mediator, syncManager } = makeMediator()
    const command = new RemoveSyncDeviceCommand({
      deviceId: 'non-existent' as DeviceId,
    })

    await expect(command.execute(mediator)).resolves.toBeUndefined()
    expect(syncManager.removeSyncDevice).toHaveReturnedWith(undefined)
  })

  it('should throw when executing with invalid data', async () => {
    const { mediator } = makeMediator()
    const invalidCommand = new RemoveSyncDeviceCommand({
      deviceId: undefined,
    } as unknown as RemoveSyncDeviceData)

    await expect(invalidCommand.execute(mediator)).rejects.toThrow(
      InvalidCommandError,
    )
  })

  it('should validate command data correctly', () => {
    expect(new RemoveSyncDeviceCommand(commandData).validate()).toBe(true)
    expect(
      new RemoveSyncDeviceCommand({
        deviceId: undefined,
      } as unknown as RemoveSyncDeviceData).validate(),
    ).toBe(false)
  })

  it('should not support undo', () => {
    const command = new RemoveSyncDeviceCommand(commandData)
    expect(() => command.createUndoCommand()).toThrow(FavaLibError)
  })
})
