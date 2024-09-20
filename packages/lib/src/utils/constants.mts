export const SUPPORTED_ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-512'] as const
export type SupportedAlgorithmsType = (typeof SUPPORTED_ALGORITHMS)[number]
