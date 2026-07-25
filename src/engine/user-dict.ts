// Turning off librime's per-user learning database.
//
// librime records every commit into `<dictionary>.userdb` and re-ranks later
// candidates from it — including whole sentences. That is a schema *config*
// setting (`enable_user_dict`), not a runtime switch, so `setOption` cannot
// reach it and there is no librime option to flip.
//
// It is still reachable without a rebuild. my_rime ships *compiled* schemas
// straight into the shared build directory (see the worker's `fetchPrebuilt`),
// and react-rime never runs a full deploy at startup — so the file librime
// actually reads when a schema is activated is the plain YAML at
// `<RIME_BUILD_DIR>/<id>.schema.yaml`. Rewriting it through the worker's
// filesystem and re-selecting the schema is enough: `set_ime` destroys and
// recreates the session, which re-reads the schema config.

import type { RimeEngine } from './engine'
import { devWarn } from './devWarn'

/** Where the worker drops prebuilt schemas; librime reads these at activation. */
export const RIME_BUILD_DIR = '/usr/share/rime-data/build'
/** librime's user data directory (IDBFS-backed, so it survives reloads). */
export const RIME_USER_DIR = '/rime'

const S_IFMT = 0o170000
const S_IFDIR = 0o040000

// The worker's FS proxy is typed as an unresolved import from a package that
// isn't installed, so narrow it structurally to the calls we make.
interface RimeFS {
  readFile(path: string, opts: { encoding: 'utf8' }): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  readdir(path: string): Promise<string[]>
  lstat(path: string): Promise<{ mode: number }>
  unlink(path: string): Promise<void>
  rmdir(path: string): Promise<void>
}

const fsOf = (engine: RimeEngine) => engine.FS as unknown as RimeFS

/** Line split that tolerates CRLF; {@link disableUserDict} restores the original ending. */
const splitLines = (yaml: string) => yaml.split(/\r?\n/)

const indentOf = (line: string) => /^ */.exec(line)![0].length

/** Extent of a top-level `key:` block: its header line and one past its body. */
function blockRange(lines: string[], key: string): [number, number] | null {
  const start = lines.findIndex((line) => {
    if (/^\s/.test(line)) return false
    // Tolerate a quoted key; librime's emitter doesn't quote, but a hand-written
    // or differently-generated schema may.
    const header = /^"?([^":]+)"?:\s*$/.exec(line)
    return header?.[1] === key
  })
  if (start === -1) return null
  let end = start + 1
  while (end < lines.length && (/^\s/.test(lines[end]) || lines[end].trim() === '')) end++
  return [start, end]
}

/** Indentation of a block's direct children, so 4-space schemas patch correctly. */
function bodyIndent(lines: string[], start: number, end: number): number {
  for (let i = start + 1; i < end; i++) {
    if (lines[i].trim() !== '') return indentOf(lines[i])
  }
  return 2
}

/**
 * Namespaces of the dict-backed translators in `engine/translators`. A bare
 * `script_translator` reads the top-level `translator:` block; `@name` suffixes
 * name their own block. Each one can open its own user dictionary — reverse
 * lookups included, which is why patching `translator` alone is not enough for
 * schemas like jyut6ping3 (4 namespaces) or array30 (3).
 */
export function dictTranslatorNamespaces(yaml: string): string[] {
  const lines = splitLines(yaml)
  const engine = blockRange(lines, 'engine')
  if (!engine) return []
  const [start, end] = engine
  const listStart = lines.findIndex(
    (line, i) => i > start && i < end && /^\s+translators:\s*$/.test(line),
  )
  if (listStart === -1) return []
  const listIndent = indentOf(lines[listStart])
  const namespaces: string[] = []
  for (let i = listStart + 1; i < end; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    // YAML lets a block sequence sit at or below its key's indentation, so key
    // off "is this still a list item" rather than one exact column.
    const item = /^\s*-\s*"?([^"#\s]+)"?\s*(?:#.*)?$/.exec(line)
    if (!item || indentOf(line) < listIndent) break
    const dictBacked = /^(?:script|table)_translator(?:@(.+))?$/.exec(item[1])
    if (dictBacked) namespaces.push(dictBacked[1] ?? 'translator')
  }
  return namespaces
}

/**
 * Rewrite a compiled schema YAML so no translator namespace opens a user
 * dictionary. Idempotent — returns the input unchanged when nothing is left to
 * disable, which is how callers detect "already patched".
 *
 * Namespaces pinned to a non-user database (`db_class: stabledb`/`tabledb`, as
 * `custom_phrase` uses) are left alone: those are author-supplied phrase lists,
 * not learned text, and disabling them would silently drop a feature.
 */
export function disableUserDict(yaml: string): string {
  const eol = yaml.includes('\r\n') ? '\r\n' : '\n'
  const lines = splitLines(yaml)
  for (const ns of dictTranslatorNamespaces(yaml)) {
    const range = blockRange(lines, ns)
    if (!range) {
      // No block at all: librime falls back to its defaults, which enable the
      // user dict, so the namespace still needs one written out.
      lines.push(`${ns}:`, '  enable_user_dict: false')
      continue
    }
    const [start, end] = range
    const indent = bodyIndent(lines, start, end)
    const pad = ' '.repeat(indent)
    let existing = -1
    let readOnlyDb = false
    for (let i = start + 1; i < end; i++) {
      // Direct children only — a deeper `enable_user_dict` belongs to a sub-key.
      if (indentOf(lines[i]) !== indent) continue
      if (/^\s*enable_user_dict:/.test(lines[i])) existing = i
      if (/^\s*db_class:\s*"?(stabledb|tabledb)"?\s*$/.test(lines[i])) readOnlyDb = true
    }
    if (existing !== -1) {
      lines[existing] = `${pad}enable_user_dict: false`
    } else if (!readOnlyDb) {
      lines.splice(start + 1, 0, `${pad}enable_user_dict: false`)
    }
  }
  return lines.join(eol)
}

/**
 * Outcome of {@link applyUserDictDisabled}. `unreachable` is the one the caller
 * must not mistake for success: learning is still on and we could not change
 * it, as opposed to `already-disabled`, where it was never on to begin with.
 */
export type UserDictPatch = 'patched' | 'already-disabled' | 'unreachable'

/**
 * Rewrite the active schema's compiled YAML in the worker's filesystem. Only a
 * `patched` result requires the caller to re-select the schema; librime keeps
 * serving the config it already read otherwise.
 */
export async function applyUserDictDisabled(
  engine: RimeEngine,
  schemaId: string,
): Promise<UserDictPatch> {
  const fs = fsOf(engine)
  const path = `${RIME_BUILD_DIR}/${schemaId}.schema.yaml`
  let yaml: string
  try {
    yaml = await fs.readFile(path, { encoding: 'utf8' })
  } catch {
    // Schemas the consumer deployed themselves (FS + deploy) have no prebuilt
    // YAML here, so there is nothing to rewrite — say so rather than leaving
    // learning quietly on.
    devWarn(
      `userDict:${schemaId}`,
      `userDict: false could not be applied to "${schemaId}" — no compiled schema at ` +
        `${path}. Self-deployed schemas must set translator/enable_user_dict in their own ` +
        'source YAML.',
    )
    return 'unreachable'
  }
  if (dictTranslatorNamespaces(yaml).length === 0) {
    // We understood nothing in the schema, so we cannot claim learning is off.
    // Failing loudly matters more here than anywhere else in the library: the
    // silent alternative is a privacy promise the code isn't keeping.
    devWarn(
      `userDict:${schemaId}`,
      `userDict: false could not be applied to "${schemaId}" — no dictionary-backed ` +
        `translators found in ${path}, so its format was not understood and learning may ` +
        'still be on. Please report this schema.',
    )
    return 'unreachable'
  }
  const patched = disableUserDict(yaml)
  if (patched === yaml) return 'already-disabled'
  await fs.writeFile(path, patched)
  return 'patched'
}

/**
 * Put a schema into the "no learning" state and make librime honor it.
 *
 * The first activation of a schema in a session is what downloads its compiled
 * YAML, so the rewrite can only land *after* that `setIME` — by which point
 * librime has already opened a user dictionary. Hence: rewrite, delete what it
 * made, then re-select so the session re-reads the config.
 *
 * `alsoClear` forces the delete even when the schema needed no rewrite. That
 * covers two cases the patch alone misses: schemas that already ship disabled
 * (ipa_xsampa, ipa_yunlong), and dictionaries left behind by *other* schemas in
 * an earlier session, which are only reachable through this whole-directory
 * sweep.
 */
export async function enforceUserDictDisabled(
  engine: RimeEngine,
  schemaId: string,
  alsoClear: boolean,
): Promise<void> {
  const result = await applyUserDictDisabled(engine, schemaId)
  if (result !== 'patched' && !alsoClear) return
  await clearUserDbs(engine)
  // Re-select even when only clearing: setIME's trailing syncfs is what flushes
  // the deletion out to IndexedDB.
  await engine.setIME(schemaId)
}

/**
 * Delete every `*.userdb` in the user directory, leaving consumer-deployed
 * files intact (unlike {@link RimeEngine.resetUserDirectory}, which wipes all
 * of `/rime`). The caller must re-select a schema afterwards: the worker syncs
 * the user directory to IndexedDB at the end of `setIME`, and without that
 * flush the deletion would not survive a reload.
 */
export async function clearUserDbs(engine: RimeEngine): Promise<void> {
  const fs = fsOf(engine)
  let entries: string[]
  try {
    entries = await fs.readdir(RIME_USER_DIR)
  } catch {
    return
  }
  for (const name of entries) {
    if (name === '.' || name === '..') continue
    if (!name.endsWith('.userdb') && !name.endsWith('.userdb.txt')) continue
    const path = `${RIME_USER_DIR}/${name}`
    const { mode } = await fs.lstat(path)
    if ((mode & S_IFMT) === S_IFDIR) {
      await removeTree(fs, path)
      await fs.rmdir(path)
    } else {
      await fs.unlink(path)
    }
  }
}

async function removeTree(fs: RimeFS, path: string): Promise<void> {
  for (const name of await fs.readdir(path)) {
    if (name === '.' || name === '..') continue
    const child = `${path}/${name}`
    const { mode } = await fs.lstat(child)
    if ((mode & S_IFMT) === S_IFDIR) {
      await removeTree(fs, child)
      await fs.rmdir(child)
    } else {
      await fs.unlink(child)
    }
  }
}
