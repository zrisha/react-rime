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

export interface RimeEngine {
  setIME(ime: string): Promise<void>
  setOption(option: string, value: boolean): Promise<void>
  setPageSize(size: number): Promise<void>
  deploy(): Promise<void>
  process(input: string): Promise<RimeResult>
  selectCandidateOnCurrentPage(index: number): Promise<string>
  changePage(backward: boolean): Promise<string>
  resetUserDirectory(): Promise<void>
  FS: ReturnType<typeof asyncFS>
  /** Subscribe to deploy lifecycle events emitted by the engine. */
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
