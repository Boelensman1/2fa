import { describe, it, expect, vi } from 'vitest'
import type FavaLibMediator from '../../../src/FavaLibMediator.mjs'
import ChangeDeviceInfoCommand from '../../../src/Command/commands/ChangeDeviceInfoCommand.mjs'
import { InvalidCommandError } from '../../../src/FavaLibError.mjs'
import type {
  DeviceId,
  DeviceType,
  DeviceFriendlyName,
  DeviceInfo,
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

  const mockSyncDevices: { deviceId: DeviceId; deviceInfo: DeviceInfo }[] = [
    {
      deviceId: mockDeviceId,
      deviceInfo: {
        deviceType: mockDeviceType,
        deviceFriendlyName: 'Old Device Name' as DeviceFriendlyName,
      },
    },
  ]

  const mockSyncManager = {
    syncDevices: mockSyncDevices,
    // Stands in for SyncManager.setDeviceInfo, which also announces the
    // change with a Changed event; here only the write and the
    // found/not-found answer are of interest.
    setDeviceInfo: (deviceId: DeviceId, deviceInfo: DeviceInfo) => {
      const device = mockSyncDevices.find((d) => d.deviceId === deviceId)
      if (!device) return false
      device.deviceInfo = deviceInfo
      return true
    },
  }

  const mockPersistentStorageManager = {
    save: vi.fn(),
  }

  const mockFavaLibMediator = {
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
  } as unknown as FavaLibMediator

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
    await command.execute(mockFavaLibMediator)
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
        deviceFriendlyName: 'Old Remote Name' as DeviceFriendlyName,
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
      // The verified sender, and the device being renamed: a peer renames
      // itself or nothing.
      remoteDeviceId,
    )

    await command.execute(mockFavaLibMediator)
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

    await expect(command.execute(mockFavaLibMediator)).rejects.toThrow(
      InvalidCommandError,
    )
  })

  it('should validate command data correctly', () => {
    // Valid command
    const validCommand = new ChangeDeviceInfoCommand(commandData)
    expect(validCommand.validate(mockFavaLibMediator)).toBe(true)

    // Invalid command - different device type
    const invalidDeviceTypeCommand = new ChangeDeviceInfoCommand({
      deviceId: mockDeviceId,
      newDeviceInfo: {
        deviceType: 'different-type' as DeviceType,
        deviceFriendlyName: mockNewFriendlyName,
      },
    })
    expect(invalidDeviceTypeCommand.validate(mockFavaLibMediator)).toBe(false)

    // Invalid command - empty friendly name
    const emptyFriendlyNameCommand = new ChangeDeviceInfoCommand({
      deviceId: mockDeviceId,
      newDeviceInfo: {
        deviceType: mockDeviceType,
        deviceFriendlyName: '' as DeviceFriendlyName,
      },
    })
    expect(emptyFriendlyNameCommand.validate(mockFavaLibMediator)).toBe(false)

    // Invalid command - too long friendly name
    const longFriendlyNameCommand = new ChangeDeviceInfoCommand({
      deviceId: mockDeviceId,
      newDeviceInfo: {
        deviceType: mockDeviceType,
        deviceFriendlyName: 'a'.repeat(257) as DeviceFriendlyName,
      },
    })
    expect(longFriendlyNameCommand.validate(mockFavaLibMediator)).toBe(false)
  })

  it('should throw an error when executing with invalid data', async () => {
    const invalidCommand = new ChangeDeviceInfoCommand({
      deviceId: mockDeviceId,
      newDeviceInfo: {
        deviceType: 'different-type' as DeviceType,
        deviceFriendlyName: mockNewFriendlyName,
      },
    })

    await expect(invalidCommand.execute(mockFavaLibMediator)).rejects.toThrow(
      InvalidCommandError,
    )
  })

  // A remote rename used to be waved through entirely -- "we can only validate
  // this command locally" -- so any peer could rename any device to anything of
  // any length. The friendly name is what a user reads when deciding whether a
  // device belongs, so a peer able to write someone else's name can dress its
  // own device as the user's phone.
  const remoteRename = (
    deviceId: DeviceId,
    fromDeviceId: DeviceId | undefined,
    deviceFriendlyName = mockNewFriendlyName,
  ) =>
    new ChangeDeviceInfoCommand(
      {
        deviceId,
        newDeviceInfo: { deviceType: mockDeviceType, deviceFriendlyName },
      },
      undefined,
      undefined,
      undefined,
      true,
      fromDeviceId,
    )

  it('lets a remote peer rename itself', () => {
    const peer = 'some-peer' as DeviceId
    expect(remoteRename(peer, peer).validate(mockFavaLibMediator)).toBe(true)
  })

  it('refuses a remote peer renaming another device', () => {
    expect(
      remoteRename('victim' as DeviceId, 'attacker' as DeviceId).validate(
        mockFavaLibMediator,
      ),
    ).toBe(false)
  })

  it('refuses a remote peer renaming this device', () => {
    // The one the old code made reachable: execute() writes straight into
    // favaMeta when the target is this device.
    expect(
      remoteRename(mockDeviceId, 'attacker' as DeviceId).validate(
        mockFavaLibMediator,
      ),
    ).toBe(false)
  })

  it('refuses a remote rename with no verified sender', () => {
    const peer = 'some-peer' as DeviceId
    expect(remoteRename(peer, undefined).validate(mockFavaLibMediator)).toBe(
      false,
    )
  })

  it('bounds the friendly name on the remote path too', () => {
    const peer = 'some-peer' as DeviceId
    expect(
      remoteRename(peer, peer, 'x'.repeat(257) as DeviceFriendlyName).validate(
        mockFavaLibMediator,
      ),
    ).toBe(false)
    expect(
      remoteRename(peer, peer, '' as DeviceFriendlyName).validate(
        mockFavaLibMediator,
      ),
    ).toBe(false)
  })
})
