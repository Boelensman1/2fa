import type { JPakeThreePass, Round1Result } from 'jpake'

export interface ActiveAddDeviceFlow {
  jpak: JPakeThreePass
  addDevicePassword: Uint8Array
  userId: Uint8Array
  userIdString: string
  timestamp: number
  resolveContinuePromise?: (value: unknown) => void
  rejectContinuePromise?: (error: Error) => void
}
export interface InitiateAddDeviceFlowResult {
  addDevicePassword: string
  userIdString: string
  timestamp: number
  pass1Result: Record<keyof Round1Result, string>
}
