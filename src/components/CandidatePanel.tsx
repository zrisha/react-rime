import type { HTMLAttributes } from 'react'
import type { UseRime } from '../hooks/useRime'
import type { RimeCandidate } from '../engine/types'
import { useResolvedRime } from './context'

export interface CandidatePanelProps extends HTMLAttributes<HTMLDivElement> {
  /** RIME instance. Omit to use the surrounding <RimeProvider>. */
  rime?: UseRime
  /** Override how a single candidate renders. */
  renderCandidate?: (candidate: RimeCandidate, info: CandidateInfo) => React.ReactNode
}

/** Second argument to {@link CandidatePanelProps.renderCandidate}. */
export interface CandidateInfo {
  /** Index of the candidate on the current page. */
  index: number
  /** Selection label to show (schema-provided, or `"1"`–`"9"`). */
  label: string
  /** `true` for the candidate the engine currently highlights. */
  highlighted: boolean
  /** `true` when the comment should be rendered (respects the schema's `hideComment`). */
  showComment: boolean
  /** Commit this candidate (also refocuses the input). */
  select: () => void
}

/**
 * Unstyled candidate list. Renders nothing when not composing. Each candidate
 * is a button that commits on click. Supply `renderCandidate` for full control,
 * or restyle via `className`/`style` and CSS.
 */
export function CandidatePanel({ rime, renderCandidate, ...rest }: CandidatePanelProps) {
  const r = useResolvedRime(rime)
  if (!r.composing || r.candidates.length === 0) return null

  return (
    <div data-rime-candidates="" {...rest}>
      {r.candidates.map((candidate, index) => {
        const label = r.selectLabels?.[index] ?? String(index + 1)
        const showComment =
          !!candidate.comment &&
          (r.hideComment === false ||
            (r.hideComment === 'emoji' && !/\p{Emoji}/u.test(candidate.text)))
        const info: CandidateInfo = {
          index,
          label,
          highlighted: index === r.highlighted,
          showComment,
          select: () => void r.selectCandidate(index),
        }
        if (renderCandidate) return renderCandidate(candidate, info)
        return (
          <button
            key={index}
            type="button"
            data-rime-candidate=""
            data-highlighted={info.highlighted || undefined}
            onClick={info.select}
          >
            <span data-rime-label="">{label}</span>
            <span data-rime-text="">{candidate.text}</span>
            {showComment && <span data-rime-comment="">{candidate.comment}</span>}
          </button>
        )
      })}
      <button
        type="button"
        data-rime-page="prev"
        disabled={r.page === 0}
        onClick={() => void r.changePage(true)}
      >
        ‹
      </button>
      <button
        type="button"
        data-rime-page="next"
        disabled={r.isLastPage}
        onClick={() => void r.changePage(false)}
      >
        ›
      </button>
    </div>
  )
}
