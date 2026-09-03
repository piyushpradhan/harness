import { useEffect, useRef, useState } from 'react'
import type { ProfileInput } from '../../shared/ipc'
import type { ChatMessage, ModelInfo, ProfileSummary, SessionEvent } from '../../shared/types'
import { ChatPanel, type SessionStatus } from './components/ChatPanel'
import { ProfileRail } from './components/ProfileRail'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export default function App(): JSX.Element {
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null)
  const [profilesError, setProfilesError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [output, setOutput] = useState('')
  const [chatError, setChatError] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [input, setInput] = useState('')
  const [, setTick] = useState(0)

  const sessionIdRef = useRef<string | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const profilesRef = useRef<ProfileSummary[] | null>(null)

  useEffect(() => {
    profilesRef.current = profiles
  }, [profiles])

  // Initial profile list.
  useEffect(() => {
    let cancelled = false
    window.harness.profiles
      .list()
      .then(({ profiles: list }) => {
        if (cancelled) return
        setProfiles(list)
        setProfilesError(null)
        setSelectedId((prev) => prev ?? (list[0]?.id ?? null))
      })
      .catch((err: unknown) => {
        if (!cancelled) setProfilesError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Model list for the selected profile.
  useEffect(() => {
    if (selectedId === null) {
      setModels([])
      setModel('')
      setModelsError(null)
      setModelsLoading(false)
      return
    }
    let cancelled = false
    setModelsLoading(true)
    setModelsError(null)
    window.harness.models
      .list(selectedId)
      .then((list) => {
        if (cancelled) return
        setModels(list)
        if (list.length === 0) {
          setModel('')
          return
        }
        const preferred = profilesRef.current?.find((p) => p.id === selectedId)?.model
        setModel(
          preferred !== undefined && list.some((m) => m.id === preferred) ? preferred : list[0].id
        )
      })
      .catch((err: unknown) => {
        if (!cancelled) setModelsError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const active = status === 'connecting' || status === 'streaming'

  // Session events, filtered to the active session id. Events may arrive
  // before chat.start resolves, so a null session id means "adopt": exactly
  // one session can be in flight at a time.
  useEffect(() => {
    return window.harness.events.onSessionEvent((evt: SessionEvent) => {
      const current = sessionIdRef.current
      if (current !== null && evt.sessionId !== current) return
      switch (evt.type) {
        case 'status':
          switch (evt.state) {
            case 'connecting':
              startedAtRef.current = Date.now()
              setStatus('connecting')
              break
            case 'streaming':
              setStatus('streaming')
              break
            case 'cancelled':
              startedAtRef.current = null
              sessionIdRef.current = null
              setStatus('cancelled')
              break
          }
          break
        case 'delta':
          setOutput((prev) => prev + evt.text)
          break
        case 'done':
          startedAtRef.current = null
          sessionIdRef.current = null
          setOutput(evt.text)
          setDurationMs(evt.durationMs)
          setStatus('done')
          break
        case 'error':
          startedAtRef.current = null
          sessionIdRef.current = null
          setStatus('error')
          setChatError(evt.message)
          break
      }
    })
  }, [])

  // Elapsed-seconds ticker while a session is active.
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setTick((t) => t + 1), 250)
    return () => clearInterval(timer)
  }, [active])

  const elapsedSec =
    startedAtRef.current !== null && active
      ? Math.floor((Date.now() - startedAtRef.current) / 1000)
      : 0

  const handleSend = (): void => {
    const text = input.trim()
    if (selectedId === null || model === '' || text === '' || active) return
    const message: ChatMessage = { role: 'user', content: text }
    setOutput('')
    setChatError(null)
    setDurationMs(null)
    sessionIdRef.current = null
    startedAtRef.current = Date.now()
    setStatus('connecting')
    setInput('')
    window.harness.chat
      .start({
        profileId: selectedId,
        model,
        system: systemPrompt.trim() === '' ? undefined : systemPrompt.trim(),
        messages: [message]
      })
      .then(({ sessionId }) => {
        sessionIdRef.current = sessionId
      })
      .catch((err: unknown) => {
        startedAtRef.current = null
        sessionIdRef.current = null
        setStatus('error')
        setChatError(`could not start chat: ${errorMessage(err)}`)
      })
  }

  const handleStop = (): void => {
    const id = sessionIdRef.current
    if (id === null) return
    void window.harness.chat.cancel(id).catch((err: unknown) => {
      setChatError(`could not cancel: ${errorMessage(err)}`)
    })
  }

  const handleSaveProfile = async (inputValue: ProfileInput): Promise<void> => {
    const { profile } = await window.harness.profiles.save(inputValue)
    const { profiles: list } = await window.harness.profiles.list()
    setProfiles(list)
    setProfilesError(null)
    setSelectedId(profile.id)
  }

  const handleDeleteProfile = async (id: string): Promise<void> => {
    await window.harness.profiles.delete(id)
    const { profiles: list } = await window.harness.profiles.list()
    setProfiles(list)
    setProfilesError(null)
    setSelectedId((prev) => (prev === id ? (list[0]?.id ?? null) : prev))
  }

  const selectedProfile = profiles?.find((p) => p.id === selectedId) ?? null

  return (
    <div className="app">
      <ProfileRail
        profiles={profiles}
        selectedId={selectedId}
        disabled={active}
        error={profilesError}
        onSelect={setSelectedId}
        onSave={handleSaveProfile}
        onDelete={handleDeleteProfile}
        onDismissError={() => setProfilesError(null)}
      />
      <ChatPanel
        profile={selectedProfile}
        models={models}
        modelsLoading={modelsLoading}
        modelsError={modelsError}
        model={model}
        onModelChange={setModel}
        status={status}
        output={output}
        error={chatError}
        durationMs={durationMs}
        elapsedSec={elapsedSec}
        canSend={!active && selectedId !== null && model !== '' && !modelsLoading}
        systemPrompt={systemPrompt}
        onSystemPromptChange={setSystemPrompt}
        input={input}
        onInputChange={setInput}
        onSend={handleSend}
        onStop={handleStop}
      />
    </div>
  )
}