import { Cli } from 'clipanion'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FavaLibEvent } from 'favalib'
import type { AddDeviceFlowResult, DeviceId } from 'favalib'

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  loadVault: vi.fn(),
  pairingQr: vi.fn(),
}))
vi.mock('../src/utils/init.mjs', () => ({
  default: mocks.init,
  saveSettings: vi.fn(),
}))
vi.mock('../src/utils/loadVault.mjs', () => ({ default: mocks.loadVault }))
vi.mock('../src/utils/pairingQr.mjs', () => ({ pairingQr: mocks.pairingQr }))

import AddDeviceCommand from '../src/commands/sync/addDevice.mjs'

const device = {
  deviceId: 'receiver' as DeviceId,
  deviceFriendlyName: 'phone',
  fingerprint: 'test-fingerprint',
  acknowledged: true,
}

describe('sync add-device', () => {
  let events: EventTarget
  let stdout: string
  let stderr: string
  let signalListeners: number
  let sync: ReturnType<typeof makeSync>
  let favaLib: {
    sync: typeof sync | null
    addEventListener: ReturnType<typeof vi.fn>
    removeEventListener: ReturnType<typeof vi.fn>
  }

  const makeSync = () => ({
    webSocketConnected: true,
    inAddDeviceFlow: false,
    initiateAddDeviceFlow: vi.fn(() => {
      sync.inAddDeviceFlow = true
      return Promise.resolve({ text: 'connection-code', qr: null })
    }),
    getSyncDevices: vi.fn(() => [device]),
    flushCommandSendQueue: vi.fn().mockResolvedValue(true),
    closeServerConnection: vi.fn(() => {
      sync.webSocketConnected = false
    }),
    cancelAddSyncDevice: vi.fn(() => {
      sync.inAddDeviceFlow = false
    }),
    diagnoseConnectionFailure: vi
      .fn()
      .mockResolvedValue('Server refused the secret'),
  })

  beforeEach(() => {
    vi.resetAllMocks()
    for (const name of [
      'FAVACLI_SYNC_SERVER_URL',
      'FAVACLI_SYNC_SERVER_SECRET',
      'FAVACLI_SYNC_SERVER_SECRET_FILE',
    ])
      vi.stubEnv(name, undefined)
    events = new EventTarget()
    sync = makeSync()
    favaLib = {
      sync,
      addEventListener: vi.fn(events.addEventListener.bind(events)),
      removeEventListener: vi.fn(events.removeEventListener.bind(events)),
    }
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault',
      settings: {
        vaultLocation: '/unused',
        syncIntervalMinutes: 5,
        lastSyncedAt: Date.now(),
      },
    })
    mocks.loadVault.mockResolvedValue(favaLib)
    mocks.pairingQr.mockResolvedValue({ text: 'QR-IMAGE', columns: 100 })
    stdout = ''
    stderr = ''
    signalListeners = process.listenerCount('SIGINT')
  })

  afterEach(() => {
    expect(process.listenerCount('SIGINT')).toBe(signalListeners)
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  const run = (...args: string[]) => {
    const cli = new Cli()
    cli.register(AddDeviceCommand)
    const command = cli.process(['sync', 'add-device', ...args])
    command.context = {
      stdout: {
        columns: 80,
        write: (chunk: string) => {
          stdout += chunk
          return true
        },
      },
      stderr: {
        write: (chunk: string) => {
          stderr += chunk
          return true
        },
      },
    } as unknown as typeof command.context
    return command.execute()
  }

  const finish = (
    result: AddDeviceFlowResult = {
      status: 'completed',
      deviceId: device.deviceId,
    },
  ) => {
    sync.inAddDeviceFlow = false
    events.dispatchEvent(
      new CustomEvent(FavaLibEvent.AddDeviceFlowFinished, { detail: result }),
    )
  }

  it('displays text and QR before completion, then flushes and closes', async () => {
    const running = run()
    await vi.waitUntil(() => stdout.includes('QR-IMAGE'))
    expect(stdout).toContain('connection-code')
    expect(stdout).toContain('100 terminal columns')
    expect(sync.closeServerConnection).not.toHaveBeenCalled()
    expect(sync.flushCommandSendQueue).not.toHaveBeenCalled()
    finish()
    expect(await running).toBe(0)
    expect(stdout).toContain('test-fingerprint')
    expect(sync.flushCommandSendQueue.mock.invocationCallOrder[0]).toBeLessThan(
      sync.closeServerConnection.mock.invocationCallOrder[0],
    )
    expect(favaLib.removeEventListener).toHaveBeenCalledTimes(2)
    expect(mocks.loadVault).toHaveBeenCalledWith(
      'vault',
      expect.anything(),
      expect.any(Function),
      { connectToSyncServer: true, syncServer: undefined },
    )
  })

  it('keeps final JSON on stdout and displays codes immediately on stderr', async () => {
    const running = run('--format', 'json')
    await vi.waitUntil(() => stderr.includes('QR-IMAGE'))
    expect(stderr).toContain('connection-code')
    expect(stdout).toBe('')
    finish()
    expect(await running).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({
      result: { success: true, device },
    })
    expect(stdout).not.toContain('connection-code')
  })

  it('can omit QR and tolerates completion before initiation returns', async () => {
    sync.initiateAddDeviceFlow.mockImplementation(() => {
      finish()
      return Promise.resolve({ text: 'connection-code', qr: null })
    })
    expect(await run('--no-qr')).toBe(0)
    expect(mocks.pairingQr).not.toHaveBeenCalled()
  })

  it('keeps the text code usable if QR rendering fails', async () => {
    mocks.pairingQr.mockRejectedValue(new Error('QR unavailable'))
    const running = run()
    await vi.waitUntil(() => stdout.includes('Could not render'))
    expect(stdout).toContain('connection-code')
    finish()
    expect(await running).toBe(0)
  })

  it('times out, cancels the active flow, and releases its resources', async () => {
    vi.useFakeTimers()
    const running = run('--timeout', '1', '--format', 'json')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await running).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({
      result: {
        success: false,
        status: 'failed',
        reason: expect.stringContaining('timed out') as unknown,
      },
    })
    expect(sync.cancelAddSyncDevice).toHaveBeenCalledOnce()
    expect(sync.closeServerConnection).toHaveBeenCalled()
    expect(favaLib.removeEventListener).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a pending registration with Ctrl-C and never prints a late code', async () => {
    let resolve!: (value: { text: string; qr: null }) => void
    sync.initiateAddDeviceFlow.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const running = run()
    await vi.waitUntil(() => sync.initiateAddDeviceFlow.mock.calls.length > 0)
    process.emit('SIGINT')
    expect(await running).toBe(130)
    expect(sync.closeServerConnection).toHaveBeenCalled()
    resolve({ text: 'late-code', qr: null })
    await Promise.resolve()
    expect(stdout).not.toContain('late-code')
  })

  it.each(['cancelled', 'failed'] as const)(
    'reports a library %s outcome as failure',
    async (status) => {
      const running = run('--no-qr')
      await vi.waitUntil(() => stdout.includes('connection-code'))
      finish({ status, reason: 'Pairing could not continue' })
      expect(await running).toBe(1)
      expect(stdout).toContain('Pairing could not continue')
    },
  )

  it('fails on disconnect and registration errors', async () => {
    const running = run('--no-qr')
    await vi.waitUntil(() => stdout.includes('connection-code'))
    sync.webSocketConnected = false
    events.dispatchEvent(
      new Event(FavaLibEvent.ConnectionToSyncServerStatusChanged),
    )
    expect(await running).toBe(1)
    expect(stdout).toContain('Connection lost')
  })

  it('cleans up if registration rejects', async () => {
    sync.initiateAddDeviceFlow.mockRejectedValue(
      new Error('registration failed'),
    )
    expect(await run()).toBe(1)
    expect(stdout).toContain('registration failed')
    expect(favaLib.removeEventListener).toHaveBeenCalledTimes(2)
  })

  it('refuses missing configuration, failed authentication and no-sync before pairing', async () => {
    await expect(run('--no-sync')).rejects.toThrow('--no-sync cannot be used')
    sync.webSocketConnected = false
    await expect(run()).rejects.toThrow('Server refused the secret')
    expect(sync.closeServerConnection).toHaveBeenCalled()
    favaLib.sync = null
    await expect(run()).rejects.toThrow('needs a sync server')
    expect(sync.initiateAddDeviceFlow).not.toHaveBeenCalled()
  })

  it.each(['0', '-1', '1.5', 'Infinity', '2147484'])(
    'rejects invalid timeout %s',
    async (value) => {
      await expect(run(`--timeout=${value}`)).rejects.toThrow(
        '--timeout must be a positive integer',
      )
      expect(sync.initiateAddDeviceFlow).not.toHaveBeenCalled()
    },
  )
})
