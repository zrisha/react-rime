// Schema / option / variant state. Ported from my_rime's control.ts:
// Vue ref/computed/watchEffect → React useState/useMemo/useEffect, and the
// module-level singleton worker → an injected engine instance.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RimeEngine } from '../engine/engine'
import {
  buildSchemaMetadata,
  DEFAULT_SCHEMA_ID,
  type HideComment,
  type SelectOption,
  type Variant,
} from '../engine/schema-metadata'

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
  /** Initial schema id. Defaults to the first schema (luna_pinyin). */
  schema?: string
}

export function useImeControl(engine: RimeEngine | null, options: UseImeControlOptions = {}) {
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

  function setLoading(value: boolean) {
    setShowVariant(!value)
    setLoadingState(value)
    setIme(value ? '' : schemaId)
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
      const vars = meta.variants[currentSchemaId]
      const active = vars[currentVariantIndex]
      for (const v of vars) {
        if (v.id !== active.id) await engine.setOption(v.id, false)
      }
      return engine.setOption(active.id, active.value)
    },
    [engine, meta],
  )

  const selectIME = useCallback(
    async (targetIME: string) => {
      if (!engine) return
      setLoading(true)
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
        console.error('react-rime: selectIME failed', e)
      }
      setLoading(false)
    },
    [engine, deployed, variantIndexMap, basicOptionMap, applyVariant], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const changeVariant = useCallback(async () => {
    const next = (variantIndex + 1) % variants.length
    setVariantIndexMap((m) => ({ ...m, [schemaId]: next }))
    await applyVariant(schemaId, next)
  }, [schemaId, variantIndex, variants.length, applyVariant])

  function makeToggle(option: string, value: boolean, set: (v: boolean) => void) {
    return async () => {
      if (!engine) return
      const next = !value
      await engine.setOption(option, next)
      set(next)
    }
  }

  const changeLanguage = makeToggle(ASCII_MODE, isEnglish, setIsEnglish)
  const changeWidth = makeToggle(FULL_SHAPE, isFullWidth, setIsFullWidth)
  const changeCharset = makeToggle(EXTENDED_CHARSET, isExtendedCharset, setIsExtendedCharset)
  const changePunctuation = makeToggle(ASCII_PUNCT, isEnglishPunctuation, setIsEnglishPunctuation)
  const changeEmoji = makeToggle(EMOJI_SUGGESTION, enableEmoji, setEnableEmoji)

  const syncOptions = useCallback(
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
    [basicOptionMap, deployed, variants, schemaId],
  )

  return {
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
  }
}

export type ImeControl = ReturnType<typeof useImeControl>
