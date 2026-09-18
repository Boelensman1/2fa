import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // Browsers hide dot-directories in their "load unpacked extension"
  // picker, so `make dev` points this at a visible directory instead.
  // Production builds and zips are never loaded that way and stay in
  // .output. `||` rather than `??` on purpose: an empty WXT_OUT_DIR must
  // fall back too, since it would otherwise resolve the output directory to
  // the project root.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  outDir: process.env.WXT_OUT_DIR || '.output',
  manifest: ({ browser }) => ({
    // The user-facing name, shown on the extensions page, in the extensions
    // menu and in the install prompt. `favabrowserext` stays the name of the
    // package, the directory and the zip artifacts; neither is the extension
    // id, which the browser derives from the signing key.
    name: 'Fava',
    permissions: ['storage', 'activeTab'],
    // favalib derives the vault key with argon2id from `hash-wasm`, which
    // instantiates a WebAssembly module. mv3's default page csp allows
    // script-src 'self' only, and compiling wasm needs 'wasm-unsafe-eval' on
    // top of it -- without this every unlock fails with a csp violation, in
    // the popup and in the background alike. It does not permit eval() or
    // remote script; it is specifically the wasm carve-out.
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    // `activeTab` is what lets the popup read `Tab.url` for the tab it was
    // opened over, and it is read for exactly one thing: grouping the entries
    // that claim this site above the rest of the vault.
    //
    // It is not optional plumbing. `tabs.query()` answers whatever the
    // permissions are, but the browser *scrubs* `url`, `title` and
    // `favIconUrl` off the `Tab` unless the extension holds `tabs`,
    // `activeTab`, or host access for that url -- and a content script's
    // `matches` is none of those. `matches` grants the script injection and
    // its own host access; it grants the extension apis nothing. Verified on
    // Firefox mv2 with `permissions: ['storage']`: `browser.permissions
    // .getAll()` answers `origins: []` despite `matches: ['<all_urls>']`, and
    // `tabs.query` returns a `Tab` with an `id` and no `url`. Without this the
    // popup passes `null` to `LIST_ENTRIES`, `forSite` is empty on every site,
    // and the "For this site" group silently never renders -- on both builds,
    // not just Chrome.
    //
    // `activeTab` and not the alternatives:
    // - `tabs` would answer the same question at the price of a permanent
    //   "Read your browsing history" warning on both stores, for every tab,
    //   forever. This manifest declares `data_collection_permissions:
    //   { required: ['none'] }` a few lines down; that would read oddly next
    //   to it.
    // - `host_permissions: ['<all_urls>']` is worse -- "Read and change all
    //   your data on all websites" -- and grants far more than reading a url.
    //   It also diverges across the builds: granted at install on mv2, but
    //   opt-in under Firefox mv3, so the migration the last gotcha in
    //   AGENTS.md anticipates would switch this feature back off for every
    //   existing user with nothing to see. `activeTab` survives that move.
    //
    // It carries no install warning, it is granted by the click that opens the
    // popup, and it lapses when that tab navigates -- all fine for a value
    // read once, in an effect, at popup open. It grants nothing on restricted
    // pages (`about:`, `chrome://`, the add-on and extension galleries), which
    // never had an http(s) url to match on anyway.
    // The two pages the content script iframes into a closed shadow root on
    // the page: the inline autofill menu, and the "remember this site?" prompt
    // that follows a fill. Framing them needs the page to be allowed to load
    // them -- that is what web_accessible_resources grants.
    //
    // Must be the mv3 object form. wxt flattens it to mv2's plain string array
    // for the Firefox build, and throws outright if you write the string form
    // yourself. The path is the *output* name: `entrypoints/menu/index.html`
    // is emitted as `menu.html` at the extension root.
    //
    // Deliberately *without* `use_dynamic_url`. It would rotate the url per
    // session on Chrome, where the extension id is fixed and public, so a page
    // could otherwise probe `chrome-extension://<id>/menu.html` to detect that
    // Fava is installed. Two reasons not to: its interaction with
    // `runtime.getURL` and with `runtime.sendMessage` from the resulting
    // document has to be confirmed in a real Chrome before it can be relied
    // on, and getting it wrong means the menu never loads at all. And there is
    // nothing yet to protect -- `window.favaExtLoaded`, set by the content
    // script on every page, already announces the extension to anyone looking.
    // Worth revisiting together with that global, not before.
    //
    // Framing either page is not itself an attack: both render nothing without
    // an offer token, which is unguessable and scoped to one tab, and both of
    // the actions they can send are gated on one. See `AutofillOfferRegistry`
    // and `RememberOfferRegistry` -- the second matters more, because the
    // question it guards is answered by a write into the vault.
    web_accessible_resources: [
      { resources: ['menu.html', 'remember.html'], matches: ['<all_urls>'] },
    ],
    // Firefox only. Chrome treats browser_specific_settings as an
    // unrecognised key, and a manifest that ships keys the target browser does
    // not know is noise a web store reviewer has to ask about.
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          // Permanent: this is the add-on's identity on addons.mozilla.org,
          // and changing it after publishing makes it a different add-on that
          // existing users do not get as an update. Required outright for mv3
          // on Firefox, recommended for mv2. Chrome derives its own id from
          // the signing key and ignores this.
          id: 'fava@appeal.nl',
          // Required for new Firefox extensions from 2025-11-03. A vault
          // client that talks only to the user's own sync server collects
          // nothing, and `none` is how you say so explicitly -- a stronger
          // claim to a reviewer, and to the user reading the install prompt,
          // than suppressing the warning would be.
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
  zip: {
    // Pinned rather than left to the defaults, which carry the package version
    // and, since wxt started emitting a sources zip alongside, no longer match
    // a single file. The Makefile moves these by exact name; a glob over
    // `.output/*.zip` picked up both the sources zip and whatever the previous
    // browser's build left behind.
    artifactTemplate: '{{browser}}.zip',
    sourcesTemplate: '{{browser}}-sources.zip',
    // wxt's sources zip holds this package only. That cannot build: it is a
    // pnpm workspace member and needs the repo root's lockfile, workspace file
    // and packages/lib. Handing it to Mozilla would give a reviewer something
    // that fails to build. `artifacts/favabrowserext.firefox.source.zip`
    // clones the whole monorepo and is the one to upload.
    zipSources: false,
  },
})
