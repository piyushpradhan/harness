export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /** Streamed reasoning, shown dimmed above the content. */
  reasoning?: string
  /** Latest tool activity line, shown dimmed under the reasoning. */
  tool?: { state: 'running' | 'completed'; detail?: string }
  /** True while the OpenCode agent is still producing this message. */
  streaming?: boolean
}
