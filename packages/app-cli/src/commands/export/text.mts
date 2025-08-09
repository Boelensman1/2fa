import fs from 'node:fs/promises'

import { Option } from 'clipanion'
import * as t from 'typanion'
import keytar from 'keytar'

import BaseCommand from '../../BaseCommand.mjs'
import { password as passwordInput, input } from '@inquirer/prompts'

class ExportTextCommand extends BaseCommand {
  static override paths = [['export', 'text']]

  requireFavaLib = true

  pathOption = Option.String('--path', {
    description: 'File path for the export, if not set will output to stdout',
  })

  passwordSource = Option.String('--password-source', {
    description: 'Source of password, either "stdin" or "stored"',
    validator: t.isEnum(['stdin', 'stored']),
  })

  static usage = BaseCommand.Usage({
    category: 'Export',
    description: 'Export 2FA entries as plain text',
    details: `
      This command exports your 2FA entries as a plain text file.

      You can specify a file path for the export using the --path flag.

      You can specify the password source with --password-source flag:
      - "stdin": You'll be prompted to enter a password
      - "stored": Will use the previously stored password, if none is found, will be promted for a password

      If no password source is specified, it will export without encryption (no password).

      WARNING: Exporting your 2FA secrets in plain text (without password) is not secure.
    `,
    examples: [
      ['Export entries as unencrypted text (UNSECURE)', 'export text'],
      ['Export to specific file', 'export text --path=/path/to/export.txt'],
      ['Export using stored password', 'export text --password-source=stored'],
      [
        'Export with manual password entry',
        'export text --password-source=stdin',
      ],
    ],
  })

  async exec() {
    const entriesCount = this.favaLib.vault.listEntries().length

    // Get password based on source
    let password: string | undefined | null = undefined

    // If password source is "stored", try to get from keytar without prompting
    if (this.passwordSource === 'stored') {
      try {
        password = await keytar.getPassword('favacli', 'export-password')
        if (!password) {
          this.context.stderr.write(
            'No stored password found. Please enter a password to store.\n',
          )
          password = await passwordInput({
            message: 'Enter password to store and use for encryption:',
          })

          // Store the password for future use
          await keytar.setPassword('favacli', 'export-password', password)
          this.context.stdout.write('Password stored.\n')
        }
      } catch (error) {
        if (error instanceof Error) {
          this.context.stderr.write(
            `Failed to access stored password: ${error.message}}\n`,
          )
        } else {
          this.context.stderr.write(
            `Failed to access stored password: Unknown error\n`,
          )
        }
        return { success: false }
      }
    }
    // Default behavior or explicit "stdin"
    else if (this.passwordSource === 'stdin') {
      password = await passwordInput({
        message: 'Enter password to use for encryption:',
      })
    }
    // Add warning and confirmation if no password is provided
    else if (!this.passwordSource) {
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

    const content = await this.favaLib.exportImport.exportEntries(
      'text',
      password,
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
