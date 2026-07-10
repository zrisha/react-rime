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
- **`react-dom` peer dependency dropped** (never used).
- **Stable identities** — every function returned by `useRime` /
  `useImeControl` keeps one identity for the component's lifetime; the
  returned objects are memoized.
- **New API** — `getInputProps()`, `cancelComposition()`,
  `commitHighlighted()`, `commitRaw()`, `highlightNext()`, `highlightPrev()`,
  `SCHEMA_IDS` / `SchemaId`.
- **Self-hosting clarification** — `react-rime/worker.js` can be self-hosted,
  but it still streams engine binaries and dictionaries from jsdelivr;
  air-gapped deployment is not yet supported.
