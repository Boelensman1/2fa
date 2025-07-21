/**
 * Interface for OpenPGP operations
 */
export interface OpenPgpLib {
  /**
   * Encrypts the given data using OpenPGP.
   * @param data - The data to encrypt.
   * @param password - The password to use for encryption.
   * @returns A promise that resolves to the encrypted data.
   */
  encrypt(data: string, password: string): Promise<string>

  /**
   * Decrypts the given data using OpenPGP.
   * @param data - The data to decrypt.
   * @param password - The password to use for decryption.
   * @returns A promise that resolves to the decrypted data.
   */
  decrypt(data: string, password: string): Promise<string>
}

export default OpenPgpLib
