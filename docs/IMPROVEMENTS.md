# Improvements & open decisions

Follow-ups from the 2026-07-07 code review. The high/medium findings were fixed
in `7d22c9e` and the low-severity cleanups in `1157d83`. Ordered by what most
improves developer experience — for people *using* the package first, for
people *working on* the repo second, with the remaining behavior/robustness
notes at the end.

## DX: API ergonomics

### 1. `getInputProps()` prop-getter ✅ implemented 2026-07-07

The README's first example needs a cast and five lines of wiring:

```tsx
<textarea
  ref={rime.inputRef as React.RefObject<HTMLTextAreaElement>}
  value={rime.text}
  onChange={(e) => rime.setText(e.target.value)}
  onKeyDown={rime.onKeyDown}
  onKeyUp={rime.onKeyUp}
/>
```

A downshift-style prop-getter collapses that to `<textarea {...rime.getInputProps()} />`
— no cast, nothing to forget, and consumer overrides can be merged
(`getInputProps({ onKeyDown })`). Alternatively (or additionally) make the
hook generic — `useRime<HTMLTextAreaElement>()` — so `inputRef` types
correctly without a cast. This is the single highest-leverage API change.

### 2. Semantic composition actions ✅ implemented 2026-07-07

A custom candidate UI can `selectCandidate(i)` and `changePage()`, but there is
no way to *cancel* a composition or commit the highlighted candidate without
synthesizing a fake `KeyboardEvent`. Add thin wrappers over the engine's key
protocol:

- `cancelComposition()` → `process('{Escape}')`
- `commitHighlighted()` → `process(' ')` (or select at `highlighted`)
- `commitRaw()` → commit the preedit as typed (Enter behavior)
- `highlightNext()` / `highlightPrev()` → arrow keys

Each is ~3 lines, and together they make the hook genuinely headless: a
pointer-driven UI (mobile toolbar, mouse-only picker) needs zero keyboard
event fabrication.

### 3. Typed schema ids ✅ implemented 2026-07-09

`schema: 'luna_pinyin'` is a bare string; consumers can't discover valid ids
without opening `schemas.json`. Generate a union type from it
(`type SchemaId = 'luna_pinyin' | 'double_pinyin' | …`), type
`UseRimeOptions['schema']` as `SchemaId | (string & {})` so custom schemas
still pass, and export the list as a value (`SCHEMA_IDS`). Autocomplete on the
main option is a big first-run win.

### 4. Stable function identities ✅ implemented 2026-07-09

`useImeControl` returns a fresh object and fresh toggle closures every render,
which cascades into `onKeyDown`/`onKeyUp`/`analyze` being rebuilt per render.
Consumers can't memoize components receiving them, and any effect depending on
a returned function re-fires each render. Restructure with `useCallback` +
refs for volatile values (useEvent pattern). This was deferred from the review
as "not a correctness bug" — but it's really a DX item: it's the difference
between a hook people fight and one that behaves like the ecosystem expects.

### 5. Dev-mode warnings ✅ implemented 2026-07-09

Cheap `console.warn`s behind `process.env.NODE_ENV !== 'production'`:

- committed text arrived but `inputRef` was never attached (silent append mode)
- the bound element's `value` has drifted from `rime.text` (consumer forgot
  `value={rime.text}` / `onChange`)
- `schema` option isn't in the bundled metadata (typo vs. custom schema)
- `useRime` options object identity changes every render *and* `workerUrl`
  changed (engine is being torn down/recreated unintentionally)

These convert the four most likely integration mistakes from "it silently
half-works" into a one-line explanation.

## DX: documentation

### 6. Document the schemas you ship ✅ implemented 2026-07-09 (docs/SCHEMAS.md)

Nothing lists what's actually available. A README (or docs/) table generated
from `schemas.json` — id, name, group, variants, extended-charset support —
plus one sentence on what each family *is* (Pinyin vs. double Pinyin vs. Wubi
vs. Cangjie…). This is the #1 question every consumer has in minute two.

### 7. Keyboard behavior reference ✅ implemented 2026-07-09 (README)

A table of what keys mean *while composing*: Space commits highlighted, digits
select by label, `-`/`=` and PageUp/Down page, arrows move highlight/cursor,
Escape cancels, Enter commits raw input, shift-tap toggles English, F4 /
Ctrl+` opens the schema menu. None of this is written down anywhere — it's
inherited RIME behavior the consumer's users will hit immediately, and the
consumer needs it to build help UI.

### 8. Lifecycle & performance expectations ✅ implemented 2026-07-09 (README)

Document the load story: what `loading`/`ready`/`error` mean, that first use
streams ~3.5 MB core + per-schema dictionaries from jsdelivr, that everything
caches in IndexedDB (second load is offline-capable), that the first keystroke
after a schema switch can lag while a dictionary streams in. Also which
settings persist to localStorage (and the my-rime key-sharing described in
§14).

### 9. Cookbook recipes ✅ implemented 2026-07-09 (docs/RECIPES.md; `getCaretRect` helper not shipped)

Short, copy-pasteable:

- **Candidate panel at the caret** — the `textarea-caret` coordinates trick
  (upstream does this; it's the hardest part of a real IME UI). Consider
  shipping a tiny `getCaretRect(el)` helper instead of only documenting it.
- **Next.js / SSR** — hooks render safely server-side now; show the
  `'use client'` + dynamic-import pattern and note `ready` is always false on
  the server.
- **Custom candidate UI** — a full headless example beyond the README's
  10-liner (highlight styling, paging, comments/emoji handling via
  `hideComment`).
- **CSP requirements** — the default setup needs `worker-src blob:` and
  `connect-src https://cdn.jsdelivr.net`; self-hosting changes both. Nobody
  will figure this out from the error messages.

### 10. Generated API reference

Every public symbol already carries JSDoc (the README table says "selected"
because the full surface is ~30 fields). TypeDoc (or typedoc-plugin-markdown
into docs/) turns the existing comments into a complete reference for free —
the writing is already done.

### 11. Live demo

Deploy `example/dist` to GitHub Pages via Actions and link it from the README.
For a *text-input* library, trying it in 5 seconds beats any amount of prose;
it's also the strongest "does this actually work" signal for evaluators.

### 12. CHANGELOG.md ✅ implemented 2026-07-09

Even a hand-maintained one. The review just changed key-handling behavior in
ways an early adopter would want called out (`toRimeKey` signature, Control
combos now forwarded while composing, `main` field removed).

## DX: contributing to the repo

### 13. HMR dev loop for the example ✅ implemented 2026-07-07

`example` consumes `react-rime` from the built `dist`, so the contributor loop
is edit → `npm run build` → refresh (the review itself got bitten by a stale
build). Alias the package to source in dev:

```ts
// example/vite.config.ts
resolve: { alias: { 'react-rime': path.resolve(__dirname, '../src/index.ts') } }
```

(dev only — keep prod builds consuming `dist` so the smoke test exercises the
real artifact). Instant HMR against library source.

### 14. Root `npm run smoke` ✅ implemented 2026-07-07

Running the real-WASM test today means knowing to build the lib, then the
example, then `npx playwright test` from `example/`. One root script that does
the chain (`npm run build && npm --prefix example run build && npm --prefix
example exec playwright test`) makes the most valuable test in the repo
one command.

### 15. `update-worker` script ✅ implemented 2026-07-07 (CI hook still pending)

Bumping the engine requires editing `DEFAULT_WORKER_URL` *and* re-vendoring
`src/assets/worker.js` in lockstep (currently enforced by a comment). A script
that takes a version, downloads the CDN worker, writes both, and diffs —
plus a CI check that the vendored file byte-matches the pinned URL — turns the
comment into a guarantee.

### 16. ESLint ✅ implemented 2026-07-09

The source carries `eslint-disable react-hooks/exhaustive-deps` comments but
no ESLint exists, so nothing checks the other hooks rules. `eslint` +
`eslint-plugin-react-hooks` would catch dep-array drift — the exact bug class
behind the stale-`ime` finding.

### 17. Tests where the review found bugs ✅ partially 2026-07-09 (useImeControl unit tests + SSR test; smoke-test coverage of schema switching/shift-tap and CI still pending)

`useImeControl` has no direct tests (schema-switch option re-sync,
`syncOptions`, variant cycling); an SSR test (`renderToString` under a node
environment) would lock in the `navigator` fix; the smoke test could cover
schema switching and shift-tap. Plus CI (typecheck + unit on PR; smoke as a
scheduled job since it needs jsdelivr).

## Open behavior decisions (deferred from the review)

### 18. localStorage keys are unprefixed and shared with my-rime

`full_shape`, `extended_charset`, `ascii_punct`, `emoji_suggestion` — the
exact keys the my-rime PWA uses, collidable by anything on the origin.
Prefixing breaks existing users' saved settings and any intentional sharing.
Options: prefix with a one-time legacy-key migration; document sharing as a
feature; or add a `storage`/`persist: false` option so consumers own
persistence (also fixes two `useRime` instances overwriting each other).

### 19. Components: keep or cut

If kept: a11y work (`role="listbox"`, `aria-activedescendant`, focus
management) and possibly a `react-rime/components` subpath so the core stays
lean. If cut: fold the `data-rime-*` conventions into README recipes.

## Robustness backlog (lower priority)

- **Multiple inputs per provider**: two `RimeTextarea`s under one
  `RimeProvider` share one `inputRef`; the last-mounted wins and commits land
  in it regardless of focus. Track the focused element or document
  one-input-per-provider.
- **Android/mobile**: upstream's Android Chromium handling (`Unidentified`
  keydowns reconstructed from `input` events) was not ported; the hook is
  desktop-keyboard-only. Port it or document the limitation.
- **Startup timeout/progress/retry**: first load can hang on slow networks
  with no signal beyond `loading: true`; no retry path.
- **Typed deploy status** instead of raw `'success'`/`'failure'` strings.
- **Air-gapped worker**: bundled worker is my_rime's CDN build; true
  self-hosting needs a location-relative worker build (vendor one as
  `react-rime/worker-local.js`, or add an `assetsUrl` control message
  upstream).
- **Bring-your-own-engine / custom schemas**: accept an external `RimeEngine`
  and user-supplied schema metadata so `FS` + `deploy()` schemas get
  variants/labels (the review's guards made unknown ids *safe*, not *good*).
- **package.json metadata**: `repository`
  (`https://github.com/zrisha/react-rime`), `homepage`, `bugs`,
  `publishConfig.provenance`.

## Explicitly considered and rejected

- **Bundle-size work on `schemas.json`** — 5.6 KB raw (dist/index.js ~30 KB
  total). Not worth lazy-loading.
- **Default worker pooling across `useRime` instances** — shared engines mean
  shared composition/options state, which the per-instance factory exists to
  avoid; bring-your-own-engine covers the legitimate cases.
