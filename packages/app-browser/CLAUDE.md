# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`favabrowser` — the browser PWA client of the `2fa` pnpm monorepo. SolidJS 1.9,
Vite 8, Tailwind CSS v4, TypeScript strict mode. Private, never published.

This package is **pure UI**. All vault, crypto, TOTP and sync logic lives in
`favalib` (`../lib`, linked as `workspace:*`); prefer extending `favalib` over
reimplementing that logic here.

Workspace dependency graph:

```
favatypes  ←  favaserver  ←  favalib  ←  favacli
                              ↑
                              └── favabrowser   (this package)
```

Shared dependency versions are pinned in the catalog in
`../../pnpm-workspace.yaml` and referenced as `"typescript": "catalog:"`.
`.npmrc` sets `node-linker=hoisted`.

## Development Commands

Run `make` from this directory (`packages/app-browser`). The Makefile — not the
`package.json` scripts — is the canonical entrypoint: it also builds `favalib`
first and installs workspace dependencies when they are stale.

### Code Quality

- **Prettier fix**: `pnpm exec prettier --write .` - Apply prettier format
- **Lint**: `make lint` - Runs `prettier --check`, `tsc --noEmit` and `eslint`. This is the feedback loop to use for checking your work.
- **Test**: `make test` - Prints "no tests defined". This package has no tests; the test suites live in `../lib` and `../server`.

### Other Commands (these should almost never be ran)

- **Development server**: `make dev` - Runs Vite on port 3266, host `0.0.0.0`. A development server is almost always already running.
- **Build**: `make build` - Runs `tsc` then `vite build` into `build/`. DO NOT USE THIS FOR TESTING/LINTING. Use `make lint` for that.
- **Preview**: `make preview` - Serves a production build. Currently broken: the target depends on `dist`, but `build.outDir` is `build`.
- **Install dependencies**: never run `pnpm install` by hand. The `node_modules` make target delegates to the repo root, which runs `pnpm install --frozen-lockfile`; `make lint`/`make build` do this automatically.
- **Clean**: `make clean` - No-op for this package.

Do not invoke `pnpm exec vite build` directly — it skips both the `tsc`
typecheck and the `favalib` rebuild that `make build` performs.

`../lib/build` is declared `.PHONY`, so every target here recurses into
`../lib` (and transitively `../types`, `../server`). That is why `make lint` is
not instant, and why a change in `../lib/src` is picked up automatically.

Native modules (`canvas`, `keytar`) that `favalib` pulls in need system libs on
the loader path. If a build fails with a missing `.so`, run the command inside
`nix develop` from the repo root — the flake's dev shell provides node 24,
pnpm 10 and those libraries.

## Architecture

### Directory Structure

- `src/index.tsx` - Entry point: `render(<StoreProvider><App /></StoreProvider>, root)`
- `src/App.tsx` - Root component; gates on auth/vault state
- `src/index.css` - The only stylesheet: `@import 'tailwindcss'` plus a `.loader` spinner
- `src/parameters.ts` - Env-derived constants (`syncServerUrl`, `deviceType`, `version`)
- `src/components/` - 15 flat `PascalCase.tsx` files, no subfolders
- `src/store/` - Redux-style store over `solid-js/store` (`store`, `provider`, `reducer`, `actions`, `Context`, `useStore`, `types/`)
- `src/utils/` - `creationUtils.ts` (configured favalib singleton), `saveFunction.ts`, `useSyncStoreWithLib.ts`

### Routing

There is none, and no router dependency. Navigation is conditional rendering
through nested `<Show>`. `App.tsx` gates on store state:
`vaultExists` → `favaLib` → `!isConnectingToExistingVault` →
`<AppAuthenticated>`, falling back to `<CreateVault>` / `<Login>` /
`<ConnectToExistingVault>`. Inside `AppAuthenticated`, panels are toggled by
local `createSignal(false)` booleans. Add new screens the same way rather than
introducing a router.

### State Management

A hand-rolled flux layer on top of `solid-js/store`:

- `store/store.tsx` - module-level `createStore(initial)` singleton (not per-provider)
- `store/provider.tsx` - `dispatch = setState(produce((state) => reducer(action, state)))`; reducers mutate the draft
- `store/actions.ts` - a `types` const map (`'X' as const` per key) plus action creators on a default-exported `actions` object
- `store/types/Action.ts` - discriminated union of per-action interfaces
- `store/useStore.tsx` - `useStore()` returns `[state, dispatch]`

Adding an action means touching four files: the `types` map and creator in
`actions.ts`, a member of the union in `types/Action.ts`, a `case` in
`reducer.tsx`, and usually a field in `types/State.ts`.

Side effects live in the action creators — e.g. `actions.setSettings` writes to
`localStorage` before returning the action.

### Persistence

`localStorage` only, two keys: `lockedRepresentation` (the encrypted vault blob,
written by `utils/saveFunction.ts`) and `settings`. `App.tsx` bootstraps from
both in a `createEffect`. "Reset" in `Login.tsx` is `localStorage.clear()` plus
a reload.

### favalib Integration

- `utils/creationUtils.ts` builds the singleton with `getFavaLibVaultCreationUtils(BrowserPlatformProvider, deviceType, passwordExtraDict, throwingSaveFn, syncServerUrl)`, importing the provider from the subpath export `favalib/platformProviders/browser`. The save function passed there intentionally throws; the real one is installed by `Login`/`CreateVault` via `favaLib.storage.setSaveFunction(...)`.
- The whole `FavaLib` instance is stored **in** the Solid store (`state.favaLib`), and authenticated components assert it with `state.favaLib!`.
- Components reach through namespaced sub-APIs: `favaLib.vault.*`, `favaLib.storage.*`, `favaLib.exportImport.*`, `favaLib.sync?.*`, `favaLib.meta.*`, plus `favaLib.addEventListener(FavaLibEvent.X, ...)`.
- **There is no automatic reactivity between favalib and the store.** After any mutation, call the `useSyncStoreWithLib()` hook to re-pull entries; forgetting this leaves the UI stale.

### TOTP Refresh Loop

`ItemList` owns a single `setInterval(…, 1000)` driving a `currentTime` signal
(cleaned up in `onCleanup`), passed down to each `EntryComponent` as an
`Accessor<number>`. Each entry uses `createResource` keyed on
`{ id, timestamp }` to regenerate its token and progress bar. Do not add
per-entry timers.

## Key Configuration

- **Vite config**: `vite.config.mts` (note the `.mts` extension)
- **Port**: dev server runs on 3266 (`2f` in utf-8 hex), host `0.0.0.0` — not Vite's default 5173
- **Build output**: `build/` (not `dist/`), target `esnext`
- **PWA**: `vite-plugin-pwa` with `registerType: 'autoUpdate'`
- **Commit hash**: `VITE_COMMIT_HASH` is injected via `execSync('git rev-parse --short HEAD')` at config-load time, so builds require a git repo. Shown bottom-right on the login screen.
- **Env vars**: `VITE_SYNCSERVERURL` (default `ws://localhost:8080`). To exercise sync locally, start the sync server with `make -C ../server dev`.
- **TypeScript**: `strict`, `moduleResolution: 'bundler'`, `jsxImportSource: 'solid-js'`, `noEmit`. **No path aliases** — all intra-package imports are relative and extensionless.
- **Tailwind v4**: CSS-first config via `@import 'tailwindcss'` in `src/index.css`. There is no `tailwind.config.js`, and there should not be one.

## Code Standards

Prettier and ESLint configs live at the repo root and are shared by all packages.

- **Prettier**: no semicolons, single quotes, trailing commas `all`, always-parens arrows; 2-space indent, LF, default 80-column print width
- **ESLint**: one flat config at the repo root, type-aware (`project: ['./packages/*/tsconfig.json']`). `eslint-plugin-solid` recommended rules are enabled for this package only. This package also opts **out** of `jsdoc/require-jsdoc` and `no-restricted-globals` (so plain `Error` and `Buffer` are fine here, unlike in `../lib`) — but `jsdoc/require-param` and `jsdoc/check-param-names` still apply to any JSDoc you do write
- **Exports**: one `export default` per module; named exports only for constants (`parameters.ts`, `types` in `actions.ts`)
- **Components**: arrow functions, typed `const X: Component<Props> = (props) => {}`. Never destructure props — access `props.x` to preserve reactivity
- **Control flow**: `<Show>` / `<For>`, not `&&` and `.map`
- **Solid JSX**: `class=`, not `className`
- **Async handlers**: `const doX = async () => {}` plus a sync handler doing `e.preventDefault(); void doX()` — the `void` satisfies `no-floating-promises`
- **Imports**: `import type { … } from 'favalib'` for types; inline `import { type Component, createSignal }` is common
- **Styling**: Tailwind utility classes inline in JSX. Some card and button class strings are copy-pasted across components; match the neighbouring component rather than inventing a new look

## Gotchas

- `src/components/Add.tsx` calls `useStore()` **inside** its async `add()` and `importFromQRCode()` functions (lines 16 and 46) instead of at component top level — outside the owner scope. Do not copy this; call `useStore()` at the top of the component.
- `clsx` and `@solid-primitives/media` are declared dependencies but unused, and `src/store/types/Dispatch.ts` is never imported.
- `make lint` does not pass on a clean tree: `src/components/ListSyncDevices.tsx` has four pre-existing `@typescript-eslint/prefer-nullish-coalescing` errors, and `CreateVault.tsx`/`Login.tsx` each emit a `solid/reactivity` warning. Compare against that baseline rather than assuming you broke something.
