export interface TextPart {
  type: 'text'
  text: string
}
export interface ImagePart {
  type: 'image'
  mimeType: string
  base64: string
}

export type ContentPart = TextPart | ImagePart

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string; reasoning?: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export interface ToolDef {
  description?: string
  parameters?: Record<string, unknown>
}

export interface AssistantMessage {
  role: 'assistant'
  content: string
  reasoning?: string
  toolCalls: ToolCall[]
  finishReason: 'stop' | 'tool_calls' | 'length'
}

export type ChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'done'; message: AssistantMessage }
