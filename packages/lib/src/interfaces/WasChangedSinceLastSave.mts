import { SaveFunctionData } from './SaveFunction.mjs'

export type WasChangedSinceLastSave = Record<keyof SaveFunctionData, boolean>
