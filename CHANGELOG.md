# Changelog

## 0.1.0 (unreleased)

Initial release: headless React hooks for the RIME input-method engine
(WASM), extracted from [my_rime](https://github.com/LibreService/my_rime).

Notable decisions made during pre-release review, called out for anyone
tracking the repo:

- **Key handling** — outside a composition, only printable keys, `F4`, and
  `` Ctrl+` `` reach the engine; editing/navigation keys and OS shortcuts keep
  their native behavior. While composing, all combos (including `Ctrl+x`) are
  forwarded to RIME, matching upstream my_rime. `toRimeKey` gained a
  `composing` parameter (defaults to `true`, the old translate-everything
  behavior).
- **Bare Shift tap** toggles English mode (the standard IME gesture).
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
- **Self-hosting clarification** — `react-rime/worker.js` can be self-hosted,
  but it still streams engine binaries and dictionaries from jsdelivr;
  air-gapped deployment is not yet supported.
