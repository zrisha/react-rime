#!/usr/bin/env node
// Keeps the pinned DEFAULT_WORKER_URL version and the vendored worker copy in
// lockstep (they must be the same file).
//
//   npm run check-worker            verify src/assets/worker.js matches the pin
//   npm run update-worker           re-vendor the currently pinned version
//   npm run update-worker -- 0.11.0 bump the pin and re-vendor
//
// After bumping: npm run build && npm test && npm run smoke

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const enginePath = resolve(root, 'src/engine/engine.ts')
const workerPath = resolve(root, 'src/assets/worker.js')

const engineSrc = readFileSync(enginePath, 'utf8')
const pinRe = /(@libreservice\/my-rime@)([\d.]+)(\/dist\/worker\.js)/
const match = engineSrc.match(pinRe)
if (!match) {
  console.error('update-worker: could not find the my-rime pin in src/engine/engine.ts')
  process.exit(1)
}
const current = match[2]

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const target = args.find((a) => a !== '--check') ?? current

const url = `https://cdn.jsdelivr.net/npm/@libreservice/my-rime@${target}/dist/worker.js`
const res = await fetch(url)
if (!res.ok) {
  console.error(`update-worker: HTTP ${res.status} fetching ${url}`)
  process.exit(1)
}
const remote = await res.text()

if (checkOnly) {
  const local = readFileSync(workerPath, 'utf8')
  if (local === remote) {
    console.log(`OK: src/assets/worker.js matches @libreservice/my-rime@${target}`)
  } else {
    console.error(`FAIL: src/assets/worker.js does not match ${url}`)
    console.error('Run `npm run update-worker` to re-vendor it.')
    process.exit(1)
  }
} else {
  writeFileSync(workerPath, remote)
  console.log(`Vendored worker.js from ${url}`)
  if (target !== current) {
    writeFileSync(enginePath, engineSrc.replace(pinRe, `$1${target}$3`))
    console.log(`Pinned @libreservice/my-rime ${current} -> ${target} in src/engine/engine.ts`)
  }
  console.log('Now run: npm run build && npm test && npm run smoke')
}
