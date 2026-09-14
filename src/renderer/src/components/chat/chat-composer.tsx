import { memo, useCallback, useState, type FormEvent, type KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface ChatComposerProps {
  onSubmit: (value: string) => void
}

/**
 * Owns its draft state so keystrokes never re-render the transcript.
 * Memoized — appending a message does not re-render the composer.
 */
export const ChatComposer = memo(function ChatComposer({ onSubmit }: ChatComposerProps) {
  const [value, setValue] = useState('')

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const text = value.trim()
      if (!text) return
      onSubmit(text)
      setValue('')
    },
    [onSubmit, value],
  )

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }, [])

  return (
    <form
      onSubmit={handleSubmit}
      className="composer app-no-drag absolute inset-x-0 bottom-0 z-10 px-4 py-3 sm:px-6"
    >
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
        <Button type="submit" disabled={value.trim() === ''} className="shrink-0">
          Send
        </Button>
      </div>
    </form>
  )
})
