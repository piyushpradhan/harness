import { useState } from 'react'
import type { ModelInfo, ProfileSummary } from '../../../shared/types'

export type SessionStatus = 'idle' | 'connecting' | 'streaming' | 'done' | 'cancelled' | 'error'

interface ChatPanelProps {
  profile: ProfileSummary | null
  models: ModelInfo[]
  modelsLoading: boolean
  modelsError: string | null
  model: string
  onModelChange: (id: string) => void
  status: SessionStatus
  output: string
  error: string | null
  durationMs: number | null
  elapsedSec: number
  canSend: boolean
  systemPrompt: string
  onSystemPromptChange: (value: string) => void
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onStop: () => void
}

export function ChatPanel(props: ChatPanelProps): JSX.Element {
  const [sysOpen, setSysOpen] = useState(false)
  const {
    profile,
    models,
    modelsLoading,
    modelsError,
    model,
    onModelChange,
    status,
    output,
    error,
    durationMs,
    elapsedSec,
    canSend,
    systemPrompt,
    onSystemPromptChange,
    input,
    onInputChange,
    onSend,
    onStop
  } = props

  const active = status === 'connecting' || status === 'streaming'

  let statusText = 'idle'
  switch (status) {
    case 'connecting':
      statusText = `connecting… ${elapsedSec}s`
      break
    case 'streaming':
      statusText = `streaming… ${elapsedSec}s`
      break
    case 'done':
      statusText = durationMs !== null ? `done in ${(durationMs / 1000).toFixed(1)}s` : 'done'
      break
    case 'cancelled':
      statusText = 'cancelled'
      break
    case 'error':
      statusText = 'error'
      break
    case 'idle':
      break
  }

  return (
    <main className="panel">
      <header className="panel-header">
        <div className="model-row">
          <label htmlFor="model-select">Model</label>
          <select
            id="model-select"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={active || modelsLoading || models.length === 0}
          >
            <option value="" disabled>
              {modelsLoading ? 'loading models…' : models.length === 0 ? 'no models available' : 'select a model'}
            </option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? m.id}
              </option>
            ))}
          </select>
          {profile !== null && <span className="profile-tag">{profile.name}</span>}
        </div>

        {modelsError !== null && <div className="banner error">{modelsError}</div>}

        <div className="sysprompt">
          <button
            type="button"
            className="ghost"
            onClick={() => setSysOpen((open) => !open)}
            disabled={active}
          >
            {sysOpen ? '▾' : '▸'} system prompt
          </button>
          {sysOpen && (
            <textarea
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              disabled={active}
              placeholder="Optional system prompt…"
              rows={4}
            />
          )}
        </div>
      </header>

      <section className="output">
        {output === '' && status === 'idle' && error === null && (
          <p className="muted">Type a message to start a session.</p>
        )}
        {output !== '' && <pre className="output-text">{output}</pre>}
        {error !== null && <div className="banner error">{error}</div>}
      </section>

      <footer className="composer">
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              onSend()
            }
          }}
          disabled={active}
          placeholder={profile !== null ? 'Message…' : 'Add a profile to start'}
          rows={3}
        />
        <div className="composer-actions">
          <span className={`status status-${status}`}>{statusText}</span>
          {active && (
            <button type="button" className="danger" onClick={onStop}>
              Stop
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={onSend}
            disabled={!canSend || input.trim() === ''}
          >
            Send
          </button>
        </div>
      </footer>
    </main>
  )
}