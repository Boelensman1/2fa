import fs from 'node:fs/promises'
import { Option } from 'clipanion'
import { password as passwordInput } from '@inquirer/prompts'

import BaseCommand from '../../BaseCommand.mjs'
import CliError from '../../CliError.mjs'

class ImportTextCommand extends BaseCommand {
  static override paths = [['import', 'text']]

  requireFavaLib = true
  override mutatesVault = true

  pathOption = Option.String('--path', {
    required: true,
    description: 'Text export to import into the current vault.',
  })
  passwordFile = Option.String('--password-file', {
    description: 'Read the export password from a UTF-8 file.',
  })

  static usage = BaseCommand.Usage({
    category: 'Import',
    description:
      'Import entries from a text export, including encrypted exports',
    details: `
      Adds entries to your existing vault. Accepts otpauth:// text exports and
      password-protected OpenPGP exports. Encrypted files prompt for a password
      unless --password-file is supplied. Import passwords are not stored.

      Valid lines are imported even if other lines fail. Failed lines are
      reported with their file line numbers and produce a nonzero exit status.
      Repeated imports add entries again; they do not replace existing entries.
    `,
    examples: [
      [
        'Import an export (prompting if encrypted)',
        'import text --path backup.txt',
      ],
      [
        'Import without prompting',
        'import text --path backup.asc --password-file /run/secrets/export-password',
      ],
      [
        'Import locally without syncing',
        'import text --path backup.txt --no-sync',
      ],
    ],
  })

  private async readFile(file: string, description: string) {
    try {
      return await fs.readFile(file, 'utf8')
    } catch {
      throw new CliError(`Could not read ${description} at "${file}".`)
    }
  }

  async exec() {
    const contents = await this.readFile(this.pathOption, 'the import file')
    const encrypted = contents
      .trimStart()
      .startsWith('-----BEGIN PGP MESSAGE-----')
    let password: string | undefined

    if (this.passwordFile !== undefined && !encrypted) {
      throw new CliError(
        '--password-file requires a password-encrypted OpenPGP export.',
      )
    }
    if (encrypted) {
      if (this.passwordFile !== undefined) {
        password = (
          await this.readFile(this.passwordFile, 'the password file')
        ).replace(/\r?\n$/, '')
      } else {
        if (
          !('isTTY' in this.context.stdin) ||
          this.context.stdin.isTTY !== true
        ) {
          throw new CliError(
            'This export is encrypted. Use --password-file when importing without an interactive terminal.',
          )
        }
        try {
          password = await passwordInput(
            { message: 'Export password:', mask: '*' },
            { input: this.context.stdin, output: this.context.stderr },
          )
        } catch (err) {
          if (err instanceof Error && err.name === 'ExitPromptError') {
            this.exitCode = 130
            return { success: false, cancelled: true }
          }
          throw err
        }
      }
      if (!password)
        throw new CliError('The export password must not be empty.')
    }

    let importedLines
    try {
      importedLines = await this.favaLib.exportImport.importFromTextFile(
        encrypted ? contents.trimStart() : contents,
        password,
      )
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown import error'
      throw new CliError(`Could not import the file: ${message}`)
    }

    const results = importedLines.map(({ lineNr, entryId, error }) => ({
      lineNr: lineNr + 1,
      entryId,
      error:
        error == null
          ? null
          : error instanceof Error
            ? error.message
            : 'Invalid entry',
    }))
    const imported = results.filter(({ entryId }) => entryId !== null).length
    const failed = results.length - imported
    this.exitCode = failed > 0 ? 1 : 0
    this.output(
      `Imported ${String(imported)} entries; ${String(failed)} lines failed.\n`,
    )
    if (!this.machineOutput) {
      for (const result of results) {
        if (result.error)
          this.context.stderr.write(
            `Line ${String(result.lineNr)}: ${result.error}\n`,
          )
      }
    }
    return { success: failed === 0, imported, failed, results }
  }
}

export default ImportTextCommand
