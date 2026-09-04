import { useState } from 'react'
import { useRime } from 'react-rime'
import './app.css'

export function App() {
  const [pageSize, setPageSize] = useState(9)

  // The whole library surface is this one hook; every element below is plain
  // JSX wired to it — the recommended (headless) integration.
  const rime = useRime({ pageSize })

  return (
    <main className="app">
      <h1>react-rime</h1>
      <p className="sub">
        Headless RIME input-method engine for React. Type pinyin (e.g.{' '}
        <code>ni hao</code>) in the box.
      </p>

      <div className="row">
        <label>
          Schema:&nbsp;
          <select value={rime.schema} onChange={(e) => void rime.setSchema(e.target.value)}>
            {rime.schemas.map((opt) =>
              'children' in opt ? (
                <optgroup key={opt.key} label={opt.label}>
                  {opt.children.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ) : (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Page size:&nbsp;
          <select
            value={pageSize}
            data-testid="page-size"
            onChange={(e) => setPageSize(Number(e.target.value))}
          >
            {[3, 5, 7, 9].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="status" data-testid="status">
          {rime.error
            ? `error: ${rime.error.message}`
            : !rime.ready
              ? 'loading engine…'
              : rime.loading
                ? 'loading schema…'
                : 'ready'}
        </span>
      </div>

      <div className="editor">
        <textarea
          {...rime.getInputProps()}
          rows={6}
          placeholder="Type here…"
          data-testid="input"
        />
        {rime.composing && (
          <div className="preedit" data-testid="preedit">
            {rime.preedit.head}
            <span className="cursor">{rime.preedit.body}</span>
            {rime.preedit.tail}
          </div>
        )}
        {rime.composing && rime.candidates.length > 0 && (
          <div data-rime-candidates="" data-testid="candidates">
            {rime.candidates.map((candidate, index) => {
              // Schemas mark comments that duplicate emoji suggestions with
              // hideComment: 'emoji'; skip those for candidates that are emoji.
              const showComment =
                !!candidate.comment &&
                (rime.hideComment === false ||
                  (rime.hideComment === 'emoji' && !/\p{Emoji}/u.test(candidate.text)))
              return (
                <button
                  key={index}
                  type="button"
                  data-rime-candidate=""
                  data-highlighted={index === rime.highlighted || undefined}
                  {...rime.getCandidateProps(index)}
                >
                  <span data-rime-label="">{rime.selectLabels?.[index] ?? index + 1}</span>
                  <span data-rime-text="">{candidate.text}</span>
                  {showComment && <span data-rime-comment="">{candidate.comment}</span>}
                </button>
              )
            })}
            <button
              type="button"
              data-rime-page="prev"
              disabled={rime.page === 0}
              {...rime.getPagingProps(true)}
            >
              ‹
            </button>
            <button
              type="button"
              data-rime-page="next"
              disabled={rime.isLastPage}
              {...rime.getPagingProps(false)}
            >
              ›
            </button>
          </div>
        )}
      </div>

      {/* Candidates the engine actually returned for this page — compare with
          the Page size select to see whether the setting is taking effect. */}
      <p className="status" data-testid="page-report">
        page size: {pageSize} · candidates on this page:{' '}
        {rime.composing ? rime.candidates.length : '—'}
      </p>

      <pre className="buffer" data-testid="buffer">
        {rime.text}
      </pre>
    </main>
  )
}
