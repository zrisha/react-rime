// Public engine types. These mirror the JSON the RIME worker returns.
// Exported as named types (not ambient globals) so the library is self-contained.

/** A character (or string) was committed — append it to the text buffer. */
export type RimeCommitted = {
  state: 0
  committed: string
}

/** Still composing — render preedit + candidate list. */
export type RimeAccepted = {
  state: 1
  committed?: string
  /** Confirmed preedit before the cursor. */
  head: string
  /** Preedit under the cursor. */
  body: string
  /** Preedit after the cursor. */
  tail: string
  page: number
  isLastPage: boolean
  /** Index of the currently highlighted candidate. */
  highlighted: number
  selectLabels?: string[]
  candidates: RimeCandidate[]
}

/** The key was rejected (composition ended without commit). */
export type RimeRejected = {
  state: 2
  updatedSchema?: string
}

/** The key was not handled by the engine (pass it through). */
export type RimeUnhandled = {
  state: 3
}

export type RimeUpdatedOptions = {
  updatedOptions?: string[]
}

export type RimeCandidate = {
  text: string
  comment?: string
}

export type RimeResult = (
  | RimeCommitted
  | RimeAccepted
  | RimeRejected
  | RimeUnhandled
) &
  RimeUpdatedOptions

export type RimeLanguage = 'zh-CN' | 'zh-TW' | 'zh-HK' | 'zh-SG'

export type Preedit = {
  head: string
  body: string
  tail: string
}

export const EMPTY_PREEDIT: Preedit = { head: '', body: '', tail: '' }
