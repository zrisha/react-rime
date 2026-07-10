# react-rime — project state & handoff

_Last updated: 2026-06-22. Companion to the design spec in
`docs/superpowers/specs/2026-06-22-react-rime-design.md`._

## What this is

A publishable, **headless** React library wrapping the RIME input-method engine
(C++ → WASM, runs in a Web Worker). It exposes the engine through hooks so you
can build your own Chinese text-entry UI. It is **not** a my-rime clone and not
an app — the deliverable is the library.

## Status: working v1, not published

- ✅ Headless `useRime` hook (composition state machine + key handling + text buffer)
- ✅ `useImeControl` (schema / options / variants), `useDeployStatus` folded into the engine
- ✅ Optional `RimeProvider` / `useRimeContext` for sharing one engine (the unstyled UI components were cut pre-release — hooks-only, see CHANGELOG)
- ✅ SSR-safe engine factory with cross-origin blob-worker loading
- ✅ 15 unit tests (key translation + composition reducer via mock engine)
- ✅ Real-WASM Playwright smoke test passes (`nihao` → 你好 over jsdelivr)
- ✅ Example app consumes the package via `file:` link and builds clean
- ❌ Not published anywhere; no CI

## Verify everything

```bash
# in react-rime/
npm install
npm run typecheck      # tsc, clean
npm test               # 15 unit tests
npm run build          # dist/: index.js + index.d.ts + worker.js

# in react-rime/example/  (real engine, needs network to jsdelivr)
npm install
npm run dev            # interactive: type pinyin in the box
npx playwright test    # automated round-trip smoke test
```

## Architecture (one-paragraph map)

`src/engine/` is the framework-agnostic boundary (no React imports):
`engine.ts` is the configurable worker factory; `rimeKeys.ts` translates DOM
key events to RIME key strings; `schema-metadata.ts` turns `schemas.json` into
UI metadata; `types.ts` holds the `RimeResult` union. `src/hooks/useRime.ts` is
the primary surface — it creates the engine, runs the composition reducer over
each `RimeResult`, and re-exports `useImeControl`. `src/context.tsx` shares one
`useRime` instance via React context. Data flow:
`KeyboardEvent → toRimeKey() → worker.process() → RimeResult → reducer → UI`.

## Key decisions (and why)

- **Hooks are the whole API.** The unstyled components were cut before release:
  `getInputProps()` made them one-liners to hand-roll, and keeping them meant
  owning an a11y surface. `RimeProvider` (engine sharing) stayed.
- **Hybrid assets.** Bundle the ~20KB worker; stream the large binaries
  (rime.wasm/.data ≈3.5MB + per-schema dicts) from jsdelivr, cached offline in
  IndexedDB — the same model as the my-rime PWA. Zero-config install; override
  `workerUrl` for self-hosting. (We bundle `worker.js` into `dist/` too.)
- **Engine is a factory, not a module singleton** — SSR-safe, configurable,
  supports multiple instances.

## The bug that blocked the prior attempt (don't reintroduce)

Readiness must NOT be gated on `deployStatus: success`. That notification only
fires from a full `deploy()` (`start_maintenance(true)` in `wasm/api.cpp`).
The normal CDN prebuilt-dictionary startup uses `set_ime` → `api->initialize()`
only, which **never** emits it. `react-rime` keys `ready` on the initial
`selectIME()` resolving (mirroring how my_rime gates UI on `loading`). The
`deployStatus` handler now only sets the cosmetic `deployed` flag.

## Source of the real engine assets

The real worker is vendored at `src/assets/worker.js` (pinned from
`@libreservice/my-rime@0.10.9/dist/worker.js`). It streams:
- core engine ← `cdn.jsdelivr.net/npm/@libreservice/my-rime@0.10.9/dist/`
- schema dicts ← `cdn.jsdelivr.net/npm/@rime-contrib/<target>@<ver>/`

The original my-rime source, WASM build pipeline, and the prior React attempt
all live in `../prior_work/` for reference.

## Deferred (not built; see spec for scope)

Runtime schema-installer UI (micro-plum), PWA/service-worker, font picker,
URL-sharing, mobile/touch, and a custom-built worker with runtime-overridable
CDN bases (v1 uses the published worker's hardcoded jsdelivr defaults).

## Next steps if resuming

1. Decide distribution (private git install vs. GitHub Packages — see README
   "Assets & offline use" and the handoff conversation). For registry publish,
   rename to a scoped package (`@you/react-rime`).
2. Add CI (typecheck + unit tests; smoke test needs network or self-hosted assets).
3. Consider self-hosting the engine binaries for fully-offline deployments.
