# Improvements & open decisions

Follow-ups from the 2026-07-07 code review. The high/medium findings were fixed
in `7d22c9e` and the low-severity cleanups in `1157d83`; everything below is
deliberately *not* done yet — either it changes behavior and needs a decision,
or it's an enhancement rather than a fix.

## Deferred from the review (behavior decisions needed)

### 1. localStorage keys are unprefixed and shared with my-rime

`useSavedBoolean` persists under `full_shape`, `extended_charset`,
`ascii_punct`, `emoji_suggestion` — the exact keys the my-rime PWA uses. Any
other code on the same origin can collide with them, but prefixing (e.g.
`react-rime:full_shape`) would silently drop settings for anyone who already
has state under the old keys, and would stop sharing settings with an embedded
my-rime instance if that sharing is intentional.

**Decision needed:** prefix (with a one-time migration read of the legacy
keys), or document the sharing as a feature. A third option: accept a
`storage` option (or `persist: false`) so consumers control persistence
entirely — also fixes multiple independent `useRime` instances on one origin
overwriting each other's settings.

### 2. Unstable function identities from the hooks

`useImeControl` returns a fresh object every render, and `makeToggle`
recreates `changeLanguage`/`changeWidth`/etc. each time. That cascades:
`analyze`, `input`, `onKeyDown`, `onKeyUp` in `useRime` are rebuilt per
render, so consumers can't usefully memoize components that receive them, and
effect deps on any returned function re-fire every render. Fixing it properly
means restructuring `useImeControl` (wrap toggles in `useCallback`, memoize
the returned object, or hold volatile values in refs, useEvent-style). Not a
correctness bug — just churn — but it's the main thing standing between the
hook and "well-behaved React citizen".

## Correctness / robustness ideas

- **Multiple inputs per provider are quietly broken.** `RimeProvider` shares
  one `useRime` — and therefore one `inputRef` — so if two `RimeTextarea`s sit
  under one provider, the last-mounted one owns the ref and commits land in
  it regardless of which was focused. Either track the focused element
  (listen for `focusin` on registered inputs) or document
  one-input-per-provider as a hard rule.
- **Android/mobile keyboards don't work.** Upstream my_rime has dedicated
  Android Chromium handling (keydown arrives as `Unidentified`, composition
  reconstructed from `input` events — see `MyPanel.vue`'s
  "code specific to Android Chromium" blocks). The port dropped all of it, so
  the hook is desktop-keyboard-only today. Port that block or document the
  limitation.
- **No timeout/progress on engine startup.** First load streams ~3.5 MB of
  WASM + dictionaries; `createRimeEngine`'s fetch and the initial `setIME`
  can hang for a long time on a slow network with no signal to the UI beyond
  `loading: true`. Ideas: expose download progress (the worker would need a
  control message), a configurable timeout that rejects into `error`, and a
  `retry()` action.
- **Typed deploy status.** `onDeployStatus(handler: (status: string, ...))`
  passes raw strings ("start"/"success"/"failure"). A union type would let
  consumers switch on it safely.
- **Cross-tab settings sync.** The saved booleans don't listen for `storage`
  events; two tabs drift. Cheap to add if persistence stays in localStorage.

## API ideas

- **Air-gapped support (the real fix).** The bundled worker is my_rime's CDN
  build; engine binaries always come from jsdelivr. Options, roughly in order
  of effort: (a) vendor a second, location-relative worker build from my_rime
  (built with its CDN flag unset) and ship it as
  `react-rime/worker-local.js`; (b) add an `assetsUrl` engine option passed
  to the worker via a control message (needs an upstream worker change);
  (c) document a recipe for building the worker from my_rime source.
- **Bring-your-own-engine.** `useRime` always creates its own engine. An
  `engine` option accepting a `RimeEngine` (from `createRimeEngine`) would
  enable sharing one worker across hooks, custom FS setup before first use,
  and testing without module mocks.
- **Custom schemas end-to-end.** The engine exposes `FS`, `deploy()`, and
  `resetUserDirectory`, but `useRime` doesn't surface them, and
  `buildSchemaMetadata` only knows the bundled `schemas.json`, so a custom
  schema gets no variants/labels (the guards added in the review make it
  *safe*, not *good*). Accept user-supplied schema metadata
  (`schemas` option) and re-export the deploy flow from the hook.
- **Fully-controlled text mode.** The hook owns the committed-text buffer;
  `setText` + caret-insert via `inputRef` is convenient but awkward for rich
  editors (contenteditable, CodeMirror, Slate) that own their document. A
  mode where the hook manages only composition and fires `onCommit` — no
  `text`, no `inputRef` writes — would make it genuinely headless. (Most of
  this exists already: `insert()` is the only coupling.)
- **Expose `setPageSize`.** The engine supports it; the hook doesn't. One
  option + one effect.
- **Caret-positioning helper.** Consumers building an at-caret candidate
  popup all need caret coordinates in a textarea (upstream uses the
  `textarea-caret` trick). A small `getCaretRect(el)` export — or a
  documented recipe — removes the hardest part of building a real IME UI.
- **Components: keep or cut.** If kept: they need a11y work
  (`role="listbox"`/`option`, `aria-activedescendant`, keyboard focus
  management) and could move to a `react-rime/components` subpath export so
  the core stays lean. If cut: fold the `data-rime-*` conventions into README
  recipes instead.

## Packaging / infra ideas

- **CI.** No workflows exist. A minimal GitHub Actions matrix: typecheck +
  unit tests on PR; the Playwright smoke (needs jsdelivr network) as a
  scheduled/manual job. Cache the engine assets between runs if flakiness
  from CDN fetches shows up.
- **Worker lockstep check.** `DEFAULT_WORKER_URL` pins
  `@libreservice/my-rime@0.10.9` and `src/assets/worker.js` must be the same
  file; nothing enforces that. A tiny script (fetch the CDN URL, byte-compare
  against the vendored copy) run in CI or `prepublishOnly` turns the comment
  into a guarantee.
- **package.json metadata.** Missing `repository`
  (`https://github.com/zrisha/react-rime`), `homepage`, and `bugs` — npm
  displays these. Consider `publishConfig.provenance` for npm provenance.
- **ESLint isn't actually configured.** The source carries
  `eslint-disable react-hooks/exhaustive-deps` comments but there's no ESLint
  setup, so nothing checks the *other* hooks rules. Adding
  `eslint` + `eslint-plugin-react-hooks` would catch dep-array drift — the
  exact bug class behind the stale-`ime` finding.
- **More test coverage where the bugs were.** `useImeControl` has no direct
  tests (schema switch re-sync, `syncOptions`, variant cycling); an SSR test
  (`renderToString` in a node environment) would lock in the `navigator`
  fix; smoke-test schema switching and shift-tap against the real engine.
- **SSR docs.** The hooks now render safely on the server, but the README
  says nothing about Next.js usage (the engine still only *loads* in the
  browser; `ready` stays false server-side). A short "SSR / Next.js" section
  would preempt the most likely issue reports.

## Explicitly considered and rejected

- **Bundle-size work on `schemas.json`** — it's 5.6 KB raw (dist/index.js is
  ~30 KB total). Not worth lazy-loading.
- **Worker pooling/reuse across `useRime` instances by default** — sharing
  state (composition, options) across independent engines is exactly what the
  per-instance factory was built to avoid; bring-your-own-engine (above)
  covers the legitimate cases.
