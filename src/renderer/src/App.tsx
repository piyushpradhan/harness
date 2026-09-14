import { Chat } from '@/components/chat/chat'
import { TitleBar } from '@/components/title-bar'

export default function App() {
  return (
    <div className="relative h-full min-h-0 text-foreground">
      <Chat />
      <TitleBar />
    </div>
  )
}
