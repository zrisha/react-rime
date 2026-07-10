import { useRime, RimeTextarea, CandidatePanel, SchemaSelector } from 'react-rime'
import './app.css'

export function App() {
  // The whole library surface is this one hook. Components below are optional.
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
          <SchemaSelector rime={rime} />
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
        <RimeTextarea
          rime={rime}
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
        <CandidatePanel rime={rime} className="candidates" data-testid="candidates" />
      </div>

      <pre className="buffer" data-testid="buffer">
        {rime.text}
      </pre>
    </main>
  )
}
