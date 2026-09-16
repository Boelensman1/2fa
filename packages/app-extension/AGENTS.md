# favabrowserext

The browser extension (MV3) client of the `2fa` pnpm monorepo. WXT 0.21 +
React 19, inversify IoC, Tailwind. Private, never published.

Copied in from the `extension` project of
`https://github.com/wtflegal/base-projects` and integrated into the workspace.
The popup and the ioc/config/logging plumbing are still the upstream starter;
`lib/detect/` and the content script are ours.

`favalib` (`../lib`) is linked as `workspace:*` and is where all vault, crypto,
TOTP and sync logic belongs; prefer extending it over reimplementing that logic
here. Detection was step 1 and reading the vault is step 2, which is done:
there is an unlock flow, device pairing and an entry list. Filling a detected
field from the vault is step 3 and is **not** built — `ctActions.detectOtpFields`
/ `DETECT_OTP_FIELDS` is still the unused seam for it.

## The vault

The one `FavaLib` instance lives in the **background service worker**, owned by
`lib/ioc/entities/VaultContainer.ts`. It is there and not in the popup because
the popup is destroyed every time it closes, and because the sync websocket has
to outlive it. The popup holds no keys, no entries and no favalib import; it is
a thin client over the same typed `sendMessage` protocol the rest of the package
uses (`GET_VAULT_STATE`, `UNLOCK_VAULT`, `LIST_ENTRIES`, `GET_TOKEN`, …).

Four states, and `entrypoints/popup/App.tsx` is a switch over them:

| status     | meaning                                                |
| ---------- | ------------------------------------------------------ |
| `no-vault` | nothing stored; the user creates one or joins one      |
| `locked`   | a locked representation is on disk, no keys in memory  |
| `pairing`  | a placeholder vault exists, waiting for another device |
| `unlocked` | ready to list and to generate tokens                   |

Three things are worth knowing before changing any of it.

- **The popup never renders a code.** `listEntries` uses favalib's
  `listEntriesMetas()` (the overload _without_ tokens), so a secret never
  crosses the message boundary, and `EntryMeta` carries no `payload` anyway.
  A token is generated only when the user clicks a row, and is copied straight
  to the clipboard. The clipboard write happens in the popup because a service
  worker has no `navigator.clipboard`.
- **Pairing is text-only.** The other clients also accept a pasted QR _image_,
  which favalib decodes with `getImageDataFromInput` — that needs `Image`,
  `document` and `FileReader`, none of which exist in a service worker. The
  text code carries the same payload.
- **Search is delegated,** not filtered locally, so this and the pwa agree on
  what matches: `searchEntriesMetas` is a case-insensitive substring of issuer
  or name. The "for this site" group is `findEntryMetasForUrl(activeTabUrl)`,
  already sorted most-specific-first, and is hidden while a query is active.

### Staying unlocked across a worker restart

mv3 evicts the worker after ~30s idle, which would otherwise mean retyping the
master password almost every time the popup opens. `init.ts` calls
`vaultContainer.restoreSession()` on every boot to rebuild the instance.

Only Chrome is affected, and only Chrome pays for it. wxt builds Firefox as
**mv2**, whose background is a persistent page rather than a service worker, so
nothing is evicted and `restoreSession()` would never have a reader —
`backgroundCanBeEvicted()` therefore skips the write there entirely, rather
than storing a master password for nobody. It keys on the manifest version,
not the browser, because a Firefox _mv3_ build gets an event page that **is**
terminated and does need it; vite folds the check to a constant per target
(`()=>!0` for chrome-mv3, `()=>!1` for firefox-mv2). Check the built manifest when changing
anything manifest-shaped, because the two targets differ more than usual here:
wxt rewrites `content_security_policy` from the mv3 object form to mv2's single
string, and the background from `service_worker` to `scripts`.

That works by keeping the **master password** in `Db`'s `session:` area
(`browser.storage.session`: memory-backed, never written to disk, wiped when
the browser closes, unreadable from content scripts). That is not a casual
choice — favalib can only build a `FavaLib` from
`(lockedRepresentation, password)`, with no api to rehydrate one from the keys
it has already derived, so there is nothing else to keep. Anything able to read
that area is already a context that could read the unlocked vault directly. The
clean fix is an export/import-unlocked-session api in favalib; until then, do
not move this to `local:`, and keep `lock()` clearing it.

## `lib/detect/` — the otp field heuristic

Finds the second-factor input on a page. Self-contained on purpose: nothing in
the directory imports from `lib/`'s other modules or from `wxt/*`, so the
scoring is testable as plain data and the extension's logging and ioc stay out
of a hot dom path. That also means moving it into `favalib` later, if a second
client ever needs it, is a directory move plus an export-map entry.

The seam is `signals.ts`. Above it (`collectSignals`, `walkDom`,
`groupSegments`, `visibility`, `selector`) is dom work; below it
(`scoreField`, `patterns`) is arithmetic over a plain `FieldSignals` object.

- `patterns.ts` — **read the header before touching it.** Chromium's
  `kOneTimePwdRe` and `kSocialSecurityRe` are reproduced verbatim under a
  BSD-3-Clause notice; `CARD_CVC_RE` is a deliberately narrowed subset of
  Chromium's; `OTP_FIELD_EXTRA_RE` and the other exclusions are ours. Keep
  that boundary legible. **Bitwarden's autofill code is GPL-3.0 and must not
  be copied into this repo** — publishing to a web store is distribution, and
  this package is ISC/MIT-compatible.
- `scoreField.ts` — tiers plus a capped score. `autocomplete="one-time-code"`
  and an `inputSelector` override are decisive at 100; heuristic scores are
  clamped to 99 so `definite` always means "the page said so". The three
  signal families are capped separately because their members are correlated.
- `detectOtpFields.ts` — the orchestrator. `observe.ts` wraps it in a
  debounced `MutationObserver`, one per root.

`EntryMeta.inputSelector` (favalib) is the escape hatch for pages the
heuristic gets wrong; it suppresses the heuristic rather than merging with it.
Set it from the cli with `favacli entries edit <id> --input-selector`.

`tests/fixtures/otpFields/*.html` is the real specification — twenty snippets,
half of which must detect nothing. It is in `.prettierignore`, because
whitespace between inputs is exactly what a dom walk can be sensitive to. The
snippets are hand-written and therefore too clean; the corpus only really earns
its keep once fixtures are captured from real second-factor screens.

Workspace dependency graph:

```
favalib  ←  favacli
   ↑↑↑
   ││└── favabrowser
   │└─── favabrowserext   (this package)
   └──── favaserver
```

## Development commands

Run `make` from this directory (`packages/app-extension`). The Makefile — not
the `package.json` scripts — is the canonical entrypoint: it builds `favalib`
first and delegates installs to the repo root.

- `make lint` — `prettier --check`, `eslint`, `tsc --noEmit`. The feedback loop
  to use for checking your work.
- `make test` / `make test-watch` — vitest, in a `happy-dom` environment
  (`vitest.config.ts`). Tests live in `tests/`.
- `make build` — alias for `make dist/chrome`; `wxt build` into `.output/`.
- `make dist/firefox` / `make dist/chrome` — per-browser builds.
- `make dev` (= `dev-firefox`) / `make dev-chrome` — WXT dev server, writing to
  `dev-output/` rather than `.output/`: browsers hide dot-directories in their
  "load unpacked extension" picker. The Makefile sets `WXT_OUT_DIR`, which
  `wxt.config.ts` reads. Production builds and zips are never loaded unpacked
  and stay in `.output/`. There is no milly dev service for this package; start
  it by hand when you need it.
- `make artifacts/favabrowserext.chrome.zip`,
  `…/favabrowserext.firefox.zip`, `…/favabrowserext.firefox.source.zip` —
  distributable zips.
- `make clean` — removes `.output`, `dev-output`, `.wxt`, `artifacts`,
  `web-ext-artifacts`.
- Never run `pnpm install` by hand; the `node_modules` target delegates to the
  repo root, which runs `pnpm install --frozen-lockfile`.

## Package-specific configuration

Unlike the other packages, this one keeps its own `eslint.config.mjs` (built on
`wtf-devconfigs/eslints/vite-react.mjs`) and `.prettierignore`. The repo-root
ESLint config explicitly ignores `packages/app-extension/**`, because this
package's `tsconfig.json` extends `./.wxt/tsconfig.json`, which is generated by
the `wxt prepare` postinstall and gitignored. Prettier and `.editorconfig`
resolve upward to the repo root as usual.

Shared dependency versions come from the catalog in `../../pnpm-workspace.yaml`
and are referenced as `"typescript": "catalog:"`.

## Gotchas

- Four upstream defects had to be fixed to get `make lint` and `make build`
  green; they fail identically under the starter's own TypeScript 7, so they
  are not fallout from using the workspace's TypeScript 5.9:
  - `entrypoints/content.ts` called `load()` with no argument, but
    `lib/content/index.ts` declares `load(_ctx: ContentScriptContext)`.
  - `lib/types/{Config,State,LogEntryPayload}.ts` used
    `export default <TypeName>` for an interface, which `verbatimModuleSyntax`
    rejects; they now use `export default interface …` so the
    `export type { default as X }` barrel in `lib/types/index.ts` still works.
- The Tailwind setup was migrated from v3 to v4 style (the starter declared
  `tailwindcss@^4.3.3` but configured the v3 PostCSS plugin, which fails the
  build outright). `postcss.config.mjs` now uses `@tailwindcss/postcss`,
  `lib/styles/globals.css` uses `@import 'tailwindcss'` plus `@source`
  directives, and `tailwind.config.ts` is gone — matching `../app-browser`.
- `artifacts/favabrowserext.firefox.source.zip` clones `../..`, so the Mozilla
  source upload contains the whole monorepo, not just this package. That is
  also why `zip.zipSources` is off in `wxt.config.ts`: wxt's own sources zip
  holds this package alone, which cannot build — it is a pnpm workspace member
  and needs the root lockfile, workspace file and `packages/lib`. Uploading it
  would hand a reviewer something that fails to build. The target needs the
  `zip` binary, which the Milly container does not ship.
- `zip.artifactTemplate` and `sourcesTemplate` are pinned so the Makefile can
  move the zips by exact name. The default names carry the package version,
  and a `.output/*.zip` glob also picked up the sources zip and whatever the
  previous browser's build left behind — with two matches, `mv` fails with
  "is not a directory".
- `browser_specific_settings.gecko.id` is `fava@appeal.nl` and is
  **permanent** — it is the add-on's identity on addons.mozilla.org, and
  changing it after publishing makes it a different add-on that existing users
  never receive as an update. Chrome derives its own id from the signing key
  and ignores this.
- **Do not import the `lib/` barrel from the content script.** `lib/index.ts`
  re-exports the ioc container, which now reaches `VaultContainer` and through
  it all of favalib — node-forge, jpake, openpgp. `lib/content/index.ts` used
  to take `Logger` and `bgActions` from it, and that alone put **2.7MB** of
  vault code into `content-scripts/content.js`, injected into every frame of
  every page. It imports `../classes/Logger` and `../state` directly for that
  reason; the content script is back to ~19kB. Check the build's size table
  after touching those imports.
- `content_security_policy.extension_pages` carries `'wasm-unsafe-eval'`
  because favalib derives the vault key with argon2id from `hash-wasm`, which
  instantiates a WebAssembly module. It runs on **every** unlock, so without
  this nothing unlocks, in the popup or the background. It permits no `eval()`
  and no remote script — it is specifically the wasm carve-out.
- The background bundle is ~2.7MB and that is expected: rolldown inlines every
  one of favalib's dynamic `import()`s (jsqr, zxcvbn, openpgp, qrcode). That is
  load-bearing rather than merely wasteful — the worker is declared as a
  _classic_ service worker, which cannot do a runtime `import()` at all. If a
  build ever leaves a real `import(` in `background.js`, pairing and the
  password-strength meter break at runtime while still typechecking.
- `browser_specific_settings` is added only for the Firefox build.
  `data_collection_permissions: { required: ['none'] }` is the explicit "this
  extension collects nothing", required for new Firefox extensions from
  2025-11-03. Chrome does not know the key, so it is omitted there.
- happy-dom does no layout: `offsetParent` is `undefined`, `offsetWidth` is 0
  and `getBoundingClientRect()` returns a zero rect for visible and hidden
  elements alike. Visibility is therefore built on `checkVisibility()`, which
  it does implement faithfully. `tests/environment.test.ts` pins both facts.
- Under `environment: 'happy-dom'`, `import.meta.url` resolves against the
  document's `http://localhost/`, so `new URL(..., import.meta.url)` reads
  from the filesystem root. Fixtures load from vitest's cwd instead.
- All log level filtering happens in the _receiving_ context: a content
  script's `Logger` forwards every entry to the background through `sendLog`
  regardless of level, and the background filters on receipt. The popup runs at
  a `-extension:` origin, so `inBackgroundScript()` is true for it and it logs
  to its own console. That is why `setVerboseLogging` is called from the
  background and from `useConfig`, and from nowhere else.
- The content script runs with `allFrames: true`. That is a content-script
  option, not a permission — a statically declared script takes its host
  access from `matches`, and `permissions` is still just `['storage']`.
