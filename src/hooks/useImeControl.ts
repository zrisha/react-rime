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

const ASCII_MODE = 'ascii_mode'
const FULL_SHAPE = 'full_shape'
const EXTENDED_CHARSET = 'extended_charset'
const ASCII_PUNCT = 'ascii_punct'
const EMOJI_SUGGESTION = 'emoji_suggestion'

function useSavedBoolean(key: string, defaultTrue: boolean) {
  const [val, setVal] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return defaultTrue
    return defaultTrue ? localStorage.getItem(key) !== 'false' : localStorage.getItem(key) === 'true'
  })
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, val.toString())
  }, [key, val])
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

  const [isEnglish, setIsEnglish] = useState(false)
  const [isFullWidth, setIsFullWidth] = useSavedBoolean(FULL_SHAPE, false)
  const [isExtendedCharset, setIsExtendedCharset] = useSavedBoolean(EXTENDED_CHARSET, false)
  const [isEnglishPunctuation, setIsEnglishPunctuation] = useSavedBoolean(ASCII_PUNCT, false)
  const [enableEmoji, setEnableEmoji] = useSavedBoolean(EMOJI_SUGGESTION, true)

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

  const basicOptionMap = useMemo(
    () => ({
      [ASCII_MODE]: { value: isEnglish, set: setIsEnglish },
      [FULL_SHAPE]: { value: isFullWidth, set: setIsFullWidth },
      [EXTENDED_CHARSET]: { value: isExtendedCharset, set: setIsExtendedCharset },
      [ASCII_PUNCT]: { value: isEnglishPunctuation, set: setIsEnglishPunctuation },
      [EMOJI_SUGGESTION]: { value: enableEmoji, set: setEnableEmoji },
    }),
    // setters are stable; values are the deps
    [isEnglish, isFullWidth, isExtendedCharset, isEnglishPunctuation, enableEmoji], // eslint-disable-line react-hooks/exhaustive-deps
  )

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
      // librime resets ascii_mode on schema switch; re-sync the rest.
      for (const [option, box] of Object.entries(basicOptionMap)) {
        if (option === ASCII_MODE) {
          setIsEnglish(false)
          continue
        }
        await engine.setOption(option, box.value)
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

  function makeToggle(option: string, value: boolean, set: (v: boolean) => void) {
    return async () => {
      if (!engine) return
      const next = !value
      await engine.setOption(option, next)
      set(next)
    }
  }

  const changeLanguage = useEventCallback(makeToggle(ASCII_MODE, isEnglish, setIsEnglish))
  const changeWidth = useEventCallback(makeToggle(FULL_SHAPE, isFullWidth, setIsFullWidth))
  const changeCharset = useEventCallback(
    makeToggle(EXTENDED_CHARSET, isExtendedCharset, setIsExtendedCharset),
  )
  const changePunctuation = useEventCallback(
    makeToggle(ASCII_PUNCT, isEnglishPunctuation, setIsEnglishPunctuation),
  )
  const changeEmoji = useEventCallback(makeToggle(EMOJI_SUGGESTION, enableEmoji, setEnableEmoji))

  const syncOptions = useEventCallback(
    (updatedOptions: string[]) => {
      if (updatedOptions.length === 1) {
        const updatedOption = updatedOptions[0]
        for (const [option, box] of Object.entries(basicOptionMap)) {
          if (option === updatedOption) {
            box.set(true)
            return
          }
          if (`!${option}` === updatedOption) {
            box.set(false)
            return
          }
        }
        if (!deployed && variants.length === 2) {
          for (const [i, v] of variants.entries()) {
            if ((v.id === updatedOption && v.value) || (`!${v.id}` === updatedOption && !v.value)) {
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
    },
  )

  // Memoized so the object identity only changes when state does (all actions
  // are identity-stable).
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
      isEnglish,
      isFullWidth,
      isExtendedCharset,
      isEnglishPunctuation,
      enableEmoji,
      // actions
      selectIME,
      setSchema: selectIME,
      syncOptions,
      changeVariant,
      changeLanguage,
      changeWidth,
      changeCharset,
      changePunctuation,
      changeEmoji,
    }),
    // actions are identity-stable; only state belongs in the deps
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
      isEnglish,
      isFullWidth,
      isExtendedCharset,
      isEnglishPunctuation,
      enableEmoji,
    ],
  )
}
