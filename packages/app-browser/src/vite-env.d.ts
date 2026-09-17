/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev-only prefill for the sync server form. See src/parameters.ts. */
  readonly VITE_DEVSYNCSERVERURL: string
  /** Dev-only prefill for the sync server secret. NEVER set in a public build. */
  readonly VITE_DEVSERVERSECRET: string
  readonly VITE_COMMIT_HASH: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
