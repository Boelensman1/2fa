import { WebSocket } from 'ws'
import type { DeviceId } from '2falib'

/**
 * Manages the connected devices and their corresponding WebSocket connections.
 */
class ConnectedDevicesManager {
  private deviceToWs = new Map<DeviceId, WebSocket>()
  private wsToDevice = new WeakMap<WebSocket, DeviceId>()

  /**
   * @returns The number of connected devices.
   */
  get size() {
    return this.deviceToWs.size
  }

  /**
   * Adds a device and its WebSocket connection.
   * Removes any existing connection for the device before adding the new one.
   * @param deviceId - The identifier of the device.
   * @param ws - The WebSocket connection of the device.
   */
  public addDevice(deviceId: DeviceId, ws: WebSocket) {
    // Remove existing connection if any
    this.removeDevice(deviceId)

    this.deviceToWs.set(deviceId, ws)
    this.wsToDevice.set(ws, deviceId)
  }

  /**
   * Removes a device and its WebSocket connection.
   * @param deviceId - The identifier of the device to remove.
   */
  public removeDevice(deviceId: DeviceId) {
    const ws = this.deviceToWs.get(deviceId)
    if (ws) {
      this.deviceToWs.delete(deviceId)
      this.wsToDevice.delete(ws)
    }
  }

  /**
   * Removes a device based on its WebSocket connection.
   * @param ws - The WebSocket connection of the device to remove.
   */
  public removeDeviceByWs(ws: WebSocket) {
    const deviceId = this.wsToDevice.get(ws)
    if (deviceId) {
      this.deviceToWs.delete(deviceId)
      this.wsToDevice.delete(ws)
    }
  }

  /**
   * Retrieves the WebSocket connection for a given device ID.
   * @param deviceId - The identifier of the device.
   * @returns The WebSocket connection if found, otherwise undefined.
   */
  public getWs(deviceId: DeviceId): WebSocket | undefined {
    return this.deviceToWs.get(deviceId)
  }

  /**
   * Retrieves the device ID associated with a given WebSocket connection.
   * @param ws - The WebSocket connection of the device.
   * @returns The device ID if found, otherwise undefined.
   */
  public getDeviceId(ws: WebSocket): DeviceId | undefined {
    return this.wsToDevice.get(ws)
  }
}

export default ConnectedDevicesManager
