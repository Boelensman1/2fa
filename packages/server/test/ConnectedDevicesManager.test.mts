import { describe, it, expect, beforeEach } from 'vitest'
import { WebSocket } from 'ws'
import ConnectedDevicesManager from '../src/ConnectedDevicesManager.mjs'
import type { DeviceId } from 'favalib'

describe('ConnectedDevicesManager', () => {
  let manager: ConnectedDevicesManager
  let mockWs1: WebSocket
  let mockWs2: WebSocket
  const deviceId1 = 'device-1' as DeviceId
  const deviceId2 = 'device-2' as DeviceId

  beforeEach(() => {
    manager = new ConnectedDevicesManager()
    mockWs1 = {} as WebSocket
    mockWs2 = {} as WebSocket
  })

  describe('addDevice', () => {
    it('should add a device and its WebSocket connection', () => {
      manager.addDevice(deviceId1, mockWs1)

      expect(manager.size).toBe(1)
      expect(manager.getWs(deviceId1)).toBe(mockWs1)
      expect(manager.getDeviceId(mockWs1)).toBe(deviceId1)
    })

    it('should replace existing connection when adding device with same ID', () => {
      manager.addDevice(deviceId1, mockWs1)
      manager.addDevice(deviceId1, mockWs2)

      expect(manager.size).toBe(1)
      expect(manager.getWs(deviceId1)).toBe(mockWs2)
      expect(manager.getDeviceId(mockWs2)).toBe(deviceId1)
      expect(manager.getDeviceId(mockWs1)).toBeUndefined()
    })

    it('should handle multiple devices', () => {
      manager.addDevice(deviceId1, mockWs1)
      manager.addDevice(deviceId2, mockWs2)

      expect(manager.size).toBe(2)
      expect(manager.getWs(deviceId1)).toBe(mockWs1)
      expect(manager.getWs(deviceId2)).toBe(mockWs2)
      expect(manager.getDeviceId(mockWs1)).toBe(deviceId1)
      expect(manager.getDeviceId(mockWs2)).toBe(deviceId2)
    })
  })

  describe('removeDevice', () => {
    it('should remove device by device ID', () => {
      manager.addDevice(deviceId1, mockWs1)
      manager.removeDevice(deviceId1)

      expect(manager.size).toBe(0)
      expect(manager.getWs(deviceId1)).toBeUndefined()
      expect(manager.getDeviceId(mockWs1)).toBeUndefined()
    })

    it('should handle removal of non-existent device', () => {
      manager.removeDevice(deviceId1)

      expect(manager.size).toBe(0)
    })

    it('should only remove specified device when multiple exist', () => {
      manager.addDevice(deviceId1, mockWs1)
      manager.addDevice(deviceId2, mockWs2)
      manager.removeDevice(deviceId1)

      expect(manager.size).toBe(1)
      expect(manager.getWs(deviceId1)).toBeUndefined()
      expect(manager.getWs(deviceId2)).toBe(mockWs2)
      expect(manager.getDeviceId(mockWs1)).toBeUndefined()
      expect(manager.getDeviceId(mockWs2)).toBe(deviceId2)
    })
  })

  describe('removeDeviceByWs', () => {
    it('should remove device by WebSocket connection', () => {
      manager.addDevice(deviceId1, mockWs1)
      manager.removeDeviceByWs(mockWs1)

      expect(manager.size).toBe(0)
      expect(manager.getWs(deviceId1)).toBeUndefined()
      expect(manager.getDeviceId(mockWs1)).toBeUndefined()
    })

    it('should handle removal of non-existent WebSocket', () => {
      manager.removeDeviceByWs(mockWs1)

      expect(manager.size).toBe(0)
    })

    it('should only remove specified device when multiple exist', () => {
      manager.addDevice(deviceId1, mockWs1)
      manager.addDevice(deviceId2, mockWs2)
      manager.removeDeviceByWs(mockWs1)

      expect(manager.size).toBe(1)
      expect(manager.getWs(deviceId1)).toBeUndefined()
      expect(manager.getWs(deviceId2)).toBe(mockWs2)
      expect(manager.getDeviceId(mockWs1)).toBeUndefined()
      expect(manager.getDeviceId(mockWs2)).toBe(deviceId2)
    })
  })

  describe('getWs', () => {
    it('should return WebSocket for existing device', () => {
      manager.addDevice(deviceId1, mockWs1)

      expect(manager.getWs(deviceId1)).toBe(mockWs1)
    })

    it('should return undefined for non-existent device', () => {
      expect(manager.getWs(deviceId1)).toBeUndefined()
    })
  })

  describe('getDeviceId', () => {
    it('should return device ID for existing WebSocket', () => {
      manager.addDevice(deviceId1, mockWs1)

      expect(manager.getDeviceId(mockWs1)).toBe(deviceId1)
    })

    it('should return undefined for non-existent WebSocket', () => {
      expect(manager.getDeviceId(mockWs1)).toBeUndefined()
    })
  })

  describe('size', () => {
    it('should return 0 for empty manager', () => {
      expect(manager.size).toBe(0)
    })

    it('should return correct size after adding devices', () => {
      manager.addDevice(deviceId1, mockWs1)
      expect(manager.size).toBe(1)

      manager.addDevice(deviceId2, mockWs2)
      expect(manager.size).toBe(2)
    })

    it('should return correct size after removing devices', () => {
      manager.addDevice(deviceId1, mockWs1)
      manager.addDevice(deviceId2, mockWs2)
      expect(manager.size).toBe(2)

      manager.removeDevice(deviceId1)
      expect(manager.size).toBe(1)

      manager.removeDeviceByWs(mockWs2)
      expect(manager.size).toBe(0)
    })
  })

  describe('edge cases', () => {
    it('should handle rapid add/remove operations', () => {
      for (let i = 0; i < 100; i++) {
        const deviceId = `device-${i}` as DeviceId
        const ws = {} as WebSocket
        manager.addDevice(deviceId, ws)
      }
      expect(manager.size).toBe(100)

      for (let i = 0; i < 50; i++) {
        const deviceId = `device-${i}` as DeviceId
        manager.removeDevice(deviceId)
      }
      expect(manager.size).toBe(50)
    })

    it('should maintain consistency after replacing devices', () => {
      manager.addDevice(deviceId1, mockWs1)
      const originalSize = manager.size

      manager.addDevice(deviceId1, mockWs2)

      expect(manager.size).toBe(originalSize)
      expect(manager.getWs(deviceId1)).toBe(mockWs2)
      expect(manager.getDeviceId(mockWs2)).toBe(deviceId1)
      expect(manager.getDeviceId(mockWs1)).toBeUndefined()
    })
  })
})
