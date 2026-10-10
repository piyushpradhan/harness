import { memo, useCallback, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Loader2Icon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import type { ComposerState } from './composer-state'

interface ChatComposerProps {
  status: ComposerState['status']
  /** Message for the `error` status. */
  error?: string
  /**
   * Called with the trimmed draft. Return true when the draft was consumed
   * and the composer should clear it, false to keep it in place.
   */
  onSubmit: (value: string) => boolean
  /** Acknowledge an error and return to idle. */
  onDismissError: () => void
}

const BUSY_LABEL = { sending: 'Sending…', streaming: 'Responding…' } as const

/**
 * Owns its draft state so keystrokes never re-render the transcript.
 * Memoized on primitive props — streaming into the transcript does not
 * re-render the composer; only a status change does.
 *
 * The draft stays editable while a reply is in flight; only sending is
 * blocked.
 */
export const ChatComposer = memo(function ChatComposer({
  status,
  error,
  onSubmit,
  onDismissError,
}: ChatComposerProps) {
  const [value, setValue] = useState('')
  const busy = status === 'sending' || status === 'streaming'

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      // requestSubmit() fires even when the submit button is disabled.
      if (busy) return
      const text = value.trim()
      if (!text) return
      if (onSubmit(text)) setValue('')
    },
    [busy, onSubmit, value],
  )

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }, [])

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={busy}
      data-status={status}
      className="composer app-no-drag absolute inset-x-0 bottom-0 z-10 px-4 py-3 sm:px-6"
    >
      {status === 'error' ? (
        <div
          role="alert"
          className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 text-xs text-destructive"
        >
          <span className="min-w-0 flex-1 truncate">Send failed: {error}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss error"
            onClick={onDismissError}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          aria-label="Message"
          autoFocus
          rows={1}
          className="composer-input max-h-40 min-h-10 resize-none py-2"
        />
        <Button type="submit" disabled={busy || value.trim() === ''} className="shrink-0">
          {busy ? (
            <>
              <Loader2Icon className="animate-spin" aria-hidden />
              {BUSY_LABEL[status]}
            </>
          ) : (
            'Send'
          )}
        </Button>
      </div>
    </form>
  )
})
