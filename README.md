# react-rime

Headless React hooks for the [RIME](https://rime.im/) input-method engine
(compiled to WebAssembly). Import it and build your own Chinese text-entry UI —
Pinyin, Wubi, Cangjie, Bopomofo, and dozens of other schemas — with no server
and no manual asset wiring.

`react-rime` extracts the engine and control logic from
[my-rime](https://github.com/LibreService/my_rime) — the Chinese-input PWA
this is ported from — into a standalone, headless library: same WASM engine
and behavior, no UI included. The hooks are the whole API; a few optional,
fully-unstyled components are provided for a faster start.

```bash
npm install react-rime
```

> Requires React 17+ and a browser (the engine runs in a Web Worker).
> The package is ESM-only.

## Quick start

The entire engine is one hook. Wire its key handlers to any input element and
render the candidate state however you like:

```tsx
import { useRime } from 'react-rime'

export function Editor() {
  const rime = useRime() // defaults to luna_pinyin (朙月拼音)

  return (
    <div>
      <textarea {...rime.getInputProps()} disabled={!rime.ready} />

      {rime.composing && (
        <ul>
          {rime.candidates.map((c, i) => (
            <li key={i}>
              <button onClick={() => rime.selectCandidate(i)}>
                {rime.selectLabels?.[i] ?? i + 1}. {c.text}
                {c.comment ? ` ${c.comment}` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

## With the optional components

The same thing, less boilerplate. The components render unstyled elements with
`data-rime-*` attributes you can target in CSS:

```tsx
import { useRime, RimeTextarea, CandidatePanel, SchemaSelector } from 'react-rime'

export function Editor() {
  const rime = useRime()
  return (
    <>
      <SchemaSelector rime={rime} />
      <RimeTextarea rime={rime} rows={6} />
      <CandidatePanel rime={rime} />
    </>
  )
}
```

Prefer context over prop-drilling? Wrap once and drop the `rime` prop:

```tsx
import { RimeProvider, RimeTextarea, CandidatePanel } from 'react-rime'

<RimeProvider schema="wubi86">
  <RimeTextarea rows={6} />
  <CandidatePanel />
</RimeProvider>
```

## `useRime(options)`

### Options

| Option        | Type     | Default        | Description                                  |
| ------------- | -------- | -------------- | -------------------------------------------- |
| `schema`      | string   | `luna_pinyin`  | Initial schema id (see `DEFAULT_SCHEMA_ID`). |
| `workerUrl`   | string   | jsdelivr CDN   | Override the worker script (see Assets).     |
| `defaultText` | string   | `''`           | Initial committed-text buffer.               |
| `onCommit`    | function | —              | Called with each committed string.           |

### Returned state & actions (selected)

| Field                     | Description                                            |
| ------------------------- | ----------------------------------------------------- |
| `ready` / `loading`       | Engine readiness and busy state.                      |
| `error`                   | `Error` if the worker/engine failed to load.          |
| `text` / `setText`        | The committed-text buffer (controlled).               |
| `composing`               | Whether a composition is in progress.                 |
| `preedit`                 | `{ head, body, tail }` of the preedit string.         |
| `candidates`              | `{ text, comment? }[]` for the current page.          |
| `highlighted`             | Index of the highlighted candidate.                   |
| `selectLabels`            | Selection labels (e.g. `1`–`9`), if provided.         |
| `page` / `isLastPage`     | Candidate paging state.                               |
| `getInputProps()`         | One spread wires an input: ref, value, key handlers.  |
| `inputRef`                | Attach to your input/textarea for caret-aware commit. |
| `onKeyDown` / `onKeyUp`   | Forward your element's key events here.                |
| `selectCandidate(i)`      | Commit the candidate at index `i`.                    |
| `changePage(backward)`    | Page through candidates.                              |
| `cancelComposition()`     | Discard the preedit (Escape), no KeyboardEvent needed. |
| `commitHighlighted()` / `commitRaw()` | Commit the highlighted candidate / the raw preedit. |
| `highlightNext()` / `highlightPrev()` | Move the candidate highlight.             |
| `schema` / `setSchema(id)`| Active schema and switcher.                           |
| `schemas`                 | Grouped options for a schema `<select>`.              |
| `changeLanguage()`        | Toggle ASCII (English) mode.                          |
| `variant` / `changeVariant()` | Script variant (e.g. 简/繁) and cycler.           |

Everything the components do is available here — you never have to use them.

## Assets & offline use

The heavy engine artifacts are large (≈3.5 MB core + per-schema dictionaries),
so by default `react-rime` streams them from jsdelivr and caches them offline in
IndexedDB — the same approach the official my-rime PWA uses. **This means zero
configuration: install, import, and it works.**

- Core engine (`rime.js`, `rime.wasm`, `rime.data`) →
  `@libreservice/my-rime` on jsdelivr.
- Per-schema dictionaries → `@rime-contrib/*` on jsdelivr, fetched on demand the
  first time a schema is used.

If you prefer not to load the worker script cross-origin, the package ships the
same worker at `react-rime/worker.js` — host it yourself and pass the URL:

```tsx
useRime({ workerUrl: '/assets/rime/worker.js' })
```

> **Note:** the bundled worker is the CDN build of my_rime's worker: it still
> streams the engine binaries and dictionaries from jsdelivr (pinned to
> `@libreservice/my-rime@0.10.9`) regardless of where the worker script itself
> is hosted. Fully air-gapped deployment is not yet supported — it would
> require building my_rime's worker with its CDN flag unset so assets resolve
> relative to the worker URL.

## How it works

```
KeyboardEvent → toRimeKey() → worker.process() → RimeResult
            → useRime reducer → { preedit, candidates, text } → your UI
```

The RIME C++ engine runs unchanged in a Web Worker. `react-rime` provides the
React state layer, keyboard translation, and a configurable, SSR-safe engine
factory. The engine itself is never bundled or modified.

## License

AGPL-3.0-or-later, matching the upstream my-rime / RIME engine it builds on.
