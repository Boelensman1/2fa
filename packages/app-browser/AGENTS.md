# favabrowser

The browser PWA of the `2fa` workspace: SolidJS 1.9, Vite 8, Tailwind CSS v4,
TypeScript strict mode. Private, never published. See the root `AGENTS.md` for
workspace layout, build order and container caveats.

This package is **pure UI**. All vault, crypto, TOTP and sync logic lives in
`favalib` (`../lib`); extend that rather than reimplementing it here.

## Commands

`make lint` (`prettier --check` + `tsc --noEmit` + `eslint`) is the feedback loop
for checking your work — not `make build`. `make test` runs the browser wiring
regressions in `tests/` with Vitest, real crypto and isolated browser globals.
The core library and server suites live in `../lib` and `../server`.
The separate `vitest.config.mts` runs in Node without the Vite UI/PWA plugins.
Every target here recurses into `../lib`, which is why lint is not instant and
why a change in `../lib/src` is picked up automatically.

`make test-e2e` runs the Playwright suite in `e2e/` against the running browser
service. See [e2e/README.md](e2e/README.md) for browser setup, configuration and
how to add tests. E2E tests are separate from the Node-based `make test` suite.

## Layout

- `src/index.tsx` — `render(<StoreProvider><App /></StoreProvider>, root)`
- `src/App.tsx` — root component; gates on auth/vault state
- `src/parameters.ts` — env-derived constants (`syncServerUrl`, `deviceType`, `version`)
- `src/index.css` — the only stylesheet: `@import 'tailwindcss'` plus a `.loader`
- `src/components/` — 15 flat `PascalCase.tsx` files, no subfolders
- `src/store/` — flux layer over `solid-js/store`
- `src/utils/` — `creationUtils.ts` (the favalib singleton), `saveFunction.ts`, `useSyncStoreWithLib.ts`

### Routing

There is none, and no router dependency. `App.tsx` navigates by nested `<Show>`
on store state, and panels inside `AppAuthenticated` toggle on local
`createSignal(false)` booleans. Add new screens the same way.

### State

`store/store.tsx` is a module-level `createStore` singleton (not per-provider);
`store/provider.tsx` dispatches with
`setState(produce((state) => reducer(action, state)))`, so reducers mutate the
draft. Adding an action touches four files: the `types` map and creator in
`actions.ts`, a member of the union in `types/Action.ts`, a `case` in
`reducer.tsx`, and usually a field in `types/State.ts`. Side effects live in the
action creators — `actions.setSettings` writes to `localStorage`.

Persistence is `localStorage` only, two keys: `lockedRepresentation` (the
encrypted vault blob, written by `utils/saveFunction.ts`) and `settings`, both
bootstrapped in an `App.tsx` effect.

### favalib

The whole `FavaLib` instance is stored **in** the Solid store (`state.favaLib`,
asserted with `!` in authenticated components) and reached through its
namespaced sub-APIs: `favaLib.vault.*`, `.storage.*`, `.exportImport.*`,
`.sync?.*`, `.meta.*`. **There is no automatic reactivity between favalib and
the store** — after any mutation call the `useSyncStoreWithLib()` hook, or the
UI goes stale.

### TOTP refresh loop

`ItemList` owns a single `setInterval(…, 1000)` driving a `currentTime` signal
passed down to each `EntryComponent`, which keys a `createResource` on
`{ id, timestamp }`. Do not add per-entry timers.

## Configuration

`vite.config.mts` (note the `.mts`): dev server on port 3266 host `0.0.0.0`,
build output `build/` (not `dist/`), `vite-plugin-pwa` with
`registerType: 'autoUpdate'`, and `VITE_COMMIT_HASH` injected via
`git rev-parse` at config-load time, so builds need real git history.
TypeScript is `strict` with `moduleResolution: 'bundler'` and
`jsxImportSource: 'solid-js'`, and has **no path aliases** — intra-package
imports are relative and extensionless. Tailwind v4 is configured CSS-first in
`src/index.css`; there is no `tailwind.config.js` and there should not be one.

The app reaches the sync server at `/api/sync` on whatever origin serves it, and
`vite.config.mts` proxies that path to `SYNC_SERVER_TARGET` (default
`ws://localhost:8080`) — `preview.proxy` falls back to `server.proxy`, so this
holds for `make preview` as well as `make dev`. `VITE_SYNCSERVERURL` overrides
the url the app uses: a path is resolved against the page's origin, an absolute
`ws://` or `wss://` url is used as-is. To exercise sync locally, start the
server with `make -C ../server dev`.

## Conventions

Prettier and ESLint configs are shared from the repo root. This package is the
only one with `eslint-plugin-solid` enabled, and it opts out of
`jsdoc/require-jsdoc` and `no-restricted-globals` (so plain `Error` and `Buffer`
are fine here, unlike in `../lib`).

- One `export default` per module; named exports only for constants
- `const X: Component<Props> = (props) => {}` — never destructure props
- `<Show>` / `<For>`, not `&&` and `.map`; `class=`, not `className`
- Async handlers: `const doX = async () => {}` plus a sync handler doing
  `e.preventDefault(); void doX()`
- Tailwind classes inline in JSX; match the neighbouring component's card and
  button strings rather than inventing a new look

## Gotchas

- `src/components/Add.tsx` calls `useStore()` **inside** its async functions,
  outside the owner scope. Do not copy this; call `useStore()` at the top of the
  component.
- `make lint` passes on a clean tree but is not warning-free: `CreateVault.tsx`
  and `Login.tsx` each emit a `solid/reactivity` warning about `favaLib`
  capturing `password`. That is the baseline.
