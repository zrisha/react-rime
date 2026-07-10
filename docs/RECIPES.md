# Recipes

Copy-pasteable patterns for common integrations. The [README](../README.md)
covers the basics; [SCHEMAS.md](./SCHEMAS.md) lists every bundled schema.

## Candidate panel at the caret

The hardest part of a real IME UI is positioning the candidate panel at the
text caret. Browsers expose no caret coordinates for `<textarea>`, so use the
mirror-div technique via the tiny [`textarea-caret`](https://www.npmjs.com/package/textarea-caret)
package (the official my-rime UI does the same):

```tsx
import { useRime } from 'react-rime'
import getCaret from 'textarea-caret'
import { useState } from 'react'

export function Editor() {
  const rime = useRime()
  const [panelPos, setPanelPos] = useState({ left: 0, top: 0 })

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        {...rime.getInputProps({
          onKeyDown: (e) => {
            const el = e.currentTarget
            const caret = getCaret(el, el.selectionEnd ?? 0)
            setPanelPos({
              left: caret.left,
              top: caret.top + caret.height - el.scrollTop,
            })
          },
        })}
        rows={6}
      />
      {rime.composing && (
        <div style={{ position: 'absolute', ...panelPos }}>
          {rime.preedit.head}
          <u>{rime.preedit.body}</u>
          {rime.preedit.tail}
          <ol>
            {rime.candidates.map((c, i) => (
              <li key={i}>
                <button onClick={() => rime.selectCandidate(i)}>
                  {c.text}
                  {c.comment && <small> {c.comment}</small>}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
```

Measure the caret in `onKeyDown` (before the engine responds) so the panel is
already in place when candidates render.

## Next.js / SSR

The hooks render safely on the server — they touch no browser globals during
render — but the engine itself only loads in the browser (inside an effect),
so `ready` is always `false` in server HTML. Mark the component as
client-side and gate on `ready`:

```tsx
'use client'

import { useRime } from 'react-rime'

export function ChineseInput() {
  const rime = useRime()
  return <textarea {...rime.getInputProps()} disabled={!rime.ready} />
}
```

No `next/dynamic` / `ssr: false` dance is required, but it also works if you
prefer to skip server rendering entirely. The server-rendered markup shows the
disabled input; hydration then boots the engine and flips `ready`.

## Fully custom candidate UI (headless)

Everything a pointer-driven UI needs exists as a method — no fabricated
keyboard events:

```tsx
const rime = useRime()

// Candidate list with highlight + paging + comments:
{rime.composing && (
  <div role="listbox">
    {rime.candidates.map((c, i) => (
      <button
        key={i}
        role="option"
        aria-selected={i === rime.highlighted}
        onClick={() => rime.selectCandidate(i)}
      >
        {rime.selectLabels?.[i] ?? i + 1}. {c.text}
        {c.comment && rime.hideComment === false && <small>{c.comment}</small>}
      </button>
    ))}
    <button disabled={rime.page === 0} onClick={() => rime.changePage(true)}>‹</button>
    <button disabled={rime.isLastPage} onClick={() => rime.changePage(false)}>›</button>
    <button onClick={() => rime.highlightPrev()}>↑</button>
    <button onClick={() => rime.highlightNext()}>↓</button>
    <button onClick={() => rime.commitHighlighted()}>commit</button>
    <button onClick={() => rime.commitRaw()}>as typed</button>
    <button onClick={() => rime.cancelComposition()}>✕</button>
  </div>
)}
```

`hideComment` is `'emoji'` for schemas whose comments duplicate emoji
suggestions — check it before rendering comments (see `CandidatePanel.tsx`
for the exact rule).

## Content-Security-Policy

With the default (zero-config, CDN-streaming) setup the page needs:

```
worker-src blob:;
connect-src https://cdn.jsdelivr.net;
```

- `worker-src blob:` — the cross-origin worker script is loaded through a
  Blob URL to satisfy the same-origin worker rule.
- `connect-src https://cdn.jsdelivr.net` — the worker streams `rime.wasm`,
  `rime.data`, and per-schema dictionaries from jsdelivr (they're then cached
  in IndexedDB).

If you self-host `react-rime/worker.js` on your own origin, `worker-src
'self'` replaces `blob:` — but `connect-src https://cdn.jsdelivr.net` is
still required, because the bundled worker always streams engine assets from
jsdelivr (see the README's Assets section).

## Sharing one engine across components

Wrap once with `RimeProvider`; children call `useRimeContext()`:

```tsx
import { RimeProvider, useRimeContext } from 'react-rime'

<RimeProvider schema="double_pinyin">
  <Editor />
  <StatusBar />
</RimeProvider>

function StatusBar() {
  const rime = useRimeContext()
  return <button onClick={rime.changeLanguage}>{rime.isEnglish ? 'EN' : '中'}</button>
}
```

One caveat: the provider owns a single `inputRef`, so exactly one input under
it should spread `getInputProps()`. For multiple independent inputs, call
`useRime()` once per input instead (each gets its own engine and worker).
