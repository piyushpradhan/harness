import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ProfileInput } from '../../../shared/ipc'
import type { ProfileSummary, ProviderType } from '../../../shared/types'

interface ProfileRailProps {
  profiles: ProfileSummary[] | null
  selectedId: string | null
  disabled: boolean
  error: string | null
  onSelect: (id: string) => void
  onSave: (input: ProfileInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onDismissError: () => void
}

interface FormState {
  editingId: string | null
  type: ProviderType
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

const EMPTY_FORM: FormState = {
  editingId: null,
  type: 'openai-compat',
  name: '',
  baseUrl: '',
  apiKey: '',
  model: ''
}

export function ProfileRail(props: ProfileRailProps): JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const startCreate = (): void => {
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  const startEdit = (p: ProfileSummary): void => {
    setForm({
      editingId: p.id,
      type: p.type,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: '',
      model: p.model ?? ''
    })
    setFormError(null)
  }

  const setField = (patch: Partial<FormState>): void => {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    if (form.name.trim() === '' || form.baseUrl.trim() === '') {
      setFormError('name and base URL are required')
      return
    }
    setBusy(true)
    setFormError(null)
    void props
      .onSave({
        id: form.editingId ?? undefined,
        type: form.type,
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim() === '' ? undefined : form.model.trim(),
        apiKey: form.apiKey.trim() === '' ? undefined : form.apiKey.trim()
      })
      .then(() => {
        setForm(EMPTY_FORM)
        setFormError(null)
      })
      .catch((err: unknown) => {
        setFormError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setBusy(false))
  }

  const remove = (id: string, name: string): void => {
    if (!window.confirm(`Delete profile “${name}”?`)) return
    setBusy(true)
    setFormError(null)
    void props
      .onDelete(id)
      .catch((err: unknown) => {
        setFormError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setBusy(false))
  }

  const inputDisabled = props.disabled || busy

  return (
    <aside className="rail">
      <header className="rail-header">
        <h1>Harness</h1>
        <button type="button" className="ghost" onClick={startCreate} disabled={inputDisabled}>
          + New
        </button>
      </header>

      {props.error !== null && (
        <div className="banner error">
          <span>{props.error}</span>
          <button
            type="button"
            className="banner-close"
            onClick={props.onDismissError}
            aria-label="dismiss"
          >
            ×
          </button>
        </div>
      )}

      <ul className="profile-list">
        {props.profiles === null ? (
          <li className="muted">loading…</li>
        ) : props.profiles.length === 0 ? (
          <li className="muted">no profiles yet</li>
        ) : (
          props.profiles.map((p) => (
            <li key={p.id} className={p.id === props.selectedId ? 'selected' : ''}>
              <button
                type="button"
                className="profile-item"
                onClick={() => props.onSelect(p.id)}
                disabled={props.disabled}
                title={p.baseUrl}
              >
                <span className="profile-name">{p.name}</span>
                <span className="profile-meta">
                  {p.type}
                  {p.model !== undefined ? ` · ${p.model}` : ''}
                  {p.hasApiKey ? ' · key' : ''}
                </span>
              </button>
              <div className="profile-actions">
                <button
                  type="button"
                  className="icon"
                  onClick={() => startEdit(p)}
                  disabled={inputDisabled}
                  aria-label={`Edit ${p.name}`}
                  title="Edit profile"
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="icon danger"
                  onClick={() => remove(p.id, p.name)}
                  disabled={inputDisabled}
                  aria-label={`Delete ${p.name}`}
                  title="Delete profile"
                >
                  ✕
                </button>
              </div>
            </li>
          ))
        )}
      </ul>

      {formError !== null && <div className="banner error">{formError}</div>}

      <form className="profile-form" onSubmit={submit}>
        <h2>{form.editingId !== null ? 'Edit profile' : 'New profile'}</h2>
        <select
          value={form.type}
          onChange={(e) => setField({ type: e.target.value as ProviderType })}
          disabled={inputDisabled}
          aria-label="provider type"
        >
          <option value="openai-compat">openai-compat</option>
          <option value="ollama">ollama</option>
        </select>
        <input
          value={form.name}
          onChange={(e) => setField({ name: e.target.value })}
          placeholder="name (required)"
          disabled={inputDisabled}
        />
        <input
          value={form.baseUrl}
          onChange={(e) => setField({ baseUrl: e.target.value })}
          placeholder="base URL, e.g. http://localhost:11434/v1"
          disabled={inputDisabled}
        />
        <input
          type="password"
          value={form.apiKey}
          onChange={(e) => setField({ apiKey: e.target.value })}
          placeholder={form.editingId !== null ? 'new api key (blank keeps current)' : 'api key (optional)'}
          autoComplete="off"
          disabled={inputDisabled}
        />
        <input
          value={form.model}
          onChange={(e) => setField({ model: e.target.value })}
          placeholder="default model (optional)"
          disabled={inputDisabled}
        />
        <div className="form-actions">
          <button
            type="submit"
            className="primary"
            disabled={inputDisabled || form.name.trim() === '' || form.baseUrl.trim() === ''}
          >
            {busy ? 'Saving…' : form.editingId !== null ? 'Update' : 'Add'}
          </button>
          {form.editingId !== null && (
            <button type="button" className="ghost" onClick={startCreate} disabled={inputDisabled}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </aside>
  )
}