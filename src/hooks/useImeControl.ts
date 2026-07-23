// Schema / option / variant state. Ported from my_rime's control.ts:
// Vue ref/computed/watchEffect → React useState/useMemo/useEffect, and the
// module-level singleton worker → an injected engine instance.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useEventCallback } from './useEventCallback'
import type { RimeEngine } from '../engine/engine'
import {
  buildSchemaMetadata,
  DEFAULT_SCHEMA_ID,
  type HideComment,
  type SelectOption,
  type Variant,
} from '../engine/schema-metadata'
import type { SchemaId } from '../engine/schema-ids'
import { devWarn } from '../engine/devWarn'

// Single source of truth for the boolean RIME options the library wraps with
// named convenience accessors. A row here wires the state cell, its
// persistence, the named toggle, the schema-switch re-sync, engine-pushed
// syncOptions, and the generic options/setOption surface — nothing else in this
// file needs touching to add one. `option` is librime's name (and the
// localStorage key when persisted); `key`/`toggle` are the ImeControl field
// names. `resetOnSwitch` marks options librime resets to `default` on every
// schema switch (so we don't re-send them, just mirror the reset locally).
interface RimeOptionSpec {
  readonly key: string
  readonly option: string
  readonly toggle: string
  readonly default: boolean
  readonly persist: boolean
  readonly resetOnSwitch?: boolean
}

const RIME_OPTIONS = [
  { key: 'isEnglish', option: 'ascii_mode', toggle: 'changeLanguage', default: false, persist: false, resetOnSwitch: true },
  { key: 'isFullWidth', option: 'full_shape', toggle: 'changeWidth', default: false, persist: true },
  { key: 'isExtendedCharset', option: 'extended_charset', toggle: 'changeCharset', default: false, persist: true },
  { key: 'isEnglishPunctuation', option: 'ascii_punct', toggle: 'changePunctuation', default: false, persist: true },
  { key: 'enableEmoji', option: 'emoji_suggestion', toggle: 'changeEmoji', default: true, persist: true },
] as const satisfies readonly RimeOptionSpec[]

type OptionKey = (typeof RIME_OPTIONS)[number]['key']
type ToggleKey = (typeof RIME_OPTIONS)[number]['toggle']

function readSavedBoolean(spec: RimeOptionSpec): boolean {
  if (!spec.persist || typeof localStorage === 'undefined') return spec.default
  return spec.default
    ? localStorage.getItem(spec.option) !== 'false'
    : localStorage.getItem(spec.option) === 'true'
}

// One boolean cell per option, persisted to localStorage under the librime
// option name when `persist` is set (matching my_rime's keys).
function useOptionState(spec: RimeOptionSpec) {
  const [val, setVal] = useState<boolean>(() => readSavedBoolean(spec))
  useEffect(() => {
    if (spec.persist && typeof localStorage !== 'undefined') {
      localStorage.setItem(spec.option, val.toString())
    }
  }, [spec, val])
  return [val, setVal] as const
}

export interface UseImeControlOptions {
  /**
   * Initial schema id (autocompletes the bundled ids; see docs/SCHEMAS.md).
   * Custom self-deployed schema ids are accepted as plain strings.
   * Defaults to the first schema (luna_pinyin).
   */
  schema?: SchemaId | (string & {})
}

/** Everything {@link useImeControl} returns. {@link useRime} re-exposes most of it. */
export interface ImeControl {
  // --- schema ---
  /** Id of the active schema (the target id while a switch is in flight). */
  schemaId: string
  /** Grouped options for building a schema `<select>`, from the bundled metadata. */
  schemas: SelectOption[]
  /** `true` while a schema switch is in progress. */
  loading: boolean
  /**
   * Id of the fully configured schema: empty while a switch is in flight,
   * equal to {@link schemaId} once its options are re-synced.
   */
  ime: string
  /** Activate a schema by id, re-syncing options (librime resets them on switch). */
  selectIME: (id: SchemaId | (string & {})) => Promise<void>
  /** Alias of {@link selectIME} (the name {@link useRime} exposes). */
  setSchema: (id: SchemaId | (string & {})) => Promise<void>

  // --- deploy (custom schemas) ---
  /**
   * `true` once the engine has run a full deploy (consumer-deployed schemas).
   * Variant/option state is then engine-driven instead of metadata-driven.
   */
  deployed: boolean
  /** Flip {@link deployed}; wired to the engine's deploy events by {@link useRime}. */
  setDeployed: Dispatch<SetStateAction<boolean>>

  // --- script variants (e.g. 简/繁) ---
  /** Script variants available for the active schema. */
  variants: Variant[]
  /** The currently active script variant, if the schema has any. */
  variant: Variant | undefined
  /** Index of {@link variant} within {@link variants}. */
  variantIndex: number
  /** Cycle to the next script variant (e.g. toggle 简 ⇄ 繁). */
  changeVariant: () => Promise<void>
  /** `false` while switching schema — hide variant UI until the switch settles. */
  showVariant: boolean

  // --- options ---
  /** `true` when ASCII (English) mode is on. */
  isEnglish: boolean
  /** Toggle ASCII (English) mode on/off. */
  changeLanguage: () => Promise<void>
  /** `true` when full-width character mode is on. Persisted to localStorage. */
  isFullWidth: boolean
  /** Toggle full-width vs. half-width characters. */
  changeWidth: () => Promise<void>
  /** `true` when the extended charset (rare CJK blocks) is enabled. Persisted. */
  isExtendedCharset: boolean
  /** Toggle the extended charset on/off. */
  changeCharset: () => Promise<void>
  /** `true` when punctuation is in ASCII (English) form. Persisted. */
  isEnglishPunctuation: boolean
  /** Toggle ASCII vs. Chinese punctuation. */
  changePunctuation: () => Promise<void>
  /** `true` when emoji suggestions are enabled. Persisted to localStorage. */
  enableEmoji: boolean
  /** Toggle emoji suggestions on/off. */
  changeEmoji: () => Promise<void>
  /** Whether/which candidate comments the active schema hides (`false` | `'emoji'`). */
  hideComment: HideComment
  /**
   * Current values of the tracked boolean options, keyed by librime option
   * name (e.g. `ascii_mode`). Pairs with {@link setOption}. Options you set
   * outside the tracked set are not reflected here.
   */
  options: Record<string, boolean>
  /**
   * Set any librime boolean option by name, e.g. `setOption('ascii_mode',
   * true)`. The generic escape hatch behind the named toggles
   * ({@link changeLanguage} etc.) — use it for options the library doesn't
   * wrap. Tracked options also update {@link options} and their named field.
   */
  setOption: (name: string, value: boolean) => Promise<void>
  /**
   * Apply option updates pushed by the engine (`updatedOptions` on a
   * {@link RimeResult}; a `!` prefix means the option turned off).
   */
  syncOptions: (updatedOptions: string[]) => void
}

/**
 * Schema, option, and variant state for an engine you own. {@link useRime}
 * composes this and re-exposes most of it — reach for it directly only with a
 * custom `createRimeEngine` integration.
 */
export function useImeControl(
  engine: RimeEngine | null,
  options: UseImeControlOptions = {},
): ImeControl {
  const meta = useMemo(() => buildSchemaMetadata(), [])

  const [schemaId, setSchemaId] = useState<string>(options.schema ?? DEFAULT_SCHEMA_ID)
  const [deployed, setDeployed] = useState(false)
  const [loading, setLoadingState] = useState(true)
  const [ime, setIme] = useState('')
  const [showVariant, setShowVariant] = useState(false)
  const [variantIndexMap, setVariantIndexMap] = useState<Record<string, number>>(() => ({
    ...meta.variantsDefaultIndex,
  }))

  // One state cell per option, driven off the constant-length RIME_OPTIONS
  // table. The hook count never varies across renders, so calling useOptionState
  // in this loop is rules-of-hooks safe.
  const optionCells = RIME_OPTIONS.map((spec) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useOptionState(spec),
  )

  // Per-render lookups derived from the cells. `optionValues` is keyed by the
  // friendly field name (isEnglish…) for the named surface; `cellByName` by the
  // librime option name (ascii_mode…) for the generic setOption/syncOptions
  // paths and the `options` bag.
  const optionValues = {} as Record<OptionKey, boolean>
  const cellByName: Record<string, { value: boolean; set: (v: boolean) => void; spec: RimeOptionSpec }> = {}
  RIME_OPTIONS.forEach((spec, i) => {
    const [value, set] = optionCells[i]
    optionValues[spec.key] = value
    cellByName[spec.option] = { value, set, spec }
  })

  const variants: Variant[] = useMemo(() => meta.variants[schemaId] ?? [], [meta, schemaId])
  const variantIndex = useMemo(() => variantIndexMap[schemaId] ?? 0, [variantIndexMap, schemaId])
  const variant = useMemo(() => variants[variantIndex], [variants, variantIndex])
  const hideComment: HideComment = useMemo(() => meta.comment[schemaId] ?? false, [meta, schemaId])
  const selectOptions: SelectOption[] = meta.selectOptions

  // Takes the schema id explicitly: reading `schemaId` here would see the
  // stale pre-switch value inside selectIME's closure.
  function setLoading(value: boolean, id: string) {
    setShowVariant(!value)
    setLoadingState(value)
    setIme(value ? '' : id)
  }

  const applyVariant = useCallback(
    async (currentSchemaId: string, currentVariantIndex: number) => {
      if (!engine) return
      // Schemas deployed by the consumer (FS + deploy) have no metadata entry.
      const vars = meta.variants[currentSchemaId] ?? []
      const active = vars[currentVariantIndex]
      if (!active) return
      for (const v of vars) {
        if (v.id !== active.id) await engine.setOption(v.id, false)
      }
      return engine.setOption(active.id, active.value)
    },
    [engine, meta],
  )

  // Generic escape hatch: set any librime boolean option. Tracked options
  // (in RIME_OPTIONS) also mirror into their state cell. Uses useEventCallback
  // so the identity is stable and `cellByName` reads the latest render.
  const setOption = useEventCallback(async (name: string, value: boolean) => {
    if (!engine) return
    await engine.setOption(name, value)
    cellByName[name]?.set(value)
  })

  // Flip a tracked option, reading its current value at call time.
  const toggleOption = useEventCallback(async (name: string) => {
    const cell = cellByName[name]
    if (!cell) return
    await setOption(name, !cell.value)
  })

  // Named toggles are built once (stable identity); each defers to
  // toggleOption, which reads the latest value when called.
  const namedToggles = useMemo(() => {
    const t = {} as Record<ToggleKey, () => Promise<void>>
    for (const spec of RIME_OPTIONS) t[spec.toggle] = () => toggleOption(spec.option)
    return t
  }, [toggleOption])

  // Actions use useEventCallback: one identity for the hook's lifetime, always
  // reading the latest render's state.
  const selectIME = useEventCallback(async (targetIME: string) => {
    if (!engine) return
    if (!meta.ids.includes(targetIME)) {
      devWarn(
        `schema:${targetIME}`,
        `schema "${targetIME}" is not in the bundled schemas.json (see docs/SCHEMAS.md) — ` +
          'assuming a custom schema you deployed yourself; check for a typo otherwise.',
      )
    }
    setLoading(true, targetIME)
    try {
      await engine.setIME(targetIME)
      setSchemaId(targetIME)
      if (!deployed) {
        await applyVariant(targetIME, variantIndexMap[targetIME] ?? 0)
      }
      // librime resets some options (ascii_mode) to their default on schema
      // switch; mirror those locally and re-send the rest.
      for (const spec of RIME_OPTIONS as readonly RimeOptionSpec[]) {
        if (spec.resetOnSwitch) {
          cellByName[spec.option].set(spec.default)
          continue
        }
        await engine.setOption(spec.option, cellByName[spec.option].value)
      }
    } catch (e) {
      // Rethrow so callers (useRime) can surface it via their error state.
      setLoadingState(false)
      throw e instanceof Error ? e : new Error(String(e))
    }
    setLoading(false, targetIME)
  })

  const changeVariant = useEventCallback(async () => {
    if (variants.length === 0) return
    const next = (variantIndex + 1) % variants.length
    setVariantIndexMap((m) => ({ ...m, [schemaId]: next }))
    await applyVariant(schemaId, next)
  })

  const syncOptions = useEventCallback((updatedOptions: string[]) => {
    if (updatedOptions.length === 1) {
      const updated = updatedOptions[0]
      if (cellByName[updated]) {
        cellByName[updated].set(true)
        return
      }
      if (updated.startsWith('!') && cellByName[updated.slice(1)]) {
        cellByName[updated.slice(1)].set(false)
        return
      }
      if (!deployed && variants.length === 2) {
        for (const [i, v] of variants.entries()) {
          if ((v.id === updated && v.value) || (`!${v.id}` === updated && !v.value)) {
            setVariantIndexMap((m) => ({ ...m, [schemaId]: i }))
            return
          }
        }
      }
    } else {
      for (const updatedOption of updatedOptions) {
        if (updatedOption.startsWith('!')) continue
        for (const [i, v] of variants.entries()) {
          if (v.id === updatedOption) {
            setVariantIndexMap((m) => ({ ...m, [schemaId]: i }))
            return
          }
        }
      }
    }
  })

  // Generic view of the tracked options, keyed by librime option name.
  const optionsBag: Record<string, boolean> = {}
  for (const spec of RIME_OPTIONS) optionsBag[spec.option] = cellByName[spec.option].value

  // One primitive dep for the memo below that changes iff any option value
  // changes (a spread of the cell values isn't allowed in a deps array).
  const optionsSignature = optionCells.map((c) => (c[0] ? '1' : '0')).join('')

  // Memoized so the object identity only changes when state does (all actions
  // are identity-stable). The named option values are spread from the table so
  // adding a RIME_OPTIONS row needs no edit here.
  return useMemo(
    () => ({
      // state
      schemaId,
      schemas: selectOptions,
      deployed,
      setDeployed,
      loading,
      ime,
      showVariant,
      variants,
      variant,
      variantIndex,
      hideComment,
      ...optionValues,
      options: optionsBag,
      // actions
      selectIME,
      setSchema: selectIME,
      setOption,
      syncOptions,
      changeVariant,
      ...namedToggles,
    }),
    // actions are identity-stable; only state belongs in the deps. optionValues
    // /optionsBag/namedToggles are derived from the option cells, tracked here
    // via optionsSignature (their real dep).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      schemaId,
      selectOptions,
      deployed,
      loading,
      ime,
      showVariant,
      variants,
      variant,
      variantIndex,
      hideComment,
      optionsSignature,
    ],
  )
}
