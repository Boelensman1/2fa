import { describe, it, expect, vi } from 'vitest'
import type TwoFaLibMediator from '../../../src/TwoFaLibMediator.mjs'
import ChangeDeviceInfoCommand from '../../../src/Command/commands/ChangeDeviceInfoCommand.mjs'
import { InvalidCommandError } from '../../../src/TwoFALibError.mjs'
import type {
  DeviceId,
  DeviceType,
  DeviceFriendlyName,
} from '../../../src/interfaces/SyncTypes.mjs'

describe('ChangeDeviceInfoCommand', () => {
  const mockDeviceId = 'test-device' as DeviceId
  const mockDeviceType = 'test-type' as DeviceType
  const mockNewFriendlyName = 'New Device Name' as DeviceFriendlyName

  const mockLib = {
    meta: {
      deviceId: mockDeviceId,
      deviceType: mockDeviceType,
    },
    favaMeta: {
      deviceFriendlyName: 'Old Device Name',
    },
  }

  const mockSyncManager = {
    syncDevices: [
      {
        deviceId: mockDeviceId,
        deviceInfo: {
          deviceType: mockDeviceType,
          deviceFriendlyName: 'Old Device Name',
        },
      },
    ],
  }

  const mockPersistentStorageManager = {
    save: vi.fn(),
  }

  const mockTwoFaLibMediator = {
    getComponent: (component: string) => {
      switch (component) {
        case 'lib':
          return mockLib
        case 'syncManager':
          return mockSyncManager
        case 'persistentStorageManager':
          return mockPersistentStorageManager
        default:
          return undefined
      }
    },
  } as unknown as TwoFaLibMediator

  const commandData = {
    deviceId: mockDeviceId,
    newDeviceInfo: {
      deviceType: mockDeviceType,
      deviceFriendlyName: mockNewFriendlyName,
    },
  }

  it('should create a ChangeDeviceInfoCommand instance', () => {
    const command = new ChangeDeviceInfoCommand(commandData)
    expect(command).toBeInstanceOf(ChangeDeviceInfoCommand)
    expect(command.type).toBe('ChangeDeviceInfo')
    expect(command.data).toEqual(commandData)
  })

  it('should execute the command for local device', async () => {
    const command = new ChangeDeviceInfoCommand(commandData)
    await command.execute(mockTwoFaLibMediator)
    expect(mockLib.favaMeta.deviceFriendlyName).toBe(mockNewFriendlyName)
    expect(mockSyncManager.syncDevices[0].deviceInfo.deviceFriendlyName).toBe(
      mockNewFriendlyName,
    )
    expect(mockPersistentStorageManager.save).toHaveBeenCalled()
  })

  it('should execute the command for remote device', async () => {
    const remoteDeviceId = 'remote-device' as DeviceId
    mockSyncManager.syncDevices.push({
      deviceId: remoteDeviceId,
      deviceInfo: {
        deviceType: mockDeviceType,
        deviceFriendlyName: 'Old Remote Name',
      },
    })

    const command = new ChangeDeviceInfoCommand(
      {
        deviceId: remoteDeviceId,
        newDeviceInfo: {
          deviceType: mockDeviceType,
          deviceFriendlyName: 'New Remote Name' as DeviceFriendlyName,
        },
      },
      'remote-command-id',
      Date.now(),
      '1',
      true,
    )

    await command.execute(mockTwoFaLibMediator)
    expect(mockSyncManager.syncDevices[1].deviceInfo.deviceFriendlyName).toBe(
      'New Remote Name',
    )
    expect(mockPersistentStorageManager.save).toHaveBeenCalled()
  })

  it('should throw an error when device is not found', async () => {
    const command = new ChangeDeviceInfoCommand(
      {
        deviceId: 'non-existent' as DeviceId,
        newDeviceInfo: {
          deviceType: mockDeviceType,
          deviceFriendlyName: mockNewFriendlyName,
        },
      },
      'remote-command-id',
      Date.now(),
      '1',
      true,
    )

    await expect(command.execute(mockTwoFaLibMediator)).rejects.toThrow(
      InvalidCommandError,
    )
  })

  it('should validate command data correctly', () => {
    // Valid command
    const validCommand = new ChangeDeviceInfoCommand(commandData)
    expect(validCommand.validate(mockTwoFaLibMediator)).toBe(true)

    // Invalid command - different device type
    const invalidDeviceTypeCommand = new ChangeDeviceInfoCommand({
      deviceId: mockDeviceId,
      newDeviceInfo: {
        deviceType: 'different-type' as DeviceType,
        deviceFriendlyName: mockNewFriendlyName,
      },
    })
    expect(invalidDeviceTypeCommand.validate(mockTwoFaLibMediator)).toBe(false)

    // Invalid command - empty friendly name
    const emptyFriendlyNameCommand = new ChangeDeviceInfoCommand({
      deviceId: mockDeviceId,
      newDeviceInfo: {
        deviceType: mockDeviceType,
        deviceFriendlyName: '' as DeviceFriendlyName,
      },
    })
    expect(emptyFriendlyNameCommand.validate(mockTwoFaLibMediator)).toBe(false)

    // Invalid command - too long friendly name
    const longFriendlyNameCommand = new ChangeDeviceInfoCommand({
      deviceId: mockDeviceId,
      newDeviceInfo: {
        deviceType: mockDeviceType,
        deviceFriendlyName: 'a'.repeat(257) as DeviceFriendlyName,
      },
    })
    expect(longFriendlyNameCommand.validate(mockTwoFaLibMediator)).toBe(false)
  })

  it('should throw an error when executing with invalid data', async () => {
    const invalidCommand = new ChangeDeviceInfoCommand({
      deviceId: mockDeviceId,
      newDeviceInfo: {
        deviceType: 'different-type' as DeviceType,
        deviceFriendlyName: mockNewFriendlyName,
      },
    })

    await expect(invalidCommand.execute(mockTwoFaLibMediator)).rejects.toThrow(
      InvalidCommandError,
    )
  })

  it('should always validate remote commands', () => {
    const command = new ChangeDeviceInfoCommand(
      commandData,
      undefined,
      undefined,
      undefined,
      true,
    )
    expect(command.validate(mockTwoFaLibMediator)).toBe(true)
  })
})
