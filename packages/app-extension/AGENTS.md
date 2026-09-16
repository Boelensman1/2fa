# favabrowserext

The browser extension (MV3) client of the `2fa` pnpm monorepo. WXT 0.21 +
React 19, inversify IoC, Tailwind. Private, never published.

Copied in from the `extension` project of
`https://github.com/wtflegal/base-projects` and integrated into the workspace.
The popup and the ioc/config/logging plumbing are still the upstream starter;
`lib/detect/` and the content script are ours.

`favalib` (`../lib`) is linked as `workspace:*` and is where all vault, crypto,
TOTP and sync logic belongs; prefer extending it over reimplementing that logic
here. Detection was step 1, reading the vault was step 2 — an unlock flow,
device pairing and an entry list — and filling a detected field from the vault
is step 3, which is now done: focusing a detected field offers the entries that
match that frame, and picking one types the code in. See
[The inline autofill menu](#the-inline-autofill-menu).

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

Only the background can know those selectors, because knowing them means
reading the vault — so a frame's first scan is always heuristic-only, and the
overrides arrive a round trip later on the `REPORT_OTP_FIELDS` **response**.
The content script compares them against what it last scanned with and calls
`observer.setInputSelectors()` only on a change, which is what stops the
rescan-report-rescan loop. Before that existed, `observeOtpFields` was called
with no selectors at all and the whole override path was dead code: the branch
at `detectOtpFields.ts` never ran, `matchedInputSelectors` was always empty and
`overrideMissed` was always false, however carefully a user set the field.

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

## The inline autofill menu

Focusing a detected otp field asks the background whether there is anything to
offer; if there is, the content script mounts an **iframe of an extension page,
inside a closed shadow root**, under the field. Picking a row makes the
background generate a code and deliver it to that one frame.

It never fills on its own, and that is not a default — there is no other mode.
The user's click is the authorisation, and it has to happen somewhere the page
cannot draw over, read or click for them.

Bitwarden's inline menu has the same shape, and the mechanics were derived from
MDN and the fixtures rather than from their source on purpose: **their autofill
code is GPL-3.0 and must not be read while working on this** (see the note on
`patterns.ts`). Publishing to a web store is distribution.

### What each context is allowed to know

```
  page realm (isolated world)              extension realm
┌──────────────────────────────┐
│ content.js                   │
│  detect                      │
│  closed shadow root          │        ┌──────────────────────────┐
│   ┌─ iframe ──────────────┐  │        │ background               │
│   │ entrypoints/menu      │──┼───────▶│  AutofillOfferRegistry   │
│   │  React + Tailwind     │◀─┼────────│  VaultContainer          │
│   └───────────────────────┘  │        └────────────┬─────────────┘
│  fillOtpField(id, otp) ◀─────┼─────────────────────┘
└──────────────────────────────┘   tabs.sendMessage(tabId, {frameId})
```

The content script shares a realm with the page, so it is told only a state, a
token and a row count — never an entry name. The names go from the background
to the **menu iframe**, which is a different origin the page cannot read into.
The code goes from the background to the **field's frame**, addressed by frame
id, and is never broadcast: a broadcast would hand a live otp to every frame on
the page, ad frames included.

The iframe is **not** sandboxed, deliberately. A sandboxed frame has no
extension api, which is why Bitwarden needs a postMessage relay and origin
checks for everything; ours keeps `runtime.sendMessage` and fetches its own
entries, so there is no relay to get wrong. The one thing that does travel by
`postMessage` is the menu's measured height and an Escape-pressed-inside
signal — see `MenuControlMessage` for why neither can be done any other way,
and why nothing secret may join them.

### Matching is against the frame's url, never the tab's

Every frame already reports under its own browser-supplied `sender.url`, and
that is what entries are matched on. A login form on an attacker-controlled
origin embedded in a trusted page therefore gets nothing — the shape of the
credential-theft report Bitwarden shipped in 2023 (`clients#5608`). The cost is
that a legitimate hosted second-factor widget on its own origin needs its own
matcher on the entry, which is the right trade and the right default.

### The offer token

The menu iframe's `sender.frameId` is its _own_ frame, and field ids are unique
only within a frame, so a fill request cannot name the field it means. The
background therefore mints an offer token bound to
`{ tabId, frameId, documentId, url, fieldId, entries }`, hands it to the content
script, which passes it in the iframe's url hash.

It is `crypto.randomUUID()` and not a counter, and that is the part worth not
"simplifying". The menu page is in `web_accessible_resources`, so **any site can
frame `chrome-extension://<id>/menu.html` itself** — and a frame loaded from
that url _is_ an extension context, with `runtime.sendMessage` and with
`sender.tab.id` set to the tab it sits in. A hostile frame on the page the user
is on shares a tab with a legitimate open offer. Gating on "is the sender an
extension page" does nothing, because it is one. Only an unguessable handle
separates our menu from theirs.

One offer per tab, no expiry sweeper: a tab has one focused field, so a second
offer means the first is stale, which also settles the out-of-order race when
focus moves between frames. `tabs.onRemoved`, an explicit close and a vault
lock cover the rest. Fills additionally check that the named entry was one the
offer listed — the menu is one postMessage from the page, so its request is a
suggestion, not an authority.

### Known limit: the menu is clipped to its frame

The menu renders in the frame that owns the field, and `position: fixed`
resolves against _that frame's_ viewport. A hosted widget in a 320x60 iframe
clips the menu to 320x60; z-index is irrelevant, because it is a
containing-block and clip problem and no css escapes a nested browsing context.
`positionMenu` degrades to an `over` placement — overlapping the field rather
than being placed where it cannot be seen. Escaping properly means relaying the
anchor rect up the frame chain and recomputing on every ancestor's scroll, and
breaks the moment an ancestor has no content script; that is its own feature.

Two smaller placement rules live in `menuHost.ts`: a field in a `showModal()`
dialog or an open popover is in the **top layer**, where nothing outside it
paints at any z-index, so the host is attached inside it; and everything else
attaches to `documentElement` rather than `body`, because a transformed
ancestor breaks `position: fixed` and a transformed `<body>` is what every
page-transition library leaves behind.

### Filling

`lib/content/fillField.ts`, and it has the suite because it is the part most
likely to quietly do nothing on a real widget.

- Values are written through **the prototype's** `value` setter. React installs
  its own accessor on the node to track changes; assigning through it leaves
  the tracker believing nothing happened and the next render restores the old
  value. On Firefox this is a no-op that costs nothing — Xray vision already
  hides page-defined own properties from a content script — so it is written
  once and commented, not branched.
- `input` is an `InputEvent` with `inputType` and `data`. Hand-rolled widgets
  branch on the first and read the second; a plain `Event` gives them
  `undefined` and throws the moment anything reads `.length` off it.
- Segmented rows **await a frame between boxes** and re-read `disabled` each
  pass, because the common widget enables box _i+1_ only in response to box
  _i_ — which is exactly why `isSegmentCandidate` does not filter disabled
  inputs. And after the first box it stops if the row filled itself: several
  widgets treat a multi-character value as a paste and distribute it, and
  carrying on writes every character twice.
- Nothing here submits — no `Enter`, no `requestSubmit()`, no click on a submit
  button. That is as far as the promise goes: plenty of sites submit themselves
  the instant the value is complete, and that is their call.

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
  reason; the content script is ~25kB. Check the build's size table after
  touching those imports. The same rule is why the autofill menu is an iframe
  rather than a react root in the shadow root — React and the components stay
  in `menu.html`'s chunk, which loads only when someone focuses an otp field.
  If `content.js` ever jumps by ~190kB, something under `lib/content/` has
  reached into `lib/ui/`.
- **`onMessage` handlers must never return a promise.** `@wxt-dev/browser` is a
  shim, not a polyfill: on chromium `browser` _is_ `chrome`, and chrome's
  `runtime.onMessage` ignores a returned promise and closes the channel. The
  content script's listener is async now that it fills fields, so
  `entrypoints/content.ts` uses the `sendResponse` + `return true` shape that
  `lib/background/handleMessage.ts` has always used. Getting this wrong makes
  every fill look like it silently failed.
- **`web_accessible_resources` must be written in the mv3 object form.** wxt
  flattens it to mv2's plain string array for the Firefox build and throws
  outright if you write the string form yourself. `use_dynamic_url` is
  deliberately _not_ set — see the comment in `wxt.config.ts`.
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
- **Do not call `browser.permissions.request` from `onInstalled`.** The
  starter did, asking for `<all_urls>` on Firefox, and it threw
  "permissions.request may only be called from a user input handler" on every
  install; `onInstalled` is not a user gesture. It would have failed a second
  time regardless, since a permission must appear in `optional_permissions`
  (mv2) / `optional_host_permissions` (mv3) to be requestable, and this
  manifest declares neither. Nothing needs it: Firefox is built as mv2, where
  the content script's `matches: ['<all_urls>']` is granted at install. A move
  to Firefox mv3 would make host access opt-in and need a real request — from
  a click in the popup.
