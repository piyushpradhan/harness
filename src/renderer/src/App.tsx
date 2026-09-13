import { useState, type FormEvent } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

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
    console.log("value: ", value);

    if (!value) return

    if (value === "/connect") {
      window.harness.auth.test("opencode-go");
    } else {
    setEntries((prev) => [...prev, { id: Date.now(), text: value }])
    setText('')
    }
  }

  return (
    <div className="flex h-screen flex-col gap-4 p-4">
      <Card className="flex min-h-0 flex-col">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Harness</CardTitle>
          <Badge variant="secondary">{window.api.platform}</Badge>
        </CardHeader>
        <Separator />
        <CardContent className="min-h-0 flex-1 overflow-hidden py-4">
          <ScrollArea className="h-full">
            {entries.length === 0 ? (
              <p className="text-muted-foreground text-sm">Type a message to begin…</p>
            ) : (
              <ul className="space-y-1">
                {entries.map((entry) => (
                  <li key={entry.id} className="py-1">
                    {entry.text}
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </CardContent>
        <Separator />
        <CardFooter>
          <form onSubmit={handleSubmit} className="flex w-full gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message…"
              autoFocus
            />
            <Button type="submit" disabled={text.trim() === ''}>
              Send
            </Button>
          </form>
        </CardFooter>
      </Card>
    </div>
  )
}
