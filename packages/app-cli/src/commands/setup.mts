import keytar from 'keytar'
import { Option } from 'clipanion'
import { confirm, input, password as passwordInput } from '@inquirer/prompts'

import {
  DeviceType,
  FavaLibEvent,
  getFavaLibVaultCreationUtils,
  Password,
} from 'favalib'
import type {
  DeviceFriendlyName,
  PasswordStrength,
  ServerSecret,
} from 'favalib'
import NodePlatformProvider from 'favalib/platformProviders/node'

import BaseCommand from '../BaseCommand.mjs'
import CliError from '../CliError.mjs'
import createVaultSaveFunction from '../utils/vaultSaveFunction.mjs'
import { readServerSecret } from '../utils/syncConfig.mjs'

// A guided flow asks again rather than throwing, but not forever: a
// non-interactive stdin would otherwise spin here instead of failing.
const MAX_PASSWORD_ATTEMPTS = 5

// @inquirer/prompts rejects with this when the user hits Ctrl-C. It is not
// exported as a class to instanceof against, so match on the name.
const isCancellation = (err: unknown) =>
  err instanceof Error && err.name === 'ExitPromptError'

class SetupCommand extends BaseCommand {
  static override paths = [['setup']]

  // setup creates the vault itself, so BaseCommand must not try to load one --
  // there is nothing to load, and loadVault would ask the keychain for a
  // password that has not been stored yet.
  requireFavaLib = false

  // Deliberately NOT requiresSyncConnection: whether this command talks to a
  // server depends on answers it has not been given yet, and a true here makes
  // `--no-sync` throw for a run that may never touch one. BaseCommand's
  // teardown keys off this.favaLib, which exec() assigns once it exists.

  static usage = BaseCommand.Usage({
    category: 'General',
    description: 'Set up favacli: create a vault and, optionally, sync',
    details: `
      Walks through first-time setup in one go: creates an encrypted vault,
      then offers to connect it to a sync server and to import an existing
      vault from another device.

      Every step is also available on its own -- this command runs
      "vault create", "sync setServerUrl" and "sync connect" in the order they
      have to happen, and stops wherever you say no. Answering no to sync
      leaves a working local vault; you can run the sync commands later.

      Refuses to run when a vault already exists, so it can never replace one
      that holds entries. Use "vault delete" first if you mean to start over.

      Importing an existing vault needs a connection string from the device
      that already has it -- in the browser app, the Add Device screen. Both
      devices must be pointed at the same sync server.

      The sync server secret is never taken from the command line. Supply
      --secret-file to read it from a file; otherwise FAVACLI_SYNC_SERVER_SECRET
      or FAVACLI_SYNC_SERVER_SECRET_FILE is used, and failing those you are
      prompted for it.
    `,
    examples: [
      ['Set up favacli', 'setup'],
      [
        'Set up, reading the sync secret from a file',
        'setup --secret-file /run/secrets/fava-sync',
      ],
    ],
  })

  secretFile = Option.String('--secret-file', {
    description:
      'Read the sync server secret from this file (one trailing newline is removed).',
  })

  /**
   * Asks for a password twice and checks it is strong enough to create a vault
   * with, asking again rather than throwing when it is not.
   *
   * The strength check is here rather than left to createNewFavaLibVault --
   * which refuses a score below 3 -- so a retry does not first pay for argon2
   * at the v2 cost, and so the user sees zxcvbn's own advice about what is
   * wrong with the password they chose.
   * @param getPasswordStrength - favalib's strength check for this vault.
   * @returns The accepted password.
   */
  private async promptForPassword(
    getPasswordStrength: (password: Password) => Promise<PasswordStrength>,
  ): Promise<Password> {
    for (let attempt = 1; attempt <= MAX_PASSWORD_ATTEMPTS; attempt++) {
      const password = (await passwordInput({
        message: 'Choose a vault password:',
        mask: '*',
      })) as Password

      const repeated = (await passwordInput({
        message: 'Repeat your vault password:',
        mask: '*',
      })) as Password

      if (password !== repeated) {
        this.output("Passwords don't match. Try again.\n")
        continue
      }

      const { score, feedback } = await getPasswordStrength(password)
      if (score >= 3) {
        return password
      }

      this.output('That password is too weak to protect a vault.\n')
      if (feedback.warning) {
        this.output(`  ${feedback.warning}\n`)
      }
      for (const suggestion of feedback.suggestions) {
        this.output(`  ${suggestion}\n`)
      }
    }

    throw new CliError(
      `No usable password after ${MAX_PASSWORD_ATTEMPTS} attempts. Nothing was created.`,
    )
  }

  /**
   * Asks for the sync server and its secret, and stores them in the vault.
   * @returns Whether a server was configured.
   */
  private async configureSyncServer(): Promise<boolean> {
    const serverUrl = (
      await input({
        message: 'Sync server address:',
        default: process.env.FAVACLI_SYNC_SERVER_URL,
      })
    ).trim()

    if (!serverUrl) {
      throw new CliError('A server address is required to set up sync.')
    }

    // Same precedence as `sync setServerUrl`, and for the same reason: a
    // secret passed as an argument is visible in process listings and shell
    // history, so there is no option for the value itself.
    const secret =
      (await readServerSecret({ secretFile: this.secretFile })) ??
      ((await passwordInput({
        message: 'Sync server secret:',
        mask: '*',
      })) as ServerSecret)

    if (!secret) {
      throw new CliError('A server secret is required')
    }

    // No `force`. setSyncServerUrl only resolves once the server has accepted
    // the secret, so a wrong one stops the flow here with favalib's own
    // message, rather than storing settings that will never work.
    await this.favaLib.setSyncServerUrl(serverUrl, secret)
    this.output(`Connected to ${serverUrl}.\n`)
    return true
  }

  /**
   * Runs the responder half of the pairing flow, importing the vault held by
   * another device.
   * @returns Whether a vault was imported.
   */
  private async importExistingVault(): Promise<boolean> {
    if (!this.favaLib.sync) {
      // Not a CliError: setSyncServerUrl resolved, so a missing sync manager
      // here is a bug in this command's ordering, and the stack is the point.
      throw new Error('No server url set')
    }

    const friendlyName = (
      await input({
        message: 'Name for this device (optional):',
      })
    ).trim()

    if (friendlyName) {
      await this.favaLib.setDeviceFriendlyName(
        friendlyName as DeviceFriendlyName,
      )
    }

    const connectionString = (
      await input({
        message: 'Connection string from the other device:',
      })
    ).trim()

    if (!connectionString) {
      throw new CliError('A connection string is required to import a vault.')
    }

    // Registered before responding: the import can finish before the call
    // below settles, and a listener added afterwards would miss the event.
    const connectFinished = new Promise<void>((resolve) => {
      this.favaLib.addEventListener(
        FavaLibEvent.ConnectToExistingVaultFinished,
        () => {
          resolve()
        },
      )
    })

    this.output('Pairing with the other device...\n')
    await this.favaLib.sync.respondToAddDeviceFlow(connectionString, 'text')
    await connectFinished

    this.output('Vault imported.\n')
    return true
  }

  async exec() {
    if (this.lockedRepresentationString) {
      throw new CliError(
        `A vault already exists at "${this.settings.vaultLocation}", and setup ` +
          `will not replace it. To configure sync on it, run ` +
          `"favacli sync setServerUrl <url>" and then "favacli sync connect". ` +
          `To start over, delete it first with "favacli vault delete".`,
      )
    }

    const favaLibVaultCreationUtils = getFavaLibVaultCreationUtils(
      NodePlatformProvider,
      'cli' as DeviceType,
      ['cli'],
      createVaultSaveFunction(this.settings.vaultLocation),
    )

    let syncServerConfigured = false
    let vaultImported = false

    try {
      const password = await this.promptForPassword(
        favaLibVaultCreationUtils.getPasswordStrength,
      )

      const { favaLib } =
        await favaLibVaultCreationUtils.createNewFavaLibVault(password)

      // Saved and stored in the keychain right away, unlike the browser, which
      // holds the new vault back until pairing completes. Stopping at any
      // prompt below should leave a vault that the individual commands can
      // pick up, not a process that exits having written nothing.
      await Promise.all([
        favaLib.storage.forceSave(),
        keytar.setPassword('favacli', 'vault-password', password),
      ])

      // From here on BaseCommand owns the teardown: flushing the send queue
      // and closing the socket, without which the process would not exit.
      this.favaLib = favaLib
      this.output(`Vault created at ${this.settings.vaultLocation}.\n`)

      const wantsSync = await confirm({
        message: 'Connect this vault to a sync server?',
        default: true,
      })

      if (wantsSync) {
        syncServerConfigured = await this.configureSyncServer()

        const wantsImport = await confirm({
          message: 'Import an existing vault from another device?',
          default: false,
        })

        if (wantsImport) {
          vaultImported = await this.importExistingVault()
        }
      }
    } catch (err) {
      if (!isCancellation(err)) {
        throw err
      }
      this.output('\nSetup cancelled.\n')
      this.reportNextSteps(syncServerConfigured, vaultImported)
      return {
        success: false,
        cancelled: true,
        vaultCreated: Boolean(this.favaLib),
        syncServerConfigured,
        vaultImported,
      }
    }

    this.output('Setup complete.\n')
    this.reportNextSteps(syncServerConfigured, vaultImported)

    return {
      success: true,
      cancelled: false,
      vaultCreated: true,
      syncServerConfigured,
      vaultImported,
    }
  }

  /**
   * Names the commands that carry on from wherever this run stopped.
   * @param syncServerConfigured - Whether a sync server was set.
   * @param vaultImported - Whether a vault was imported from another device.
   */
  private reportNextSteps(
    syncServerConfigured: boolean,
    vaultImported: boolean,
  ) {
    if (!this.favaLib) {
      return
    }
    if (!syncServerConfigured) {
      this.output(
        'To set up sync later: favacli sync setServerUrl <url>\n' +
          'To add entries: favacli entries add --name <name> --secret <secret>\n',
      )
      return
    }
    if (!vaultImported) {
      this.output(
        'To import a vault from another device later: favacli sync connect\n',
      )
    }
  }
}

export default SetupCommand
