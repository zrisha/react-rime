// The primary headless hook. Owns the engine instance, the composition state
// machine (preedit + candidates), keyboard translation, and the committed text
// buffer. Everything the optional components do is available here.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createRimeEngine,
  type RimeEngine,
  type RimeEngineOptions,
} from '../engine/engine'
import { toRimeKey, toRimeKeyRelease, isPrintable } from '../engine/rimeKeys'
import { EMPTY_PREEDIT, type Preedit, type RimeCandidate, type RimeResult } from '../engine/types'
import { useImeControl, type UseImeControlOptions } from './useImeControl'

type AnyKeyboardEvent = KeyboardEvent | { nativeEvent: KeyboardEvent }

function nativeOf(e: AnyKeyboardEvent): KeyboardEvent {
  return 'nativeEvent' in e ? e.nativeEvent : e
}

export interface UseRimeOptions extends RimeEngineOptions, UseImeControlOptions {
  /** Initial committed-text value (uncontrolled buffer). */
  defaultText?: string
  /** Called whenever text is committed by the engine. */
  onCommit?: (committed: string) => void
}

export interface UseRime {
  // lifecycle
  ready: boolean
  loading: boolean
  error: Error | null
  // committed text buffer
  text: string
  setText: (value: string) => void
  // composition state
  composing: boolean
  preedit: Preedit
  candidates: RimeCandidate[]
  highlighted: number
  selectLabels: string[] | undefined
  page: number
  isLastPage: boolean
  // input wiring
  inputRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>
  onKeyDown: (e: AnyKeyboardEvent) => void
  onKeyUp: (e: AnyKeyboardEvent) => void
  // candidate / page actions
  selectCandidate: (index: number) => Promise<void>
  changePage: (backward: boolean) => Promise<void>
  // schema & options (from useImeControl)
  schema: string
  setSchema: (id: string) => Promise<void>
  schemas: ReturnType<typeof useImeControl>['schemas']
  variants: ReturnType<typeof useImeControl>['variants']
  variant: ReturnType<typeof useImeControl>['variant']
  changeVariant: () => Promise<void>
  isEnglish: boolean
  changeLanguage: () => Promise<void>
  isFullWidth: boolean
  changeWidth: () => Promise<void>
  isEnglishPunctuation: boolean
  changePunctuation: () => Promise<void>
  enableEmoji: boolean
  changeEmoji: () => Promise<void>
  hideComment: ReturnType<typeof useImeControl>['hideComment']
}

export function useRime(options: UseRimeOptions = {}): UseRime {
  const { workerUrl, schema, defaultText, onCommit } = options

  const [engine, setEngine] = useState<RimeEngine | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const control = useImeControl(engine, { schema })

  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const [text, setText] = useState(defaultText ?? '')
  const textRef = useRef(text)
  textRef.current = text

  const [composing, setComposing] = useState(false)
  const [preedit, setPreedit] = useState<Preedit>(EMPTY_PREEDIT)
  const [candidates, setCandidates] = useState<RimeCandidate[]>([])
  const [highlighted, setHighlighted] = useState(0)
  const [selectLabels, setSelectLabels] = useState<string[] | undefined>(undefined)
  const [page, setPage] = useState(0)
  const [isLastPage, setIsLastPage] = useState(true)

  // --- create the engine once (per workerUrl) ---
  useEffect(() => {
    let disposed = false
    let created: RimeEngine | null = null
    createRimeEngine({ workerUrl })
      .then((e) => {
        if (disposed) {
          e.dispose()
          return
        }
        created = e
        e.onDeployStatus((status) => {
          if (status === 'success') {
            control.setDeployed(true)
            setReady(true)
          } else if (status === 'failure') {
            setError(new Error('react-rime: RIME deploy failed'))
          }
        })
        setEngine(e)
      })
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
    return () => {
      disposed = true
      created?.dispose()
    }
    // control.setDeployed is a stable state setter
  }, [workerUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- deploy the initial schema once the engine exists ---
  const initedRef = useRef(false)
  useEffect(() => {
    if (engine && !initedRef.current) {
      initedRef.current = true
      control.selectIME(schema ?? control.schemaId)
    }
  }, [engine]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- text insertion at the input's caret (falls back to append) ---
  const insert = useCallback(
    (toInsert: string) => {
      const el = inputRef.current
      const current = textRef.current
      if (!el) {
        const next = current + toInsert
        setText(next)
        onCommit?.(toInsert)
        return
      }
      const start = el.selectionStart ?? current.length
      const end = el.selectionEnd ?? current.length
      const next = current.slice(0, start) + toInsert + current.slice(end)
      setText(next)
      onCommit?.(toInsert)
      requestAnimationFrame(() => {
        const pos = start + toInsert.length
        el.selectionStart = el.selectionEnd = pos
      })
    },
    [onCommit],
  )

  const clearComposition = useCallback(() => {
    setComposing(false)
    setPreedit(EMPTY_PREEDIT)
    setCandidates([])
    setHighlighted(0)
    setSelectLabels(undefined)
  }, [])

  const analyze = useCallback(
    async (result: RimeResult, rimeKey: string) => {
      if (!('updatedSchema' in result) && result.updatedOptions) {
        control.syncOptions(result.updatedOptions)
      }
      if (result.state === 0) {
        clearComposition()
        insert(result.committed)
      } else if (result.state === 1) {
        setPreedit({ head: result.head, body: result.body, tail: result.tail })
        setCandidates(result.candidates)
        setHighlighted(result.highlighted)
        setSelectLabels(result.selectLabels)
        setPage(result.page)
        setIsLastPage(result.isLastPage)
        setComposing(true)
        if (result.committed) insert(result.committed)
      } else {
        clearComposition()
        if (result.state === 2 && result.updatedSchema) {
          await control.setSchema(result.updatedSchema.split('/')[0])
        }
        if (result.state === 3 && isPrintable(rimeKey)) {
          insert(rimeKey)
        }
      }
    },
    [clearComposition, insert, control],
  )

  const input = useCallback(
    async (rimeKey: string) => {
      if (!engine) return
      const result = await engine.process(rimeKey)
      return analyze(result, rimeKey)
    },
    [engine, analyze],
  )

  const onKeyDown = useCallback(
    (evt: AnyKeyboardEvent) => {
      if (!ready || !engine) return
      const e = nativeOf(evt)
      const rimeKey = toRimeKey(e)
      if (!rimeKey) return
      e.preventDefault()
      void input(rimeKey)
    },
    [ready, engine, input],
  )

  const onKeyUp = useCallback(
    (evt: AnyKeyboardEvent) => {
      if (!ready || !engine || !composing) return
      const e = nativeOf(evt)
      const releaseKey = toRimeKeyRelease(e)
      if (releaseKey) void input(releaseKey)
    },
    [ready, engine, composing, input],
  )

  const selectCandidate = useCallback(
    async (index: number) => {
      if (!engine) return
      const raw = await engine.selectCandidateOnCurrentPage(index)
      await analyze(JSON.parse(raw) as RimeResult, '')
    },
    [engine, analyze],
  )

  const changePage = useCallback(
    async (backward: boolean) => {
      if (!engine) return
      const raw = await engine.changePage(backward)
      await analyze(JSON.parse(raw) as RimeResult, '')
    },
    [engine, analyze],
  )

  return {
    ready,
    loading: control.loading,
    error,
    text,
    setText,
    composing,
    preedit,
    candidates,
    highlighted,
    selectLabels,
    page,
    isLastPage,
    inputRef,
    onKeyDown,
    onKeyUp,
    selectCandidate,
    changePage,
    schema: control.schemaId,
    setSchema: control.setSchema,
    schemas: control.schemas,
    variants: control.variants,
    variant: control.variant,
    changeVariant: control.changeVariant,
    isEnglish: control.isEnglish,
    changeLanguage: control.changeLanguage,
    isFullWidth: control.isFullWidth,
    changeWidth: control.changeWidth,
    isEnglishPunctuation: control.isEnglishPunctuation,
    changePunctuation: control.changePunctuation,
    enableEmoji: control.enableEmoji,
    changeEmoji: control.changeEmoji,
    hideComment: control.hideComment,
  }
}
