/// <reference types="vite/client" />
/// <reference types="@samrum/vite-plugin-web-extension/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly VITE_LOG_LEVEL?: string
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
