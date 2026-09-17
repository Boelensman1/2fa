import { LIB_VERSION, PAIRING_VERSION, STORAGE_VERSION } from 'favalib'

import BaseCommand from '../BaseCommand.mjs'
import binaryVersion from '../utils/binaryVersion.mjs'

class VersionCommand extends BaseCommand {
  static override paths = [['version']]

  requireFavaLib = false

  // Reports on the binary, so it reads neither the settings nor the vault. See
  // BaseCommand.requiresSettings: a version number is asked for precisely when
  // something else is broken.
  override requiresSettings = false

  static usage = BaseCommand.Usage({
    category: 'General',
    description: 'Show the versions this build of favacli speaks',
    details: `
      Prints favacli's own version and the version of the favalib it was built
      against, followed by the two format versions that decide whether this
      build can talk to something else: the storage version it writes into a
      vault, and the pairing version it will add a device over.

      Reads nothing -- no settings file, no vault -- so it answers on a machine
      where those are missing or broken.
    `,
    examples: [
      ['Show the versions', 'version'],
      ['Show the versions as JSON', 'version --format json'],
    ],
  })

  exec() {
    this.output(`favacli ${binaryVersion}\n`)
    this.output(`favalib ${LIB_VERSION}\n`)
    this.output(`storage version ${STORAGE_VERSION}\n`)
    this.output(`pairing version ${PAIRING_VERSION}\n`)
    this.output(`node ${process.version}\n`)

    return Promise.resolve({
      favacli: binaryVersion,
      favalib: LIB_VERSION,
      storageVersion: STORAGE_VERSION,
      pairingVersion: PAIRING_VERSION,
      node: process.version,
    })
  }
}

export default VersionCommand
