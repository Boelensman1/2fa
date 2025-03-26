import fs from 'node:fs/promises'

import { Option } from 'clipanion'
import * as t from 'typanion'
import keytar from 'keytar'

import BaseCommand from '../../BaseCommand.mjs'
import { password, input } from '@inquirer/prompts'

class ExportTextCommand extends BaseCommand {
  static override paths = [['export', 'text']]

  requireTwoFaLib = true

  pathOption = Option.String('--path', {
    description: 'File path for the export, if not set will output to stdout',
  })

  passphraseSource = Option.String('--passphrase-source', {
    description: 'Source of passphrase, either "stdin" or "stored"',
    validator: t.isEnum(['stdin', 'stored']),
  })

  static usage = BaseCommand.Usage({
    category: 'Export',
    description: 'Export 2FA entries as plain text',
    details: `
      This command exports your 2FA entries as a plain text file.

      You can specify a file path for the export using the --path flag.

      You can specify the passphrase source with --passphrase-source flag:
      - "stdin": You'll be prompted to enter a passphrase
      - "stored": Will use the previously stored passphrase, if none is found, will be promted for a passphrase

      If no passphrase source is specified, it will export without encryption (no passphrase).

      WARNING: Exporting your 2FA secrets in plain text (without passphrase) is not secure.
    `,
    examples: [
      ['Export entries as unencrypted text (UNSECURE)', 'export text'],
      ['Export to specific file', 'export text --path=/path/to/export.txt'],
      [
        'Export using stored passphrase',
        'export text --passphrase-source=stored',
      ],
      [
        'Export with manual passphrase entry',
        'export text --passphrase-source=stdin',
      ],
    ],
  })

  async exec() {
    const entriesCount = this.twoFaLib.vault.listEntries().length

    // Get passphrase based on source
    let passphrase: string | undefined | null = undefined

    // If passphrase source is "stored", try to get from keytar without prompting
    if (this.passphraseSource === 'stored') {
      try {
        passphrase = await keytar.getPassword('favacli', 'export-passphrase')
        if (!passphrase) {
          this.context.stderr.write(
            'No stored passphrase found. Please enter a passphrase to store.\n',
          )
          passphrase = await password({
            message: 'Enter passphrase to store and use for encryption:',
          })

          // Store the passphrase for future use
          await keytar.setPassword('favacli', 'export-passphrase', passphrase)
          this.context.stdout.write('Passphrase stored.\n')
        }
      } catch (error) {
        if (error instanceof Error) {
          this.context.stderr.write(
            `Failed to access stored passphrase: ${error.message}}\n`,
          )
        } else {
          this.context.stderr.write(
            `Failed to access stored passphrase: Unknown error\n`,
          )
        }
        return { success: false }
      }
    }
    // Default behavior or explicit "stdin"
    else if (this.passphraseSource === 'stdin') {
      passphrase = await password({
        message: 'Enter passphrase to use for encryption:',
      })
    }
    // Add warning and confirmation if no passphrase is provided
    else if (!this.passphraseSource) {
      this.context.stderr.write(
        'WARNING: You are about to export 2FA secrets in plain text without encryption.\n',
      )
      this.context.stderr.write(
        'This is NOT SECURE and could expose your 2FA secrets if the file is accessed by others.\n',
      )

      const confirm = await input({
        message:
          'Type "unsecure" to acknowldge you understand the risks and to proceed with unencrypted export:',
      })

      if (confirm !== 'unsecure') {
        this.context.stderr.write('Export cancelled.\n')
        return { success: false }
      }
    }

    const content = await this.twoFaLib.exportImport.exportEntries(
      'text',
      passphrase,
      true,
    )

    if (this.pathOption) {
      try {
        await fs.writeFile(this.pathOption, content)
        this.context.stdout.write(
          `Successfully exported ${entriesCount} entries to ${this.pathOption}\n`,
        )
        return { success: true }
      } catch (error) {
        if (error instanceof Error) {
          this.context.stderr.write(`Failed to export: ${error.message}\n`)
        } else {
          this.context.stderr.write('Failed to export: Unknown error\n')
        }
        return { success: false }
      }
    } else {
      this.context.stdout.write(content)
      return { success: true }
    }
  }
}

export default ExportTextCommand
