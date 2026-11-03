/** Interface commune à tous les fournisseurs de modèles (locaux et Cloud). */

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Images en base64 (sans préfixe data:). */
  images?: string[]
  toolCalls?: ToolCall[]
  toolCallId?: string
  toolName?: string
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; tokensPerSecond?: number }
  | { type: 'rate-limit'; remaining?: number; limit?: number; reset?: string }
  | { type: 'done'; reason: string }

export interface ModelInfo {
  id: string
  label: string
  tools: boolean | null
  vision: boolean | null
  contextK?: number
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  tools?: ToolSpec[]
  temperature?: number
  think?: boolean
  numCtx?: number
}

export interface LlmProvider {
  location: 'local' | 'cloud'
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>
}

let counter = 0
export function newCallId(): string {
  counter = (counter + 1) % 1_000_000
  return `call_${Date.now().toString(36)}_${counter}`
}
