import type { OpenPgpLib } from '../../interfaces/OpenPgpLib.mjs'

/**
 * Browser implementation of OpenPGP library wrapper
 */
export class BrowserOpenPgpLib implements OpenPgpLib {
  private openPgpModule: typeof import('openpgp') | null = null

  /**
   * Gets the OpenPGP module, loading it if necessary
   * @returns Promise that resolves to the OpenPGP module
   */
  private async getOpenPgpModule(): Promise<typeof import('openpgp')> {
    if (!this.openPgpModule) {
      this.openPgpModule = await import('openpgp')
      // enable Authenticated Encryption with Associated Data
      this.openPgpModule.config.aeadProtect = true
      // Stretch the export password with Argon2 rather than OpenPGP's default
      // iterated-and-salted S2K, which is a plain SHA-256 loop with no memory
      // hardness at all. The vault itself has used argon2id since storage
      // version 2, and an export holds exactly the same secrets in exactly the
      // same danger from an offline guesser -- a weaker KDF on the copy that
      // gets emailed to yourself is the wrong way round.
      //
      // Nothing post-quantum here, and nothing needed: this path uses no public
      // keys at all, only a password-derived symmetric key, so it was never
      // exposed to the break the rest of this change is about. (openpgp 6.3.1
      // declares pqc_mlkem_x25519 and pqc_mldsa_ed25519 in its enums but ships
      // no implementation of either; generateKey({type: 'pqc'}) throws.)
      //
      // Read compatibility is unaffected: an OpenPGP message names its own S2K,
      // so exports written before this still import.
      this.openPgpModule.config.s2kType = this.openPgpModule.enums.s2k.argon2
    }
    return this.openPgpModule
  }

  /**
   * @inheritdoc
   */
  async encrypt(data: string, password: string): Promise<string> {
    const openPgp = await this.getOpenPgpModule()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const encrypted = await openPgp.encrypt({
      message: await openPgp.createMessage({ text: data }),
      passwords: [password],
      format: 'armored',
    })
    return encrypted as string
  }

  /**
   * @inheritdoc
   */
  async decrypt(data: string, password: string): Promise<string> {
    const openPgp = await this.getOpenPgpModule()
    const decrypted = await openPgp.decrypt({
      message: await openPgp.readMessage({ armoredMessage: data }),
      passwords: [password],
    })
    return decrypted.data as string
  }
}
