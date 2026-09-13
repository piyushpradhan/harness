import { useState, type FormEvent, type KeyboardEvent } from 'react'

import { TitleBar } from '@/components/title-bar'
import { Button } from '@/components/ui/button'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { Message, MessageContent } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { Textarea } from '@/components/ui/textarea'

interface Entry {
  id: number
  text: string
}

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [text, setText] = useState('')

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    const value = text.trim()
    console.log('value: ', value)

    if (!value) return

    if (value === '/connect') {
      void window.harness.auth.test('opencode-go')
    } else {
      setEntries((prev) => [...prev, { id: Date.now(), text: value }])
      setText('')
    }
  }

  function handleComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    e.currentTarget.form?.requestSubmit()
  }

  return (
    <div className="relative h-full min-h-0 text-foreground">
      <div className="app-no-drag absolute inset-0 flex min-h-0 flex-col">
        <MessageScrollerProvider autoScroll defaultScrollPosition="end">
          <MessageScroller>
            <MessageScrollerViewport aria-label="Conversation">
              <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-3 px-4 pt-[68px] pb-[88px] sm:px-6">
                {entries.length === 0 ? (
                  <MessageScrollerItem
                    messageId="empty"
                    className="flex flex-1 items-center justify-center [content-visibility:visible]"
                  >
                    <Marker className="justify-center">
                      <MarkerContent>Type a message to begin</MarkerContent>
                    </Marker>
                  </MessageScrollerItem>
                ) : (
                  entries.map((entry) => (
                    <MessageScrollerItem key={entry.id} messageId={String(entry.id)} scrollAnchor>
                      <Message align="end">
                        <MessageContent>
                          <Bubble variant="default" align="end">
                            <BubbleContent>{entry.text}</BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ))
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton className="bg-background/70 backdrop-blur-md data-[direction=end]:bottom-[5.75rem]" />
          </MessageScroller>
        </MessageScrollerProvider>
      </div>
      <TitleBar />
      <form
        onSubmit={handleSubmit}
        className="composer app-no-drag absolute inset-x-0 bottom-0 z-10 px-4 py-3 sm:px-6"
      >
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Type a message…"
            aria-label="Message"
            autoFocus
            rows={1}
            className="composer-input max-h-40 min-h-10 resize-none py-2"
          />
          <Button type="submit" disabled={text.trim() === ''} className="shrink-0">
            Send
          </Button>
        </div>
      </form>
    </div>
  )
}
