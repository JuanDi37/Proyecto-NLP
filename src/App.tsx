import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MODEL,
  checkOllama,
  polish,
  stripPlaceholders,
  warmUp,
  type Setting,
  type Status,
  type Tone,
} from './ollama'

const SETTINGS: { value: Setting; label: string }[] = [
  { value: 'academic', label: 'Academic' },
  { value: 'work', label: 'Work' },
]

const TONES: { value: Tone; label: string }[] = [
  { value: 'formal', label: 'Formal' },
  { value: 'warm', label: 'Warm' },
  { value: 'concise', label: 'Concise' },
]

const EXAMPLE =
  'hey prof, cant make it to class thursday im sick, can u send me the notes. also is the essay still due fri? thx'

function Segmented<T extends string>(props: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="field">
      <span className="field-label">{props.label}</span>
      <div className="segmented" role="radiogroup" aria-label={props.label}>
        {props.options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={props.value === o.value}
            className={props.value === o.value ? 'active' : ''}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const [draft, setDraft] = useState('')
  const [output, setOutput] = useState('')
  const [setting, setSetting] = useState<Setting>('academic')
  const [tone, setTone] = useState<Tone>('formal')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<Status>('checking')
  const [rating, setRating] = useState<'good' | 'bad' | ''>('')
  const [comment, setComment] = useState('')
  const [fbState, setFbState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    checkOllama().then((s) => {
      setStatus(s)
      if (s === 'ready') warmUp()
    })
  }, [])

  const run = async () => {
    if (!draft.trim() || busy) return
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true)
    setError('')
    setOutput('')
    setCopied(false)
    setRating('')
    setComment('')
    setFbState('idle')
    try {
      await polish(draft, { setting, tone }, (c) => setOutput((o) => o + c), ctrl.signal)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message || 'Something went wrong.')
      }
    } finally {
      setBusy(false)
    }
  }

  const stop = () => abortRef.current?.abort()

  const copy = async () => {
    await navigator.clipboard.writeText(subject ? `Subject: ${subject}\n\n${body}` : body)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const { subject, body } = useMemo(() => {
    const clean = stripPlaceholders(output)
    const m = clean.match(/^\s*(?:Subject|Asunto):\s*(.*)\n?/i)
    return m
      ? { subject: m[1].trim(), body: clean.slice(m[0].length).replace(/^\s+/, '') }
      : { subject: '', body: clean }
  }, [output])

  const sendFeedback = async () => {
    setFbState('sending')
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          setting,
          tone,
          rating,
          draft,
          result: subject ? `Subject: ${subject}\n\n${body}` : body,
          feedback: comment,
        }),
      })
      setFbState(res.ok ? 'sent' : 'error')
    } catch {
      setFbState('error')
    }
  }

  const statusText = {
    checking: 'Connecting to Ollama…',
    ready: `${MODEL} · local`,
    'no-model': `Model missing — run: ollama pull ${MODEL}`,
    offline: 'Ollama is not running',
  }[status]

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
          <span>Mail Polish</span>
        </div>
        <div className={`status ${status}`} title="Runs fully on your machine">
          <i />
          {statusText}
        </div>
      </header>

      <main className="main">
        <div className="intro">
          <h1>Turn rough drafts into professional emails.</h1>
          <p>Paste what you'd actually type. Nothing leaves your computer.</p>
        </div>

        <div className="controls">
          <Segmented label="Setting" value={setting} options={SETTINGS} onChange={setSetting} />
          <Segmented label="Tone" value={tone} options={TONES} onChange={setTone} />
        </div>

        <div className="panes">
          <section className="card">
            <div className="card-head">
              <h2>Your draft</h2>
              {!draft && (
                <button className="link" type="button" onClick={() => setDraft(EXAMPLE)}>
                  Try an example
                </button>
              )}
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run()
              }}
              placeholder="hey, cant come to the meeting tmrw, something came up, can we move it to wed?"
              spellCheck={false}
              autoFocus
            />
            <div className="card-foot">
              <span className="hint">Ctrl + Enter to polish</span>
              {busy ? (
                <button className="btn secondary" onClick={stop}>
                  Stop
                </button>
              ) : (
                <button
                  className="btn primary"
                  onClick={run}
                  disabled={!draft.trim() || status === 'offline' || status === 'no-model'}
                >
                  Polish email
                </button>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Professional version</h2>
              {output && !busy && (
                <button className="link" type="button" onClick={copy}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              )}
            </div>
            <div className="output" aria-live="polite">
              {error ? (
                <p className="error">{error}</p>
              ) : output ? (
                <>
                  {subject && (
                    <div className="subject">
                      <span>Subject</span>
                      {subject}
                    </div>
                  )}
                  <div className={`body ${busy ? 'streaming' : ''}`}>{body}</div>
                </>
              ) : (
                <p className="placeholder">
                  {busy
                    ? 'Warming up the model — the first run can take a minute…'
                    : 'Your polished email will appear here.'}
                </p>
              )}
            </div>
            {output && !busy && !error && (
              <div className="feedback">
                {fbState === 'sent' ? (
                  <p className="fb-done">Thanks — saved to data/feedback.csv ✓</p>
                ) : (
                  <>
                    <div className="fb-row">
                      <span className="field-label">How was this?</span>
                      <button
                        type="button"
                        className={`thumb ${rating === 'good' ? 'on' : ''}`}
                        onClick={() => setRating('good')}
                        aria-pressed={rating === 'good'}
                        aria-label="Good"
                      >
                        👍
                      </button>
                      <button
                        type="button"
                        className={`thumb ${rating === 'bad' ? 'on' : ''}`}
                        onClick={() => setRating('bad')}
                        aria-pressed={rating === 'bad'}
                        aria-label="Bad"
                      >
                        👎
                      </button>
                    </div>
                    <textarea
                      className="fb-text"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="What was off, or good? (optional)"
                      rows={2}
                    />
                    <div className="fb-row">
                      <button
                        className="btn secondary"
                        onClick={sendFeedback}
                        disabled={(!rating && !comment.trim()) || fbState === 'sending'}
                      >
                        {fbState === 'sending' ? 'Saving…' : 'Save feedback'}
                      </button>
                      {fbState === 'error' && <span className="error">Couldn't save — is the dev server running?</span>}
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
