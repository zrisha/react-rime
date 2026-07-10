// Engine factory. Replaces my_rime's module-level singleton worker with a
// per-instance factory so the library is configurable, SSR-safe (nothing runs
// at import time), and supports multiple independent engines.

import { LambdaWorker, asyncFS } from '@libreservice/my-worker'
import type { RimeResult } from './types'

/**
 * Default worker. The vendored copy of this exact file ships in the package as
 * `react-rime/worker.js`; by default we load the published, pinned worker from
 * jsdelivr so consumers need zero asset configuration. It in turn streams
 * rime.js / rime.wasm / rime.data and per-schema dictionaries from jsdelivr,
 * caching them offline in IndexedDB.
 *
 * Keep the version pinned here in lockstep with the vendored copy at
 * src/assets/worker.js — they must be the same file.
 */
export const DEFAULT_WORKER_URL =
  'https://cdn.jsdelivr.net/npm/@libreservice/my-rime@0.10.9/dist/worker.js'

export interface RimeEngineOptions {
  /**
   * URL of the RIME worker script. Cross-origin URLs (e.g. the default CDN) are
   * loaded via a blob to satisfy the same-origin worker restriction. A
   * self-hosted `react-rime/worker.js` still streams engine binaries and
   * dictionaries from jsdelivr (the worker is my_rime's CDN build).
   */
  workerUrl?: string
}

/** Typed handle to a RIME worker. The hooks drive this for you; it's exported for custom integrations. */
export interface RimeEngine {
  /** Activate a schema by id, streaming its dictionary on first use. */
  setIME(ime: string): Promise<void>
  /** Set a runtime option, e.g. `'ascii_mode'`, `'full_shape'`, `'simplification'`. */
  setOption(option: string, value: boolean): Promise<void>
  /** Set how many candidates each page holds. */
  setPageSize(size: number): Promise<void>
  /** Run a full RIME deploy — needed after writing schema files via {@link FS}. Progress arrives via {@link onDeployStatus}. */
  deploy(): Promise<void>
  /** Feed one RIME key string (see `toRimeKey`) and get the parsed result. */
  process(input: string): Promise<RimeResult>
  /**
   * Commit the candidate at `index` on the current page. Unlike
   * {@link process}, resolves with the *raw JSON* of a {@link RimeResult} —
   * `JSON.parse` it (worker-protocol quirk, kept for my_rime compatibility).
   */
  selectCandidateOnCurrentPage(index: number): Promise<string>
  /**
   * Page through candidates (`true` = back). Resolves with raw
   * {@link RimeResult} JSON, like {@link selectCandidateOnCurrentPage}.
   */
  changePage(backward: boolean): Promise<string>
  /** Wipe RIME's user directory: learned words and consumer-deployed files. */
  resetUserDirectory(): Promise<void>
  /** Async view of the worker's filesystem — write custom schema sources here, then {@link deploy}. */
  FS: ReturnType<typeof asyncFS>
  /**
   * Subscribe to deploy lifecycle events. `status` is `'start'`, `'success'`
   * or `'failure'`; on success `schemas` lists the deployed schema ids.
   */
  onDeployStatus(handler: (status: string, schemas: string[]) => void): void
  /** Terminate the worker and release resources. */
  dispose(): void
}

async function resolveWorkerUrl(src: string): Promise<{ url: string; isBlob: boolean }> {
  try {
    const url = new URL(src, location.href)
    if (url.origin === location.origin) {
      return { url: url.href, isBlob: false }
    }
  } catch {
    // Relative or malformed — fall through to fetch.
  }
  const res = await fetch(src)
  if (!res.ok) {
    throw new Error(`react-rime: failed to fetch worker from ${src} (HTTP ${res.status})`)
  }
  const code = await res.text()
  const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  return { url: blobUrl, isBlob: true }
}

/**
 * Spawn a RIME worker and return a typed handle. Each call creates an
 * independent engine with its own composition and option state; call
 * `dispose()` when done. Browser-only — throws if called during SSR (the
 * hooks call it inside an effect for this reason).
 */
export async function createRimeEngine(
  options: RimeEngineOptions = {},
): Promise<RimeEngine> {
  if (typeof window === 'undefined') {
    throw new Error('react-rime: createRimeEngine must run in the browser')
  }
  const src = options.workerUrl ?? DEFAULT_WORKER_URL
  const { url, isBlob } = await resolveWorkerUrl(src)
  const worker = new LambdaWorker(url)

  const engine: RimeEngine = {
    setIME: worker.register('setIME'),
    setOption: worker.register('setOption'),
    setPageSize: worker.register('setPageSize'),
    deploy: worker.register('deploy'),
    process: worker.register('process'),
    selectCandidateOnCurrentPage: worker.register('selectCandidateOnCurrentPage'),
    changePage: worker.register('changePage'),
    resetUserDirectory: worker.register('resetUserDirectory'),
    FS: asyncFS(worker),
    onDeployStatus(handler) {
      worker.control('deployStatus', (status: string, schemas: string) => {
        handler(status, schemas ? schemas.split(',') : [])
      })
    },
    dispose() {
      worker.worker.terminate()
      if (isBlob) URL.revokeObjectURL(url)
    },
  }
  return engine
}
