export const SUPPORTED_ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-512'] as const
export type SupportedAlgorithmsType = (typeof SUPPORTED_ALGORITHMS)[number]

/**
 * Maps an algorithm name as other apps write it onto the one fava stores.
 *
 * The key uri format spells these SHA1, SHA256 and SHA512; fava stores
 * SHA-1, SHA-256 and SHA-512, and its older exports wrote those too. The
 * `algorithm.` prefix is how some exporters write the protobuf enum name.
 * @param alg - The algorithm name, in any case.
 * @returns The stored algorithm name, or null if it is not supported.
 */
export const parseOtpAlgorithm = (
  alg: string,
): SupportedAlgorithmsType | null => {
  switch (alg.toLowerCase()) {
    case 'sha1':
    case 'sha-1':
    case 'algorithm.sha1':
      return 'SHA-1'
    case 'sha256':
    case 'sha-256':
    case 'algorithm.sha256':
      return 'SHA-256'
    case 'sha512':
    case 'sha-512':
    case 'algorithm.sha512':
      return 'SHA-512'
    default:
      return null
  }
}

/**
 * Writes a stored algorithm name the way the key uri format spells it.
 * @param alg - The stored algorithm name.
 * @returns SHA1, SHA256 or SHA512; an unsupported name is returned unchanged.
 */
export const formatOtpAlgorithm = (alg: string): string =>
  parseOtpAlgorithm(alg)?.replace('-', '') ?? alg
