# react-rime — Design

**Date:** 2026-06-22
**Status:** Approved by standing authorization (user delegated design decisions:
"prioritize ease of use while preserving functionality; best-practice stuff is
fine; don't ask for input constantly"). Decisions below were resolved on that
basis; rationale recorded for later review.

## Goal

A publishable React **library** (`react-rime`) that wraps the RIME WASM
input-method engine and exposes it through a clean, headless, hook-first API.
A consumer does `npm install react-rime`, imports it into any React app, and
builds their own Chinese text-entry UI — no cloning, no sibling build, no manual
asset copying.

This is explicitly **not** an app or a my-rime clone, and **not** the prior
`prior_work/old_react_rime/` attempt (a Vite *application* wired to a **mock**
worker, dependent on a sibling `../my_rime` build). We reuse that attempt's
*logic* (it ported the hard Vue→React conversions correctly) but not its shape.

## Key findings from investigation

1. **The engine layer is already framework-agnostic** and the prior attempt
   already converted it: `workerAPI.ts`, `rimeKeys.ts`, `useImeControl.ts`
   (the 417-line `control.ts` port), `useDeployStatus.ts`, `micro-plum.ts`,
   `util.ts`, `locale.ts`. These are sound and reusable with light edits.

2. **The prior attempt was only ever tested against a mock worker**
   (`public/worker.js` returns hard-coded candidates). The real-WASM smoke test
   never happened. Getting the **real** engine running is the main new work.

3. **The real engine streams everything from public jsdelivr CDNs** (it is a
   PWA with IndexedDB offline caching via `@libreservice/lazy-cache`):
   - Core engine `rime.js` + `rime.wasm` (2.5 MB) + `rime.data` (1.1 MB):
     `https://cdn.jsdelivr.net/npm/@libreservice/my-rime@<ver>/dist/`
   - Per-schema dictionaries (`*.table.bin`, `*.prism.bin`, …):
     `https://cdn.jsdelivr.net/npm/@rime-contrib/<target>@<ver>/<file>`
   - The `worker.js` itself is ~20 KB and is the only piece awkward to fetch
     cross-origin (workers prefer same-origin).

## Asset strategy (the central decision)

**Decision: hybrid — bundle the worker, stream binaries from CDN by default,
allow self-hosting override.**

- **Bundle `worker.js`** inside the package and instantiate it same-origin via
  the consumer's bundler (emitted as an asset URL). This removes the only
  cross-origin/worker hazard and means there is genuinely nothing to copy.
- **Default heavy binaries + schema dictionaries to jsdelivr** (the exact CDNs
  the official build uses), cached offline in IndexedDB. Zero config.
- **Expose a config option** (`assetBase` / `schemaCdn`) so a consumer can point
  at self-hosted copies for fully-offline / air-gapped deployments. The local
  `prior_work/rime/out/{rime.js,rime.wasm,rime.data}` are kept as the canonical
  self-host bundle for anyone who wants it.

**Why this over "bundle everything" (the literal earlier pick):** the binaries
are large (3.5 MB core + many MB of dictionaries across 40+ schemas) and the
upstream engine is deliberately built to stream + cache them. Fully bundling all
dictionaries would bloat the npm package to tens of MB and fight the engine's
design, while delivering no better "just works" experience than CDN-by-default
(which needs zero setup and works offline after first load). This satisfies the
real requirement — `npm install` + import, nothing to wire up — at a fraction of
the size. It is a one-line config change to self-host if desired.

**Worker sourcing for v1:** vendor the real, published `worker.js` from
`@libreservice/my-rime@0.10.9/dist/worker.js` (pinned), rather than rebuilding it
from `prior_work/rime/src/worker.ts` (which needs 6 generated JSON data files +
rollup toolchain). A future enhancement may ship a custom-built worker with
runtime-overridable CDN bases; v1 uses the published worker's hardcoded jsdelivr
defaults, which are correct for the zero-config path.

## Architecture

```
react-rime/
├── src/
│   ├── engine/                 ← framework-agnostic boundary (no React imports)
│   │   ├── workerAPI.ts        ← typed worker wrappers; worker URL injectable
│   │   ├── rimeKeys.ts         ← toRimeKey / toRimeKeyRelease (verbatim logic)
│   │   ├── micro-plum.ts       ← schema install/list (naive-ui removed)
│   │   ├── locale.ts           ← getLanguage()
│   │   ├── util.ts             ← query/storage helpers (Vue-router removed)
│   │   ├── schema-metadata.ts  ← schemas.json → select options / variants
│   │   └── types.ts            ← RIME_RESULT union + public types
│   ├── hooks/
│   │   ├── useRime.ts          ← PRIMARY headless hook: composition + input
│   │   ├── useImeControl.ts    ← schema/option/variant state (port of control)
│   │   └── useDeployStatus.ts  ← deploy lifecycle listener
│   ├── components/             ← OPTIONAL, unstyled, built on the hooks
│   │   ├── RimeProvider.tsx    ← context wrapping useRime + useImeControl
│   │   ├── RimeTextarea.tsx    ← unstyled textarea wired to the engine
│   │   ├── CandidatePanel.tsx  ← unstyled candidate list (render only)
│   │   └── SchemaSelector.tsx  ← unstyled schema <select>
│   ├── assets/worker.js        ← vendored real worker (pinned)
│   └── index.ts                ← public exports
├── example/                    ← Vite app that imports react-rime as a package
├── docs/superpowers/specs/
├── package.json                ← ESM, types, exports map, react peer deps
├── tsup.config.ts              ← library build (ESM + d.ts)
└── README.md
```

### The hooks API (primary surface)

`useRime` is the headless core. It owns the composition state machine that the
prior `CandidatePanel` had tangled into JSX, exposed as plain data + handlers:

```ts
const rime = useRime(options?: {
  schema?: string
  workerUrl?: string          // override bundled worker
  pageSize?: number
})

rime = {
  // composition state (from RIME_RESULT)
  preedit: { head, body, tail },
  candidates: { text, comment? }[],
  highlighted: number,
  selectLabels?: string[],
  page: number,
  isLastPage: boolean,
  composing: boolean,
  // committed text buffer (controlled or uncontrolled)
  text: string,
  setText(s): void,
  // actions
  onKeyDown(e): void,         // attach to your input/document
  onKeyUp(e): void,
  selectCandidate(i): Promise<void>,
  changePage(backward): Promise<void>,
  // engine/schema control (re-exported from useImeControl)
  schema, setSchema, schemas, variants, variant, changeVariant,
  isEnglish, changeLanguage, /* …other option toggles… */
  ready: boolean, loading: boolean,
}
```

Design rule: **components never expose behavior the hooks don't.** A consumer
can ignore `components/` entirely and build everything from `useRime`.

Provider vs. single hook: ship **both**. `useRime` works standalone for the
common single-input case; `RimeProvider` + `useRimeContext` is offered for
sharing one engine across components. (Resolves the open question in favor of
ease-of-use without sacrificing the advanced case.)

## Data flow

```
KeyboardEvent → toRimeKey() → workerAPI.process() → RIME_RESULT
            → useRime reducer → {preedit, candidates, text} → consumer UI
```

One engine/worker instance per `useRime`/provider. Committed text is controlled
(consumer owns the buffer) with an uncontrolled default.

## Error handling

- Worker/WASM load failure → `ready=false`, `error` surfaced on the hook; no
  throw across the React boundary.
- `deployStatus: failure` → exposed via `useDeployStatus`; consumer decides UI.
- micro-plum toast calls (`naive-ui`) replaced by an optional `onMessage`
  callback, defaulting to `console`.

## Testing

- **Unit (TDD, no browser):** `toRimeKey`/`toRimeKeyRelease` table-driven tests;
  the `useRime` reducer over each `RIME_RESULT` state (0/1/2/3 + updatedOptions)
  using a fake worker. This is where TDD pays off and runs fast.
- **Integration smoke (real WASM):** the example app + a Playwright check that
  typing `ni` yields 你 candidates and `1`/space commits — the test the prior
  attempt never did. Gated on network (jsdelivr) for assets.

## Scope (v1)

In: headless hooks, optional unstyled components, bundled worker + CDN assets,
types, example app, README, unit tests, one real-WASM smoke test.

Out (documented, not built): PWA/service-worker, font picker, URL-sharing,
schema-installer UI, mobile/touch, runtime-overridable-CDN custom worker build.

## Open items intentionally deferred

- Custom-built configurable worker (runtime CDN override) — v2.
- Publishing/CI to npm — after user review.
