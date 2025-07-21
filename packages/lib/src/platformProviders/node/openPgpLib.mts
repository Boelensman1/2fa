import type { OpenPgpLib } from '../../interfaces/OpenPgpLib.mjs'

/**
 * Node.js implementation of OpenPGP library wrapper
 */
export class NodeOpenPgpLib implements OpenPgpLib {
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
