import { useRime } from 'react-rime'
import './app.css'

export function App() {
  // The whole library surface is this one hook; every element below is plain
  // JSX wired to it — the recommended (headless) integration.
  const rime = useRime()

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
                  onClick={() => void rime.selectCandidate(index)}
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
              onClick={() => void rime.changePage(true)}
            >
              ‹
            </button>
            <button
              type="button"
              data-rime-page="next"
              disabled={rime.isLastPage}
              onClick={() => void rime.changePage(false)}
            >
              ›
            </button>
          </div>
        )}
      </div>

      <pre className="buffer" data-testid="buffer">
        {rime.text}
      </pre>
    </main>
  )
}
