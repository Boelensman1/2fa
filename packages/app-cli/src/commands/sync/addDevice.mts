import { Option, UsageError } from 'clipanion'
import { deviceLabel, FavaLibEvent } from 'favalib'
import type { AddDeviceFlowResult } from 'favalib'

import BaseCommand from '../../BaseCommand.mjs'
import { pairingQr } from '../../utils/pairingQr.mjs'

class AddDeviceCommand extends BaseCommand {
  static override paths = [['sync', 'add-device']]
  requireFavaLib = true
  override requiresLiveSyncConnection = true

  timeout = Option.String('--timeout', '300', {
    description: 'Maximum pairing time in seconds (default: 300).',
  })
  noQr = Option.Boolean('--no-qr', false, {
    description: 'Display only the connection string.',
  })

  static usage = BaseCommand.Usage({
    category: 'Sync',
    description: 'Pair another device with this vault as the sender',
    details: `
      Displays a connection string and terminal QR code, then waits for another
      device to join. Both devices must use the same sync server and its secret.
      On the receiving CLI run "sync connect"; in the browser use Connect to
      Existing Vault and paste the text or a QR image.

      Keep this command running until pairing finishes. Ctrl-C cancels pairing.
      --format json reserves stdout for the final result and shows pairing
      instructions on stderr. Completion means the vault was sent and the new
      device enrolled locally, not an acknowledgment of the receiver's import.
    `,
    examples: [
      ['Pair another device', 'sync add-device'],
      [
        'Display text only, waiting up to ten minutes',
        'sync add-device --no-qr --timeout 600',
      ],
    ],
  })

  async exec() {
    const timeoutSeconds = Number(this.timeout)
    if (
      !/^\d+$/.test(this.timeout) ||
      !Number.isSafeInteger(timeoutSeconds) ||
      timeoutSeconds < 1 ||
      timeoutSeconds > 2_147_483
    ) {
      throw new UsageError(
        '--timeout must be a positive integer no greater than 2147483 seconds.',
      )
    }
    const sync = this.favaLib.sync!
    const display = this.machineOutput
      ? this.context.stderr
      : this.context.stdout
    let finished = false
    let settle!: (result: AddDeviceFlowResult) => void
    const done = new Promise<AddDeviceFlowResult>((resolve) => {
      settle = resolve
    })
    const finish = (result: AddDeviceFlowResult) => {
      if (finished) return
      finished = true
      settle(result)
    }
    const onFinished = (ev: CustomEvent<AddDeviceFlowResult>) =>
      finish(ev.detail)
    const onConnectionChanged = () => {
      if (!sync.webSocketConnected)
        finish({
          status: 'failed',
          reason: 'Connection lost during pairing. Run pairing again.',
        })
    }
    const onInterrupt = () => {
      if (finished) return
      this.exitCode = 130
      finish({ status: 'cancelled', reason: 'Pairing cancelled.' })
    }
    this.favaLib.addEventListener(
      FavaLibEvent.AddDeviceFlowFinished,
      onFinished,
    )
    this.favaLib.addEventListener(
      FavaLibEvent.ConnectionToSyncServerStatusChanged,
      onConnectionChanged,
    )
    process.on('SIGINT', onInterrupt)
    const timer = setTimeout(
      () =>
        finish({
          status: 'failed',
          reason:
            'Pairing timed out. Run the command again to generate a new code.',
        }),
      timeoutSeconds * 1000,
    )

    const start = async () => {
      try {
        const { text } = await sync.initiateAddDeviceFlow({
          qr: false,
          text: true,
        })
        if (finished) return
        display.write(
          `On the other device, connect to this vault using this code:\n${text}\n`,
        )
        if (!this.noQr) {
          try {
            const qr = await pairingQr(text)
            if (finished) return
            if (
              'columns' in display &&
              typeof display.columns === 'number' &&
              display.columns < qr.columns
            ) {
              display.write(
                `The QR code needs ${String(qr.columns)} terminal columns. Widen the terminal or use the text code.\n`,
              )
            }
            display.write(`${qr.text}\n`)
          } catch {
            if (!finished)
              display.write(
                'Could not render the QR code. Use the text code above.\n',
              )
          }
        }
        if (!finished)
          display.write(
            'Waiting for the other device; press Ctrl-C to cancel.\n',
          )
      } catch (err) {
        finish({
          status: 'failed',
          reason:
            err instanceof Error ? err.message : 'Could not start pairing.',
        })
      }
    }

    try {
      // start handles its own rejection; cancellation may finish before even
      // the server registration or QR renderer returns.
      void start()
      const result = await done
      if (result.status !== 'completed') {
        if (this.exitCode !== 130) this.exitCode = 1
        this.output(`${result.reason}\n`)
        return { success: false, ...result }
      }
      const device = sync
        .getSyncDevices()
        .find((device) => device.deviceId === result.deviceId)
      this.output(
        device
          ? `Paired with ${deviceLabel(device)}  ${device.fingerprint}\n`
          : 'Device paired.\n',
      )
      return { success: true, ...result, device: device ?? null }
    } finally {
      clearTimeout(timer)
      process.off('SIGINT', onInterrupt)
      this.favaLib.removeEventListener(
        FavaLibEvent.AddDeviceFlowFinished,
        onFinished,
      )
      this.favaLib.removeEventListener(
        FavaLibEvent.ConnectionToSyncServerStatusChanged,
        onConnectionChanged,
      )
      if (this.exitCode !== 0) {
        try {
          if (sync.inAddDeviceFlow && sync.webSocketConnected)
            sync.cancelAddSyncDevice()
        } catch {
          // The socket may have closed between the check and cancellation.
          // Closing it below also removes the server's pairing registration.
        } finally {
          sync.closeServerConnection()
        }
      }
    }
  }
}

export default AddDeviceCommand
