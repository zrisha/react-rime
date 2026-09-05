// The primary headless hook. Owns the engine instance, the composition state
// machine (preedit + candidates), keyboard translation, and the committed text
// buffer. Everything the optional components do is available here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEventCallback } from './useEventCallback'
import {
  createRimeEngine,
  type RimeEngine,
  type RimeEngineOptions,
} from '../engine/engine'
import { toRimeKey, toRimeKeyRelease, isPrintable } from '../engine/rimeKeys'
import { devWarn } from '../engine/devWarn'
import { EMPTY_PREEDIT, type Preedit, type RimeCandidate, type RimeResult } from '../engine/types'
import { useImeControl, type ImeControl, type UseImeControlOptions } from './useImeControl'
import type { SchemaId } from '../engine/schema-ids'

type AnyKeyboardEvent = KeyboardEvent | { nativeEvent: KeyboardEvent }

function nativeOf(e: AnyKeyboardEvent): KeyboardEvent {
  return 'nativeEvent' in e ? e.nativeEvent : e
}

// Shared by getCandidateProps/getPagingProps: preventDefault on pointerdown
// stops the browser's default focus-shift to the button, so the input never
// blurs in the first place. Module-level (not per-render) since it closes
// over nothing.
function preventFocusSteal(e: React.PointerEvent): void {
  e.preventDefault()
}

// Fallback for callers that don't spread getCandidateProps/getPagingProps
// (see RimeButtonProps). Two invariants: it must run before the caller's
// first await, so a raw click is still inside the user gesture (iOS only
// re-shows the keyboard from inside one); and it must be a no-op when focus
// never left, because a redundant focus() still makes mobile Safari scroll
// the input into view. activeElement is read via getRootNode() so the check
// holds inside a shadow root.
function refocusInput(el: HTMLTextAreaElement | HTMLInputElement | null): void {
  if (!el) return
  const root = el.getRootNode() as Document | ShadowRoot
  if (root.activeElement !== el) el.focus({ preventScroll: true })
}

/** Input selection captured before a refocus, so focus handlers can't move it. */
interface Caret {
  start: number | null
  end: number | null
}

export interface UseRimeOptions extends RimeEngineOptions, UseImeControlOptions {
  /** Initial committed-text value (uncontrolled buffer). */
  defaultText?: string
  /** Called whenever text is committed by the engine. */
  onCommit?: (committed: string) => void
  /**
   * Candidates per page. Re-applied whenever this value changes; set it back
   * to `undefined` to restore the schema's own default (usually 5).
   */
  pageSize?: number
  /**
   * Tapping and releasing Shift alone (with no other key in between) calls
   * `changeLanguage()`. Not obviously discoverable to end users and easy to
   * trigger by accident, so it defaults to `false` — opt in explicitly.
   */
  enableShiftToggle?: boolean
  /** Forward `F4` to RIME's schema-selection menu. Default `false`. */
  enableSchemaMenu?: boolean
  /**
   * Forward `Control+\`` (a schema-defined binding) to RIME. Default `false`
   * since it can collide with the host page's own bindings (e.g. VS Code's
   * terminal toggle).
   */
  enableControlBacktick?: boolean
}

/** Consumer handlers merged into {@link UseRime.getInputProps}'s result. */
export interface RimeInputPropsOverrides<T extends HTMLTextAreaElement | HTMLInputElement> {
  /** Your own ref to the element; merged with the hook's internal ref. */
  ref?: React.Ref<T>
  onChange?: React.ChangeEventHandler<T>
  onKeyDown?: React.KeyboardEventHandler<T>
  onKeyUp?: React.KeyboardEventHandler<T>
}

/** What {@link UseRime.getInputProps} returns — spread it onto your element. */
export interface RimeInputProps<T extends HTMLTextAreaElement | HTMLInputElement> {
  ref: React.RefCallback<T>
  value: string
  onChange: React.ChangeEventHandler<T>
  onKeyDown: React.KeyboardEventHandler<T>
  onKeyUp: React.KeyboardEventHandler<T>
  autoCapitalize: string
  autoCorrect: string
  autoComplete: string
  spellCheck: boolean
}

/**
 * What {@link UseRime.getCandidateProps} and {@link UseRime.getPagingProps}
 * return — spread onto a candidate/paging button. `onPointerDown` calls
 * `preventDefault()` so the browser never moves focus off the input on tap;
 * without it, focus (and on iOS the on-screen keyboard) leaves the input the
 * instant you press the button. {@link UseRime.selectCandidate} does refocus
 * the input as a fallback, but only synchronously at the start of the click
 * (still inside the user gesture); on iOS that means a keyboard hide/show
 * flicker rather than a seamless tap.
 */
export interface RimeButtonProps {
  onClick: () => void
  onPointerDown: (e: React.PointerEvent) => void
}

/** Everything {@link useRime} returns. Each field shows its description on hover. */
export interface UseRime {
  // --- lifecycle ---
  /** `true` once the engine has loaded and the initial schema is active. */
  ready: boolean
  /** `true` while the engine is busy (initial load or switching schema). */
  loading: boolean
  /** Set if the worker/engine failed to load; otherwise `null`. */
  error: Error | null

  // --- committed text buffer ---
  /** The committed text (everything the user has confirmed). */
  text: string
  /** Replace the committed text buffer. */
  setText: (value: string) => void

  // --- composition (in-progress input) ---
  /** `true` while the user is mid-composition (a preedit is showing). */
  composing: boolean
  /** The preedit string split into `{ head, body, tail }` around the cursor. */
  preedit: Preedit
  /** Candidates for the current page: `{ text, comment? }`. */
  candidates: RimeCandidate[]
  /** Index into {@link candidates} of the currently highlighted one. */
  highlighted: number
  /** Selection labels (usually `"1"`–`"9"`) when the schema provides them. */
  selectLabels: string[] | undefined
  /** Zero-based index of the current candidate page. */
  page: number
  /** `true` when there are no more candidate pages after this one. */
  isLastPage: boolean

  // --- input wiring ---
  /**
   * One spread wires an input: `<textarea {...rime.getInputProps()} />`.
   * Binds ref, value, onChange, onKeyDown, onKeyUp, and disables the
   * browser's word-level assists (autocapitalize/autocorrect/autocomplete/
   * spellcheck), which fight a roman-input buffer. Pass your own handlers or
   * ref via `overrides` and they run after the hook's; other attributes can
   * be overridden by setting them after the spread.
   */
  getInputProps: <T extends HTMLTextAreaElement | HTMLInputElement = HTMLTextAreaElement>(
    overrides?: RimeInputPropsOverrides<T>,
  ) => RimeInputProps<T>
  /** Attach to your `<textarea>`/`<input>` so commits insert at the caret. */
  inputRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>
  /** Forward your element's `keydown` here to feed keystrokes to the engine. */
  onKeyDown: (e: AnyKeyboardEvent) => void
  /** Forward your element's `keyup` here (needed for some key-release behavior). */
  onKeyUp: (e: AnyKeyboardEvent) => void

  // --- candidate / page actions ---
  /**
   * Commit the candidate at `index` on the current page. Refocuses the input
   * if it lost focus; for pointer UIs prefer {@link getCandidateProps}, which
   * keeps focus from leaving in the first place (see {@link RimeButtonProps}).
   */
  selectCandidate: (index: number) => Promise<void>
  /**
   * Page through candidates; `true` goes back, `false` goes forward. Same
   * caveat as {@link selectCandidate} — prefer {@link getPagingProps} for a
   * button's `onClick`.
   */
  changePage: (backward: boolean) => Promise<void>
  /**
   * One spread wires a candidate button: `<button {...rime.getCandidateProps(i)}>`.
   * Calls {@link selectCandidate} and keeps focus on the input (see
   * {@link RimeButtonProps}). If you need your own click handler too, spread
   * this first and add `onClick` after it — a trailing `onClick` replaces the
   * hook's rather than merging, so call `selectCandidate(i)` from yours; the
   * spread still contributes `onPointerDown`, which is what keeps focus.
   */
  getCandidateProps: (index: number) => RimeButtonProps
  /**
   * One spread wires a paging button: `<button {...rime.getPagingProps(true)}>`.
   * Calls {@link changePage} and keeps focus on the input (see
   * {@link RimeButtonProps}). Same caveat as {@link getCandidateProps} about
   * spread order.
   */
  getPagingProps: (backward: boolean) => RimeButtonProps
  /** Cancel the in-progress composition, discarding the preedit (Escape). */
  cancelComposition: () => Promise<void>
  /** Commit the currently highlighted candidate (Space). */
  commitHighlighted: () => Promise<void>
  /** Commit the preedit as typed, e.g. the raw pinyin letters (Enter). */
  commitRaw: () => Promise<void>
  /** Move the candidate highlight to the next candidate (Down). */
  highlightNext: () => Promise<void>
  /** Move the candidate highlight to the previous candidate (Up). */
  highlightPrev: () => Promise<void>

  // --- schema & options ---
  /** Id of the active input schema (e.g. `"luna_pinyin"`). */
  schema: string
  /** Switch to a different schema by id (autocompletes the bundled ids). */
  setSchema: (id: SchemaId | (string & {})) => Promise<void>
  /**
   * Delete every user dictionary librime has learned — wire this to a "forget
   * what I typed" control. Independent of the `userDict` option: useful even
   * with learning left on.
   */
  clearLearned: () => Promise<void>
  /** Grouped options for building a schema `<select>`. */
  schemas: ImeControl['schemas']
  /** Script variants available for the active schema (e.g. 简/繁). */
  variants: ImeControl['variants']
  /** The currently active script variant. */
  variant: ImeControl['variant']
  /** Cycle to the next script variant (e.g. toggle 简 ⇄ 繁). */
  changeVariant: () => Promise<void>
  /** `true` when ASCII (English) mode is on. */
  isEnglish: boolean
  /** Toggle ASCII (English) mode on/off. */
  changeLanguage: () => Promise<void>
  /** `true` when full-width character mode is on. */
  isFullWidth: boolean
  /** Toggle full-width vs. half-width characters. */
  changeWidth: () => Promise<void>
  /** `true` when punctuation is in ASCII (English) form. */
  isEnglishPunctuation: boolean
  /** Toggle ASCII vs. Chinese punctuation. */
  changePunctuation: () => Promise<void>
  /** `true` when the extended charset (rare CJK blocks) is enabled. Persisted to localStorage. */
  isExtendedCharset: boolean
  /** Toggle the extended charset on/off. */
  changeCharset: () => Promise<void>
  /** `true` when emoji suggestions are enabled. Persisted to localStorage. */
  enableEmoji: boolean
  /** Toggle emoji suggestions on/off (the old my-rime emoji button). */
  changeEmoji: () => Promise<void>
  /** Whether/which candidate comments the active schema hides (`false` | `'emoji'`). */
  hideComment: ImeControl['hideComment']
  /**
   * Id of the fully configured schema: empty while a switch is in flight,
   * equal to {@link schema} once its options re-sync. {@link loading} is the
   * simple busy flag; this tells you exactly which schema has settled.
   */
  ime: string
  /** `false` while switching schema — hide variant UI until the switch settles. */
  showVariant: boolean
  /**
   * Current values of the tracked boolean options, keyed by librime option
   * name (e.g. `ascii_mode`). Pairs with {@link setOption}.
   */
  options: Record<string, boolean>
  /**
   * Set any librime boolean option by name, e.g. `setOption('ascii_mode',
   * true)` — the escape hatch behind the named toggles ({@link changeLanguage}
   * etc.), for options this hook doesn't wrap. Tracked options also update
   * {@link options} and their named field.
   */
  setOption: (name: string, value: boolean) => Promise<void>
}

/**
 * ImeControl fields useRime deliberately keeps to itself — plumbing it owns
 * (deploy state, syncOptions) or renames (schemaId → schema). Keep in sync with
 * the destructure in the return memo.
 */
type ControlOnlyField =
  | 'schemaId'
  | 'selectIME'
  | 'setSchema'
  | 'deployed'
  | 'setDeployed'
  | 'variantIndex'
  | 'syncOptions'

/**
 * useRime re-exposes ImeControl by spreading it, which means a field added to
 * ImeControl reaches consumers at runtime automatically — and TypeScript does
 * not excess-property-check spread results, so it would do so without being
 * declared on UseRime: undocumented public API. This fails to compile in that
 * case; the fix is to either declare the field on UseRime or, if it's internal,
 * add it to ControlOnlyField and the destructure.
 *
 * Exported only to satisfy noUnusedLocals — index.ts re-exports by name, so it
 * stays out of the package's public types.
 */
type MustBeNever<T extends never> = T
export type AssertNoLeakedControlFields = MustBeNever<
  Exclude<Exclude<keyof ImeControl, ControlOnlyField>, keyof UseRime>
>

/**
 * The primary hook. Creates and owns a RIME engine instance, runs the
 * composition state machine, and exposes the committed-text buffer plus schema
 * and option controls. The entire library is usable through the object it
 * returns; the bundled components are optional conveniences on top of it.
 *
 * @example
 * ```tsx
 * const rime = useRime({ schema: 'luna_pinyin' })
 * <textarea {...rime.getInputProps()} />
 * ```
 */
export function useRime(options: UseRimeOptions = {}): UseRime {
  const {
    workerUrl,
    schema,
    userDict,
    defaultText,
    onCommit,
    pageSize,
    enableSchemaMenu = false,
    enableControlBacktick = false,
    enableShiftToggle = false,
  } = options

  const [engine, setEngine] = useState<RimeEngine | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const control = useImeControl(engine, { schema, userDict })

  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const [text, setTextState] = useState(defaultText ?? '')
  // Mirror of `text` that is current the moment it's written (state lags a
  // render), so consecutive commits in one tick read the right buffer.
  const textRef = useRef(text)
  const setText = useCallback((value: string) => {
    textRef.current = value
    setTextState(value)
  }, [])

  const [composing, setComposing] = useState(false)
  // Synchronous mirror of `composing`, flipped in onKeyDown *before* the async
  // worker round trip (like my_rime's `editing`). Gating key handlers on the
  // React state instead would drop key-release events that arrive before the
  // re-render — breaking chord/release-driven schemas.
  const composingRef = useRef(false)
  // True while Shift is down with no other key: a bare Shift tap toggles
  // English mode on release (the standard IME gesture, from my_rime).
  const exclusiveShiftRef = useRef(false)
  const [preedit, setPreedit] = useState<Preedit>(EMPTY_PREEDIT)
  const [candidates, setCandidates] = useState<RimeCandidate[]>([])
  const [highlighted, setHighlighted] = useState(0)
  const [selectLabels, setSelectLabels] = useState<string[] | undefined>(undefined)
  const [page, setPage] = useState(0)
  const [isLastPage, setIsLastPage] = useState(true)

  // --- create the engine once (per workerUrl) ---
  const initedRef = useRef(false)
  useEffect(() => {
    let disposed = false
    let created: RimeEngine | null = null
    // On workerUrl change this re-runs against a fresh worker: reset the
    // lifecycle so the init effect below deploys a schema on the new engine.
    // Deliberate sync setState: this is a reset-on-dep-change, not a
    // render-driven update (no-ops on first mount).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEngine(null)
    setReady(false)
    control.setDeployed(false)
    createRimeEngine({ workerUrl })
      .then((e) => {
        if (disposed) {
          e.dispose()
          return
        }
        created = e
        // Full deploys emit this; prebuilt-schema startup does not. It marks the
        // engine "deployed" (schema-name source) but is NOT the readiness gate.
        e.onDeployStatus((status) => {
          if (status === 'success') {
            control.setDeployed(true)
          } else if (status === 'failure') {
            setError(new Error('react-rime: RIME deploy failed'))
          }
        })
        setEngine(e)
      })
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
    return () => {
      disposed = true
      initedRef.current = false
      created?.dispose()
    }
    // control.setDeployed is a stable state setter
  }, [workerUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- keep candidates-per-page in sync with the pageSize option ---
  // Unlike the boolean options (which librime resets on schema switch, hence
  // the re-sync in useImeControl.selectIME), page size survives `set_ime` —
  // verified against the real engine — so schemaId is deliberately not a dep.
  // A change mid-composition lands on the next keystroke, not retroactively.
  // `setPageSize(0)` means "use the schema's own menu/page_size" (my_rime's
  // librime patch treats 0 as unset), so dropping the option restores the
  // schema default without us hardcoding librime's 5. The ref remembers which
  // engine a custom size was applied to, so a fresh engine (already at the
  // default) is never sent a spurious reset.
  const pageSizeAppliedToRef = useRef<RimeEngine | null>(null)
  useEffect(() => {
    if (!engine) return
    if (pageSize !== undefined) {
      pageSizeAppliedToRef.current = engine
    } else if (pageSizeAppliedToRef.current !== engine) {
      return
    } else {
      pageSizeAppliedToRef.current = null
    }
    engine
      .setPageSize(pageSize ?? 0)
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
  }, [engine, pageSize])

  // --- deploy the initial schema once the engine exists ---
  useEffect(() => {
    if (engine && !initedRef.current) {
      initedRef.current = true
      // Ready once the initial schema is selected (prebuilt dicts fetched +
      // schema active). This mirrors my_rime gating UI on `loading`, not deploy.
      control
        .selectIME(schema ?? control.schemaId)
        .then(() => setReady(true))
        .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
    }
  }, [engine]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- text insertion at the input's caret (falls back to append) ---
  const insert = useCallback(
    (toInsert: string, caret?: Caret) => {
      const el = inputRef.current
      const current = textRef.current
      if (!el) {
        devWarn(
          'no-input',
          'text was committed but no input element is attached — appending to the end of the buffer. ' +
            'Spread getInputProps() onto your element (or attach inputRef) for caret-aware insertion.',
        )
        const next = current + toInsert
        setText(next)
        onCommit?.(toInsert)
        return
      }
      const start = caret?.start ?? el.selectionStart ?? current.length
      const end = caret?.end ?? el.selectionEnd ?? current.length
      const next = current.slice(0, start) + toInsert + current.slice(end)
      setText(next)
      onCommit?.(toInsert)
      requestAnimationFrame(() => {
        const pos = start + toInsert.length
        el.selectionStart = el.selectionEnd = pos
      })
    },
    [onCommit, setText],
  )

  const clearComposition = useCallback(() => {
    composingRef.current = false
    setComposing(false)
    setPreedit(EMPTY_PREEDIT)
    setCandidates([])
    setHighlighted(0)
    setSelectLabels(undefined)
    setPage(0)
    setIsLastPage(true)
  }, [])

  const analyze = useCallback(
    async (result: RimeResult, rimeKey: string, caret?: Caret) => {
      if (!('updatedSchema' in result) && result.updatedOptions) {
        control.syncOptions(result.updatedOptions)
      }
      if (result.state === 0) {
        clearComposition()
        insert(result.committed, caret)
      } else if (result.state === 1) {
        composingRef.current = true
        setPreedit({ head: result.head, body: result.body, tail: result.tail })
        setCandidates(result.candidates)
        setHighlighted(result.highlighted)
        setSelectLabels(result.selectLabels)
        setPage(result.page)
        setIsLastPage(result.isLastPage)
        setComposing(true)
        if (result.committed) insert(result.committed, caret)
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

  const onKeyDown = useEventCallback(
    (evt: AnyKeyboardEvent) => {
      // Also gate on `loading` so keystrokes typed mid-schema-switch aren't
      // processed against a half-configured schema.
      if (!ready || !engine || control.loading) return
      const el = inputRef.current
      if (el && el.value !== textRef.current) {
        devWarn(
          'value-drift',
          "the input's value has drifted from rime.text — bind value={rime.text} and " +
            'onChange (or spread getInputProps()). Ignore this if you manage text yourself via onCommit.',
        )
      }
      const e = nativeOf(evt)
      if (e.key === 'Shift') {
        exclusiveShiftRef.current = enableShiftToggle
        return
      }
      exclusiveShiftRef.current = false
      const rimeKey = toRimeKey(e, composingRef.current, { enableSchemaMenu, enableControlBacktick })
      if (!rimeKey) return
      // Mark composing before the worker responds so keyups in flight are
      // forwarded as releases (my_rime sets `editing` at the same point).
      composingRef.current = true
      e.preventDefault()
      void input(rimeKey)
    },
  )

  const onKeyUp = useEventCallback(
    (evt: AnyKeyboardEvent) => {
      if (!ready || !engine || control.loading) return
      const e = nativeOf(evt)
      if (e.key === 'Shift' && exclusiveShiftRef.current) {
        void control.changeLanguage()
      }
      exclusiveShiftRef.current = false
      if (!composingRef.current) return
      const releaseKey = toRimeKeyRelease(e)
      if (releaseKey) void input(releaseKey)
    },
  )

  // Post the engine call before refocusing (see refocusInput): the worker is
  // strict FIFO, and the refocus synchronously blurs whatever held focus, so
  // a consumer blur handler (e.g. cancel-on-blur) must not get its message in
  // ahead of ours. The caret is captured before the refocus too, so a focus
  // handler that moves the selection can't change where the commit lands.
  const runEngineAction = useEventCallback(
    async (call: (e: RimeEngine) => Promise<string>) => {
      if (!engine) return
      const pending = call(engine)
      const el = inputRef.current
      const caret = el ? { start: el.selectionStart, end: el.selectionEnd } : undefined
      refocusInput(el)
      await analyze(JSON.parse(await pending) as RimeResult, '', caret)
    },
  )

  const selectCandidate = useEventCallback((index: number) =>
    runEngineAction((e) => e.selectCandidateOnCurrentPage(index)),
  )

  const changePage = useEventCallback((backward: boolean) =>
    runEngineAction((e) => e.changePage(backward)),
  )

  const getCandidateProps = useCallback(
    (index: number): RimeButtonProps => ({
      onClick: () => void selectCandidate(index),
      onPointerDown: preventFocusSteal,
    }),
    [selectCandidate],
  )

  const getPagingProps = useCallback(
    (backward: boolean): RimeButtonProps => ({
      onClick: () => void changePage(backward),
      onPointerDown: preventFocusSteal,
    }),
    [changePage],
  )

  // Semantic wrappers over the key protocol so pointer-driven UIs never need
  // to fabricate KeyboardEvents. Each is a no-op unless composing.
  const sendIfComposing = useEventCallback(
    async (rimeKey: string) => {
      if (!composingRef.current) return
      await input(rimeKey)
    },
  )
  const cancelComposition = useCallback(() => sendIfComposing('{Escape}'), [sendIfComposing])
  const commitHighlighted = useCallback(() => sendIfComposing(' '), [sendIfComposing])
  const commitRaw = useCallback(() => sendIfComposing('{Return}'), [sendIfComposing])
  const highlightNext = useCallback(() => sendIfComposing('{Down}'), [sendIfComposing])
  const highlightPrev = useCallback(() => sendIfComposing('{Up}'), [sendIfComposing])

  const getInputProps = useCallback(
    <T extends HTMLTextAreaElement | HTMLInputElement = HTMLTextAreaElement>(
      overrides: RimeInputPropsOverrides<T> = {},
    ): RimeInputProps<T> => ({
      ref: (el: T | null) => {
        ;(inputRef as React.MutableRefObject<T | null>).current = el
        const consumerRef = overrides.ref
        if (typeof consumerRef === 'function') consumerRef(el)
        else if (consumerRef) (consumerRef as React.MutableRefObject<T | null>).current = el
      },
      value: text,
      onChange: (e) => {
        setText(e.target.value)
        overrides.onChange?.(e)
      },
      onKeyDown: (e) => {
        onKeyDown(e)
        overrides.onKeyDown?.(e)
      },
      onKeyUp: (e) => {
        onKeyUp(e)
        overrides.onKeyUp?.(e)
      },
      // The buffer is roman/pinyin input, not real words, so the browser's
      // word-level assists (autocorrect, autocapitalize, spellcheck,
      // autocomplete) fight the user rather than help. Consumers can still
      // override any of these by setting the attribute after the spread.
      autoCapitalize: 'off',
      autoCorrect: 'off',
      autoComplete: 'off',
      spellCheck: false,
    }),
    // onKeyDown/onKeyUp are identity-stable; value is the real dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, setText],
  )

  const setSchema = useEventCallback(async (id: string) => {
    // engine.setIME resets the librime session, destroying any in-flight
    // composition — so drop ours up front rather than leaving a preedit and
    // candidates on screen that belong to the schema we're leaving. Clearing
    // first (not after) means the panel goes away when the user picks the
    // schema, not when the switch finishes.
    clearComposition()
    try {
      await control.setSchema(id)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    }
  })

  const clearLearned = useEventCallback(async () => {
    // Same reasoning as setSchema: clearing re-selects the schema, which resets
    // the librime session and kills any in-flight composition — so drop the
    // preedit up front instead of leaving a dead panel on screen.
    clearComposition()
    try {
      await control.clearLearned()
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    }
  })

  // Memoized so the object identity (e.g. as a context value in RimeProvider)
  // only changes when state does; every function above is identity-stable.
  return useMemo(
    () => {
      // Re-expose the whole ImeControl surface except the plumbing useRime owns
      // or renames. Spreading (instead of hand-copying each field) is what keeps
      // ime/showVariant/options/setOption from being silently dropped here.
      const {
        schemaId,
        selectIME: _selectIME,
        setSchema: _setSchema,
        deployed: _deployed,
        setDeployed: _setDeployed,
        variantIndex: _variantIndex,
        syncOptions: _syncOptions,
        clearLearned: _clearLearned,
        ...publicControl
      } = control
      return {
        ...publicControl,
        schema: schemaId,
        setSchema,
        clearLearned,
        // lifecycle / committed-text buffer / composition owned by useRime
        ready,
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
        getInputProps,
        inputRef,
        onKeyDown,
        onKeyUp,
        selectCandidate,
        changePage,
        getCandidateProps,
        getPagingProps,
        cancelComposition,
        commitHighlighted,
        commitRaw,
        highlightNext,
        highlightPrev,
      }
    },
    // functions are identity-stable except getInputProps (tracks text); control
    // is memoized on its own state, so its identity is the option/schema dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      ready,
      control,
      error,
      text,
      composing,
      preedit,
      candidates,
      highlighted,
      selectLabels,
      page,
      isLastPage,
      getInputProps,
    ],
  )
}
