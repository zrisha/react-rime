# Changelog

## 0.1.0 (unreleased)

Initial release: headless React hooks for the RIME input-method engine
(WASM), extracted from [my_rime](https://github.com/LibreService/my_rime).

Notable decisions made during pre-release review, called out for anyone
tracking the repo:

- **Key handling** — outside a composition, only printable keys reach the
  engine; editing/navigation keys and OS shortcuts keep their native behavior.
  While composing, all combos (including `Ctrl+x`) are forwarded to RIME,
  matching upstream my_rime. `toRimeKey` gained a `composing` parameter
  (defaults to `true`, the old translate-everything behavior).
- **`F4` (schema menu) and `` Ctrl+` `` are opt-in** — `useRime({
  enableSchemaMenu, enableControlBacktick })`, both default `false`. Neither
  is discoverable to end users, and `` Ctrl+` `` in particular collides with
  common host-app bindings (e.g. VS Code's terminal toggle), so my_rime's
  always-on behavior isn't a safe default for an embeddable library.
- **Bare Shift tap** toggles English mode, but only when `useRime({
  enableShiftToggle: true })` — same reasoning as `F4`/`` Ctrl+` ``: it's a
  standard IME gesture but not an obvious one, and easy to trigger by
  accident. Default `false`.
- **ESM-only package** — the `main` field was removed; use `import`.
- **Hooks-only: the unstyled components were removed** (`RimeTextarea`,
  `CandidatePanel`, `SchemaSelector`). `getInputProps()` makes them
  one-liners to hand-roll, and keeping them meant owning an a11y surface the
  headless API doesn't have — see docs/RECIPES.md for equivalents.
  `RimeProvider` / `useRimeContext` (engine sharing) remain.
- **`react-dom` peer dependency dropped** (never used).
- **Stable identities** — every function returned by `useRime` /
  `useImeControl` keeps one identity for the component's lifetime; the
  returned objects are memoized.
- **New API** — `getInputProps()`, `cancelComposition()`,
  `commitHighlighted()`, `commitRaw()`, `highlightNext()`, `highlightPrev()`,
  `SCHEMA_IDS` / `SchemaId`.
- **`useRime({ pageSize })`** — sets candidates-per-page, kept in sync with
  `RimeEngine.setPageSize` on change, instead of requiring a custom
  `createRimeEngine` integration to reach it. Setting it back to `undefined`
  restores the schema's own default: the engine treats page size 0 as "unset"
  (my_rime's librime patch falls back to the schema's `menu/page_size`), so
  the library never hardcodes librime's 5.
- **Generic option escape hatch** — `rime.setOption(name, value)` and
  `rime.options` (tracked values, keyed by librime option name) on both
  `useRime` and `useImeControl`. Any librime boolean option is now reachable
  without a new named wrapper; the five named toggles stay as convenience.
  Internally the wrapped options are driven from one `RIME_OPTIONS` table, so
  adding one is a single row.
- **`ime` and `showVariant` now surface on `useRime`** — previously only on
  `useImeControl`, silently dropped in the re-export (same class of gap as
  `pageSize`). The re-export is now a spread, so `ImeControl` fields can't fall
  through it again.
- **`setSchema` now clears the composition** — `engine.setIME` resets the
  librime session, so a preedit started under the old schema was already dead
  in the engine but stayed on screen, showing candidates that did nothing,
  until some later interaction (e.g. paging) happened to clear it.
- **`useRime({ userDict: false })` and `rime.clearLearned()`** — librime learns
  from every commit into a per-schema `*.userdb`, persisted to IndexedDB, which
  re-ranks later candidates and stores whole composed sentences. There was no
  way to turn that off or clear it: it's schema *config* (`enable_user_dict`),
  not a runtime switch, so `setOption` can't reach it, and a `*.custom.yaml`
  patch is inert here because my_rime ships **compiled** schemas straight into
  the build directory and skips librime's build step. What does work: the file
  librime reads at activation is the plain YAML in that directory, so the
  library rewrites it through the worker's FS and re-selects the schema
  (`set_ime` recreates the session and re-reads the config — no deploy, no
  wasm rebuild). Applied per schema on activation, so it survives schema
  switches. Every dict-backed translator namespace is disabled, not just
  `translator`: reverse-lookup namespaces open their own user dictionaries
  (jyut6ping3 has four, array30 three). Namespaces on a read-only `db_class`
  (`custom_phrase`) are deliberately left alone — those are author-supplied
  phrase lists, not learned text. `clearLearned()` deletes the databases while
  leaving consumer-deployed files intact, unlike `resetUserDirectory()`.
  Verified against real librime for luna_pinyin, jyut6ping3, array30, wubi86
  and cangjie5.
- **Self-hosting clarification** — `react-rime/worker.js` can be self-hosted,
  but it still streams engine binaries and dictionaries from jsdelivr;
  air-gapped deployment is not yet supported.
