import fs from 'node:fs/promises'

import type { SaveFunction } from 'favalib'

/**
 * Builds the save function every command that writes a vault should use.
 *
 * The write goes to a temporary file first and is moved into place with a
 * rename, so a process that dies mid-write leaves the previous vault intact
 * rather than a half-written one -- an encrypted vault truncated in the middle
 * does not decrypt, and there is no partial recovery from one.
 *
 * A copy of the previous vault is kept alongside it as `.backup`. Note that
 * this means the backup holds the same secrets as the vault itself, which is
 * why `vault delete` removes it too.
 * @param vaultLocation - Path of the vault file to write.
 * @returns A SaveFunction writing to that path.
 */
const createVaultSaveFunction =
  (vaultLocation: string): SaveFunction =>
  async (newLockedRepresentationString) => {
    const tempFile = `${vaultLocation}.tmp`
    const backupFile = `${vaultLocation}.backup`
    try {
      // Write to temporary file first, so we don't have to worry about partial writes
      await fs.writeFile(tempFile, newLockedRepresentationString)

      // Create backup of existing vault if it exists
      try {
        await fs.copyFile(vaultLocation, backupFile)
      } catch (err) {
        // If the error is not because the original file doesn't exist yet, throw it
        if (err instanceof Error && 'code' in err && err.code !== 'ENOENT')
          throw err
      }

      // Atomically rename temp file to target file
      await fs.rename(tempFile, vaultLocation)
    } catch (error) {
      // Clean up temp file if something went wrong
      await fs.unlink(tempFile).catch((err) => {
        console.error('Failed to clean up temp file:', err)
      })
      throw error
    }
  }

export default createVaultSaveFunction
