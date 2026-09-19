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
is step 3, which is now done, twice over. Focusing a detected field offers the
entries that match that frame ([the inline autofill
menu](#the-inline-autofill-menu)); and while a page has a field on it, every row
in the popup gains a Fill button ([filling from the
popup](#filling-from-the-popup)). The two look similar and are matched
differently on purpose — the menu against the frame's url, the popup's group
against the tab's, which is also why they can disagree; see [the popup can only
match what the browser will name](#the-popup-can-only-match-what-the-browser-will-name).

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
  already sorted most-specific-first, and is hidden while a query is active --
  and the search box has `autoFocus`, so the first keystroke after opening the
  popup takes the group away. That is deliberate, and it is also the first
  thing to rule out when someone reports the group missing. Where
  `activeTabUrl` comes from is its own problem; see below.

### The popup can only match what the browser will name

`tabs.query()` answers whatever the permissions are, but the browser **scrubs
`url`, `title` and `favIconUrl` off the `Tab`** unless the extension holds the
`tabs` permission, host access, or `activeTab`. A content script's `matches` is
none of those: it grants the _script_ injection and its own host access, and
grants the extension apis nothing.

That is not a Chrome mv3 subtlety. On **Firefox mv2**, with
`matches: ['<all_urls>']` declared and `permissions: ['storage']`,
`browser.permissions.getAll()` answers `origins: []` and `tabs.query` returns a
`Tab` with an `id` and no `url`. Both builds behaved the same way, and both
were broken.

The failure had no symptom of its own, which is why it lasted. `useActiveTab`
folded a withheld url into the same `null` it uses for a new tab or a pdf
viewer; `listEntries` takes `url && !trimmed` to `forSite: []`; `VaultTab`
renders the section only when that list is non-empty. So the group silently
never appeared on any site, and looked exactly like a vault with no entry for
the site you were on -- while the inline menu, which matches on a
browser-supplied `sender.url` and needs no permission at all, went on offering
the very same entry. Two surfaces disagreeing about one question is what got it
reported.

Two things fix it and both matter:

- **`activeTab`**, not `tabs` and not `host_permissions: ['<all_urls>']`. It is
  granted by the click that opens the popup, carries no install warning on
  either store, and lapses when the tab navigates -- all fine for a value read
  once, in an effect, at popup open. `wxt.config.ts` carries the full argument,
  including why a permanent "Read your browsing history" warning is the wrong
  price for one string, and why `<all_urls>` would switch the feature back off
  for every existing user on a move to Firefox mv3.
- **`ActiveTab.named`**, so "the browser named no url" stops being the same
  value as "this page has no url worth matching". `VaultTab` says the first out
  loud where the group would be. The same principle as the background logging a
  line when nothing answers `SHOW_REMEMBER_PROMPT`: a feature that fails by
  rendering nothing needs somewhere to say it failed, or the next occurrence is
  invisible too.

Note what is _not_ the fix. The background does hold a browser-supplied page
url -- `otpFieldRegistry.forFrame(tabId, 0)?.url`, the read
`FILL_DETECTED_FIELD` already makes -- and `LIST_ENTRIES` could fall back to it
with no permission. It was rejected: `report()` is driven by the detected set
changing, so an spa that navigates without changing its fields leaves a stale
url; an mv3 eviction empties the registry; and it would put a `tabId` on a
popup-only action for insurance the `named` flag already provides visibly.
`FillTarget` is disqualified outright, for a sharper reason -- `pickFillTarget`
filters `fields.length > 0`, so it is null on exactly the pages where the
heuristic missed the field and the user wants to copy a code by hand.

### The sync server is set up after the vault, not baked into it

`getFavaLibVaultCreationUtils` no longer takes a server url, because a url
alone configures nothing: the server refuses any socket that cannot prove its
shared secret, and only the user has that. So `SyncServerForm` asks for both
together and `VaultContainer.setSyncServer` hands them to
`favaLib.setSyncServerUrl`, which resolves only once the server has **accepted**
— a wrong secret is a rejection there rather than a connection that silently
never works. `../app-browser` does the same, from its own `SyncServerForm`.

Two consequences worth knowing. Pairing is a conversation over that server, so
`PairScreen` renders the form instead of the connection-code box until one is
configured. And `VaultSummary` carries `syncServerUrl` **and** `syncConnected`
because they are different questions: no server configured is answered by the
form, a configured server that is down is answered by waiting.

`parameters.ts` holds prefills for both, and `syncServerSecretPrefill` has
`DEV` in its env var name for the reason app-browser's does — anything
reachable from `import.meta.env` is compiled into the bundle, and an extension
bundle is as readable as a served page, since unpacking a `.crx` is a `unzip`.
Unlike app-browser's, the url prefill is absolute: a path there resolves
against the origin serving the app, and an extension page has no such origin.

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

That works by keeping favalib's **unlocked session** in `Db`'s `session:` area
(`browser.storage.session`: memory-backed, never written to disk, wiped when
the browser closes, unreadable from content scripts). `exportUnlockedSession()`
is the four secrets a password unlock derives, and
`loadFavaLibFromUnlockedSession()` rehydrates from them with no key derivation
at all — so a worker restart costs nothing, where the master password it
replaced meant a full argon2id pass on every boot.

It is still plaintext key material, and favalib's jsdoc states the contract it
must be held under: memory-backed storage with the lifetime of a process, and
nothing else. Do not move it to `local:`, do not log it, and keep `lock()`
clearing it.

The blob is bound to a key **generation**, not to a particular save: one export
opens every envelope that generation goes on to write, and `changePassword` is
the only thing that moves it. `FavaLibEvent.PasswordChanged` therefore
re-exports rather than dropping — favalib would refuse the pre-rotation blob
against the vault that change wrote, which surfaces as the vault locking itself
at the next eviction for no visible reason.

### What the popup was typing survives the popup closing

A browser action popup is destroyed the moment it loses focus, so every
`useState` in it goes too. The sync setup forces exactly that trip: it asks for
a server address **and** the shared secret, two long strings that almost always
live somewhere else, and going to copy either one closed the popup and emptied
the form.

`lib/drafts.ts` keeps six things across it, read and written through
`lib/ui/hooks/useDraft.tsx`:

| draft                   | what it holds                              | written by                         |
| ----------------------- | ------------------------------------------ | ---------------------------------- |
| `syncServer`            | the address and the secret                 | `SyncServerForm`                   |
| `pair`                  | the connection code and the device name    | `PairScreen`                       |
| `popupTab`              | which tab was open                         | `AuthenticatedApp`                 |
| `settingsEditingServer` | whether the server form was open           | `SettingsTab`                      |
| `createMode`            | which half of the first-run screen         | `CreateVaultScreen`                |
| `entryEdit`             | the entry ID and unfinished metadata edits | `EntryEditor` / `AuthenticatedApp` |

Four rules hold it together.

- **`session:` only.** A draft holds a server secret and a live pairing code.
  `browser.storage.session` is memory-backed, wiped when the browser closes and
  unreadable from content scripts -- the same area, and the same contract, as
  the unlocked session blob above. `local:` would put both on disk, outliving
  the browser that was meant to forget them.
- **No master password**, on either screen that asks for one. The reasoning is
  `rememberSession`'s: the password opens every key generation of the vault and
  is very often the user's password elsewhere, which is why even the eviction
  path stores the derived blob instead. A half-typed one surviving popup opens
  would undo that.
- **A draft dies when its form is left**, not only when it is submitted.
  `SyncServerForm` drops its own on connect and on cancel; `SettingsTab` and
  `AuthenticatedApp` call `closeSyncServerEditor()` when the editor is closed or
  the tab is switched away, which drops the draft and the "it was open" flag
  together. `VaultContainer.lock()` calls `clearDrafts()` -- a lock is the user
  saying stop holding my things, and `reset()` comes through it.
- **A screen with a drafted text field renders `<Splash />` until the read
  lands.** It is a memory lookup, so a frame at most, but a field rendered
  before it could take a keystroke that hydration then overwrites -- which would
  be this feature causing the bug it exists to fix. `CreateVaultScreen` is the
  exception and gates nothing: only its mode toggle is drafted, there is no
  typing to lose, and a spinner in front of first-run onboarding is worse.

Writes are **not debounced**. The popup can be torn down between any two
keystrokes, and that is the case being fixed; `storage.session` has no
write-rate quota (that is `storage.sync`).

Two things are deliberately _not_ drafted: `VaultTab`'s search query, because a
stale one hides the entry the user came for; and `AuthenticatedApp`'s
`confirming`, which holds a `FillTarget` — a live frame id that a navigation can
invalidate, which is exactly what `stillHoldsTarget` exists to catch.

There used to be a third, `remembering`, and it is worth knowing where it went:
[the question it held moved onto the page](#offering-to-remember-the-site),
because no draft could have fixed it. The popup was asking at the one moment the
user was certain to leave — they click the page to press Enter — so restoring it
on the next open would have been asking again after the moment had passed.

## Editing entries

The details screen’s **Edit entry** opens a metadata editor: issuer, account
name, display website, ordered site matchers, and OTP field selector. The secret
and TOTP settings stay in the background. `GET_EDITABLE_ENTRY` reads fresh
metadata and `UPDATE_ENTRY` writes only those five fields; both are popup-only
and remain outside `actionsReachableFromATab`. The background explicitly picks
allowed fields before calling favalib’s `updateEntry`, which validates, saves,
and syncs the change.

`favalib/matchers` exposes the shared matcher options and validation without
loading vault or crypto code into the popup. Both issuer and account name are
required by the library. Blank optional fields become null; blank matcher rows
are omitted. Website is display-only, never an implicit matcher.

The `entryEdit` session draft identifies the editor to reopen as well as keeping
its raw form values. Hydration finishes before the form accepts input, and
reopening fetches current metadata without overwriting the draft. Back/Cancel,
lock/reset, and successful saves discard it. Save cleanup happens in the
background too, because the popup may disappear during the write. An entry
deleted on another device is never recreated; an unavailable entry or failed
request offers a retry and a way back.

A successful edit invalidates autofill offers and broadcasts `entriesChanged`
without metadata. Each frame closes its stale menu and runs the existing
scan/report flow, fetching selectors for its own browser-supplied URL. No
selector is added to a broadcast.

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
  debounced `MutationObserver`, one per root, and exposes two ways in:
  `rescan()`, which reports only a change, and `scanNow()`, which hands the
  result back whether or not anything moved. The background needs the second
  when its own registry has been evicted.

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
                                              ▲
                                   ┌──────────┴─────────────┐
                                   │ popup                  │
                                   │  every entry, any site │
                                   │  OtpFieldRegistry      │
                                   └────────────────────────┘
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

Filling from the popup deliberately breaks half of that, and it is worth
knowing which half. _Delivery_ is still matched to the frame — the code goes to
one frame id, chosen from a browser-supplied `sender.url`. What is dropped is
_entry↔url_ matching: the popup offers every entry, for any site. The
justification is the trigger. The menu appears because the page did something,
so it has to be conservative about what it reveals; the popup opened because
the user opened it and clicked a row, which is the authorisation. Read the new
code as an oversight and you will "fix" the feature away.

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

That is true about telling _our menu_ from _theirs_. It is not true about
telling a tab context from the popup, which is a different question with a
usable answer -- see below.

One offer per tab, no expiry sweeper: a tab has one focused field, so a second
offer means the first is stale, which also settles the out-of-order race when
focus moves between frames. `tabs.onRemoved`, an explicit close and a vault
lock cover the rest. Fills additionally check that the named entry was one the
offer listed — the menu is one postMessage from the page, so its request is a
suggestion, not an authority.

### Who may send what

A hostile frame of `menu.html` is the reason `lib/background/handleMessage.ts`
opens with an allowlist, `actionsReachableFromATab`. Eight actions are on it: the
content script's `REPORT_OTP_FIELDS` and `SEND_LOG`, the two menu open/close
actions, the menu iframe's `GET_MENU_ENTRIES` and `FILL_OTP_FIELD`, and the
remember prompt's `GET_REMEMBER_OFFER` and `ANSWER_REMEMBER_OFFER` — each pair
carrying an offer token of its own. Everything else is refused when `sender.tab`
is set.

`ANSWER_REMEMBER_OFFER` is the one that **writes to the vault**, and it is on
this list, which deserves a sentence rather than a raised eyebrow. Its payload is
a token and a boolean. Every part of what gets written — which entry, which
matcher, which site url — is rebuilt in the background from the offer the token
resolves to, so a caller who somehow guessed a token still cannot choose what it
writes; the most it can do is accept a suggestion the user was going to be shown
anyway.

`sender.tab` is filled in by the browser for anything running in a tab and is
absent for an extension page in its own context, which is what the popup is. It
is not part of the message and cannot be forged. That is the whole check.

It closed a real hole rather than tightening a theoretical one: before it, a
site that framed `chrome-extension://<id>/menu.html` could call `LIST_ENTRIES`
for the entry ids and then `GET_TOKEN` for each one -- every code in the vault,
from any page, with no interaction -- or `RESET_VAULT` to destroy it. The offer
token was protecting the menu's own two actions and nothing else.

An allowlist and not a list of popup-only actions, because a denylist fails
open on precisely the commit that adds an action and forgets it. The
tab-reachable set is also the smaller half, and the one that changes least.

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

## Filling from the popup

The other entry point. While the active tab has a detected field, every row in
the popup carries a **Fill** button, and `EntryDetail` a Fill on this page
button. Picking one makes the background generate a code and deliver it to that
frame, exactly as the menu does.

It offers **every** entry, matching site or not. That is the difference from
the menu and the reason this exists: an entry the user has not given a matcher
yet, or a second-factor step that lives on a different host, can otherwise
never be filled at all. Site matches still sort to the top, in the "For this
site" group that was already there -- and a fill that was not one of them ends
in an offer to make it one next time ([below](#offering-to-remember-the-site)).

The group itself is **not** conditional on there being anything to fill.
`VaultTab` gates it on `entries.forSite.length > 0` and nothing else, and
`EntryRow`'s Copy button is always live while only Fill goes `invisible`. A
page whose otp field the heuristic missed is exactly when someone needs to find
their entry and copy a code by hand, so do not later tidy that condition into
`fillTarget && entries.forSite.length > 0`.

### Discovery is best-effort; correctness is at fill time

`GET_FILL_TARGET` answers from `OtpFieldRegistry`, and when the registry knows
nothing it broadcasts `DETECT_OTP_FIELDS` and lets the popup's poll collect the
answer. That is not belt and braces — an mv3 worker is evicted after ~30s idle
and takes the registry with it, and "open the 2fa page, wait for the code, then
open the popup" is exactly the sequence an eviction lands in the middle of.
Without the rescan the feature would be missing precisely when it is wanted.

The broadcast is throttled per tab (`mayRescan`), because "the registry knows
nothing" is permanently true on a page with no otp field on it — nearly every
page — and the popup polls. Unthrottled it would walk the dom of every frame of
the user's active tab twice a second for as long as the popup is open.

That is safe only because none of the _correctness_ rests on it. See below.

### A fill re-asks the frame before a code exists

`FILL_DETECTED_FIELD` cannot use an offer token: `AutofillOfferRegistry`
resolves against `sender.tab.id`, and the popup has no tab. The equivalent
guarantee is rebuilt from a round trip. Before anything is generated, the
background sends `DETECT_OTP_FIELDS` to that one frame and waits; the frame
reports as part of answering, under its **browser-supplied** url, and the
background then checks the refreshed record against the target the popup was
showing.

This is not ceremony. Nothing invalidates the registry on navigation —
`forgetTab` runs when the tab closes and that is all — and a frame id belongs
to the browsing context, so a browser reuses it across that frame's own
navigations. A popup left open while an embedded widget navigated could
otherwise deliver a live code into whatever replaced it. A dead frame rejects
the round trip and never gets one; a navigated frame fails the url check;
a frame that lost the field fails the field check.

`documentId` is carried on the report for the same reason and preferred when
delivering. It is Chrome-only, which is why the url check and not the document
id is the load-bearing one.

### Which frame may be filled without asking

The one place this feature says no, and it is Bitwarden's published rule for
_manual_ autofill: an embedded frame is untrusted when its url does not match a
uri saved on the item being filled, and filling an untrusted one names the url
and lets the user cancel or proceed. Their behaviour only — **their autofill
source is GPL-3.0 and was not read**, for the reason `patterns.ts` gives.

`isTrustedFrame` says yes when the field is in the tab's own document, or the
entry claims the frame's url, or the frame and the page are the same host or a
subdomain of one another. Otherwise the fill returns `untrusted-frame` — before
generating anything — and the popup asks.

Note that "trusted" is a property of the _entry_, not of the frame's position:
a hosted second-factor widget on its own origin is trusted for an entry that
carries a matcher for it, which is the same case the menu's frame-url rule
already serves.

The subdomain test is narrower than Bitwarden's "same domain as the website".
Telling `bbc.co.uk` from `co.uk` needs a public suffix list and favalib carries
none on purpose (`suggestMatchersForUrl` says so). Same host or a subdomain of
it, on a dot boundary, is what can be decided without one — an extra
confirmation, never a missing one.

### Why the offer registry was not reused

It holds **one offer per tab**, so minting a popup offer on every poll would
clobber a live inline offer twice a second; and an offer's `entries` list is
exactly the restriction this feature removes. Two lifecycles entangled for no
gain.

### Why the popup does not just ask the page itself

It could: it is an extension page and has `tabs.sendMessage`. It must not. Only
the _receiving_ side of a message gets a browser-supplied `sender.url`, so only
the background can learn which frame an answer came from and what origin that
frame is. A popup-side scan would have to take a frame's word for its own
identity, which is the thing this whole design refuses.

### Offering to remember the site

A popup fill very often lands on a page the entry does not claim -- that is the
feature. So a fill that succeeded is worth one question: keep it? Yes appends the
`BaseDomain` matcher `suggestMatchersForUrl` suggests, and fills in
`EntryMeta.url` when the entry has none -- origin and path, never the query,
because a second-factor url routinely carries a session id and that string is
stored in the vault and synced to every device.

**The question is asked on the page, not in the popup.** That is the part worth
reading before changing any of it.

It was in the popup first, and it could not work there. A browser action popup is
destroyed the moment it loses focus, and the very next thing anyone does after a
fill is click the page to press Enter -- so the prompt was being put up at the
one moment it was certain to be dismissed. An unanswered offer is a no, so the
feature quietly never fired. Drafting it (`lib/drafts.ts`) would not have helped:
it would have restored the question on the next popup open, after the moment had
passed.

Auto-submitting instead -- having the extension press Enter so the user never
leaves the popup -- was considered and rejected. It fires only where the field is
in a real `<form>`, and a large share of otp widgets submit from a button
handler; where it does fire it risks a second submit of a single-use code on the
many sites that submit themselves; and `fillOtpField` is shared with the inline
menu, so it would have changed that too. `lib/content/fillField.ts` still
submits nothing, deliberately.

So: `entrypoints/remember` is a second extension page, framed into the page by
the content script in a closed shadow root, exactly like the autofill menu.
Bitwarden's notification bar is the reference for the mechanism -- **their
autofill source is GPL-3.0 and must not be read while working on this**, see the
note on `patterns.ts`. Theirs spans the top of the page; this is a fixed panel in
the top-right corner, because a full-width bar covers the page's own header,
which on a second-factor screen is usually what the user is looking at.

```
                    ┌──────────────────────────┐
                    │ Remember this site?     ×│
  page              │ GitHub is not listed for │
                    │ this site yet…           │
                    │ BaseDomain github.com    │
                    │ [  Remember this site  ] │
                    │ [       Not now        ] │
                    └──────────────────────────┘
```

Four rules hold it together.

- **It never takes focus.** The user is on their way to pressing Enter, and
  standing between them and that key is the whole problem this moved to fix. No
  autofocus in the page; Escape is handled by a capturing listener in the content
  script, not inside the iframe, because the keystroke lands on the page.
- **Both answers are sent.** `ANSWER_REMEMBER_OFFER` carries `remember: false`
  for a no, the ✕ and Escape, and the content script sends one on the 60s
  timeout. Silence would leave the offer pending and put the prompt back on the
  next page the tab loads. The offer is retired on a no, and on a yes **only
  once the write has landed** -- a failed write leaves the panel up saying so,
  and retiring it there would make its own button answer "expired" to a user who
  unlocked and tried again.
- **The token is the whole authorisation.** `remember.html` is web-accessible, so
  any site can frame it, and such a frame _is_ an extension context with a
  `sender.tab` -- the same threat `AutofillOfferRegistry` documents, with a
  sharper edge, because answering yes writes to the vault. `RememberOfferRegistry`
  mints a `crypto.randomUUID()` and `resolve` checks the tab as well as the token.
- **The prompt is told a label, a host, a matcher and a flag** -- never the
  entry id and never the page url. A token that leaked buys a question, not the
  makings of a different write.
- **Nothing in it says "this site".** It follows the tab across the redirect a
  login performs, so it is routinely drawn on a page it is not asking about.
  Every line names `pageHost` instead, and a page that `hostOf` cannot name
  honestly is not asked about at all.

**The matcher is for the page's host, never the frame that was filled.** A
matcher naming an embedded third party's origin would make `isTrustedFrame`'s
`entryClaimsFrame` branch true for that origin from then on, retiring the
`FillConfirm` question permanently -- one "fill it anyway" turned into a
standing trust grant. `RememberSite` says that out loud rather than leaving it
to be discovered.

The rule is `background/rememberSite.ts`: pure, beside `fillTarget.ts` for the
reason that file gives, and shaped like `isTrustedFrame` -- the vault question
(`entryClaimsPage`) is answered by the caller. It is called **twice**, and that
is the point. The answer carries a token and a boolean and nothing else; the
background re-derives the matcher and the site url with the same function that
built the offer, so what is written is what was shown.

The page url is frozen on the offer rather than re-read when the answer arrives,
because plenty of sites submit themselves the moment the code is complete: by
then, frame 0 is reporting the page _after_ login.

`VaultContainer.addSiteToEntry` appends the suggestion, while the popup editor
replaces the metadata the user edited. Both use favalib’s `updateEntry`, which
replaces the matcher list rather than merging into it; the encrypted save and
sync push both fall out of that call.

#### The offer outlives the page, and the worker

`RememberOfferRegistry` is the one registry here that is **not** in memory, and
that is the difference from `AutofillOfferRegistry` rather than an oversight. It
lives in `Db`'s `session:` area -- memory-backed, never on disk, wiped when the
browser closes, unreadable from content scripts, the same contract as the
unlocked session blob and `lib/drafts.ts`. Two reasons, and either alone would
be enough. The offer lives 60s and mv3 evicts the worker after ~30s idle, so an
in-memory offer would routinely be gone before its own buttons were pressed. And
pressing Enter navigates the page, which destroys the prompt.

That second one is why `REPORT_OTP_FIELDS` has a tail on it. When frame 0 reports
and a pending offer exists for that tab, the prompt goes back up. The re-show is
not awaited: the handler's answer is the selector list the reporting frame is
waiting on, and a prompt is not worth delaying that for.

**It follows the tab wherever it goes, host included**, and that is deliberate
rather than an oversight. Logging in routinely lands somewhere other than the
login domain -- an idp hands off to the app, an `accounts.` host redirects to a
bare one -- and those are exactly the entries with no matcher yet, which is the
case this whole feature exists for. A same-host guard was tried and switched the
feature off for precisely them. What makes it readable instead is the copy: the
prompt names the host it is asking about, so a panel drawn on a page it is not
about still says something true.

The one guard that remains is `shownOnUrl`, so an SPA re-reporting on every dom
change does not remount the prompt on the document it is already on.

It is dropped on a vault lock, from `VaultContainer.lock()` beside `clearDrafts()`
-- not from `handleMessage`, because `restoreSession()`'s failure path reaches
`lock()` without going through a message at all.

The one thing lost by moving off the popup: a page whose CSP refuses to frame an
extension resource gets no prompt, and the offer expires unanswered. The inline
menu has carried that same exposure since it shipped. The background logs a line
when nothing answers `SHOW_REMEMBER_PROMPT`, because from the user's side an
offer never shown and an offer never made look identical.

## Development commands

Run `make` from this directory (`packages/app-extension`). The Makefile — not
the `package.json` scripts — is the canonical entrypoint: it builds `favalib`
first and delegates installs to the repo root.

- `make lint` — `prettier --check`, `eslint`, `tsc --noEmit`. The feedback loop
  to use for checking your work.
- `make test` / `make test-watch` — vitest, in a `happy-dom` environment
  (`vitest.config.ts`). Tests live in `tests/`. `tests/ui/*.test.tsx` render the
  real components with React's own `act` and `react-dom/client` — there is no
  `@testing-library/react` in the workspace, and the container quarantines
  newly published npm releases for 7 days, so adding one is not a free choice.
  That is also why `vitest.config.ts` repeats the `@/` alias wxt generates for
  the build.
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

### The inline menu cannot work under `make dev` on Firefox

Verified on dash.bunny.net, Firefox, 2026-09-16: the menu mounts, is placed
correctly and its iframe fires `load`, and the panel is blank.

In dev mode WXT leaves the html entrypoints loading their modules from
`http://localhost:3000`. That is fine for the popup, whose top-level document
_is_ the extension. The menu is an extension document framed by a web page, so
its **top-level site is the page** — and Firefox's Local Network Access policy
auto-denies a request to loopback from a document whose top-level site is
public. Every module the menu needs is refused:

```
Local Network Access permission required: top-level site
"https://dash.bunny.net/...", initiator "moz-extension://<uuid>/menu.html#token=...",
attempting to access target "http://localhost:3000/entrypoints/menu/main.tsx"
... prompt action: auto_deny
```

Nothing on the content script's side can see this: the frame still fires `load`
for the blank document it was left with, and the violations are reported in the
_page's_ console, not the extension's.

So test the inline menu from a production build — `make dist/firefox`, then
about:debugging → Load Temporary Add-on → `.output/firefox-mv2/manifest.json` —
where every script is bundled into the extension and nothing reaches for
localhost. `make dev` remains fine for the popup, the background and detection.

**`remember.html` has exactly the same problem**, for exactly the same reason: it
is an extension document framed by a web page, so its top-level site is the page.
Under `make dev` on Firefox the prompt mounts, sizes itself from the estimate and
renders nothing. Test it from a production build too.

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
  it all of favalib — openpgp, jpake, zxcvbn. `lib/content/index.ts` used
  to take `Logger` and `bgActions` from it, and that alone put **2.7MB** of
  vault code into `content-scripts/content.js`, injected into every frame of
  every page. It imports `../classes/Logger` and `../state` directly for that
  reason; the content script is ~27kB. Check the build's size table after
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
- **A broadcast `tabs.sendMessage` returns one arbitrary frame's reply.** With
  no `frameId` the message reaches every frame, but only the first
  `sendResponse` is delivered. `GET_FILL_TARGET` therefore ignores what
  `detectOtpFields` hands back and reads the registry the reports fill instead.
  The `DetectOtpFieldsResponse` return type invites the opposite.
- **`DETECT_OTP_FIELDS` carries no `inputSelectors`, and must not grow any.**
  They are vault data derived from a url, and the background does not know a
  frame's url until that frame reports — so the only list it could put on a
  broadcast is the _tab's_, pushed into the isolated world of every third-party
  frame on the page. That is the leak matching against the frame's own url
  exists to prevent. Each frame already holds the selectors it was given for
  its own url.
- **`observer.rescan()` answers an unchanged page with silence**, because its
  only output is `onChange` and a form that re-renders per keystroke would
  otherwise spam the background. That is exactly the answer the background
  cannot use when its registry is empty, which is what `scanNow()` is for — and
  it goes through the observer rather than calling `detectOtpFields` beside it,
  so the selectors and the fingerprint keep one owner.
- **A rescan replaces every handle object, so an open menu has to be pointed
  at the new one** (`AutofillMenu.retarget`) rather than closed. Ids survive —
  they live in a `WeakMap` keyed on the field's first element, so an element
  still in the page keeps its id — which is what makes following it possible,
  and an id that has gone means the element was replaced rather than
  re-reported. Re-anchoring also keeps `onFocusOut`'s identity check
  (`handleForElement(active) === openFor`) true; without it a rescan while the
  menu is up makes the next focus event look like focus leaving the field.
- **`web_accessible_resources` lists two pages**, `menu.html` and
  `remember.html`, and both are framed into arbitrary sites by the content
  script. Anything added here can be framed by any page and answers as an
  extension context, so it needs a token-gated story of its own before it goes
  on the list.
- **`web_accessible_resources` must be written in the mv3 object form.** wxt
  flattens it to mv2's plain string array for the Firefox build and throws
  outright if you write the string form yourself. `use_dynamic_url` is
  deliberately _not_ set — see the comment in `wxt.config.ts`.
- `content_security_policy.extension_pages` carries `'wasm-unsafe-eval'`
  because favalib derives the vault key with argon2id from `hash-wasm`, which
  instantiates a WebAssembly module. It runs on **every** unlock, so without
  this nothing unlocks, in the popup or the background. It permits no `eval()`
  and no remote script — it is specifically the wasm carve-out.
- The background bundle is ~2.5MB and that is expected: rolldown inlines every
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
  access from `matches`. `permissions` is `['storage', 'activeTab']`, and the
  `matches` patterns are **not** part of it: they never reach
  `browser.permissions.getAll()`, and they do not unlock the privileged `tabs`
  properties. See "The popup can only match what the browser will name".
- **Do not call `browser.permissions.request` from `onInstalled`.** The
  starter did, asking for `<all_urls>` on Firefox, and it threw
  "permissions.request may only be called from a user input handler" on every
  install; `onInstalled` is not a user gesture. It would have failed a second
  time regardless, since a permission must appear in `optional_permissions`
  (mv2) / `optional_host_permissions` (mv3) to be requestable, and this
  manifest declares neither. Nothing needs it: `activeTab` is a required
  permission, granted on the gesture that opens the popup, so it needs no
  request, no user-input handler and no `optional_permissions` entry — and it
  keeps working through a move to Firefox mv3, where host access becomes
  opt-in and a host permission would need a real request from a click in the
  popup.
