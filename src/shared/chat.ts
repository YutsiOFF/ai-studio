/** Types partagés de l'assistant et des agents. */

export interface ConversationSummary {
  id: string
  title: string
  projectId: string | null
  modelRef: string
  mode: 'chat' | 'agent'
  updatedAt: string
}

export interface StoredToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface StoredMessage {
  id: number
  role: 'user' | 'assistant' | 'tool'
  content: string
  createdAt: string
  meta: {
    reasoning?: string
    toolCalls?: StoredToolCall[]
    toolCallId?: string
    toolName?: string
    images?: string[]
    provider?: string
    model?: string
    location?: 'local' | 'cloud'
    tokensPerSecond?: number
    outputTokens?: number
    error?: string
  }
}

export type FilePreview = { kind: 'file'; path: string; action: 'create' | 'modify' | 'delete' | 'move'; before: string | null; after: string | null; to?: string }
export type CommandPreview = { kind: 'command'; command: string; cwd: string }

export interface ToolCallView {
  id: string
  name: string
  label: string
  risk: 'read' | 'write' | 'destructive' | 'exec'
  args: Record<string, unknown>
  target?: string
}

export type ChatEvent =
  | { type: 'run-start'; conversationId: string; runId: string; agent: boolean; model: string; location: 'local' | 'cloud' }
  | { type: 'status'; conversationId: string; runId: string; text: string }
  | { type: 'text'; conversationId: string; runId: string; text: string }
  | { type: 'reasoning'; conversationId: string; runId: string; text: string }
  | { type: 'tool-call'; conversationId: string; runId: string; call: ToolCallView }
  | { type: 'approval'; conversationId: string; runId: string; callId: string; preview: FilePreview | CommandPreview }
  | { type: 'tool-status'; conversationId: string; runId: string; callId: string; status: 'running' | 'done' | 'error' | 'denied'; summary?: string; output?: string }
  | { type: 'tool-output'; conversationId: string; runId: string; callId: string; chunk: string }
  | { type: 'usage'; conversationId: string; runId: string; tokensPerSecond?: number; outputTokens?: number }
  | { type: 'rate-limit'; conversationId: string; runId: string; remaining?: number; limit?: number }
  | { type: 'message-saved'; conversationId: string; runId: string }
  | { type: 'run-end'; conversationId: string; runId: string; status: 'done' | 'stopped' | 'error'; error?: string }

export interface StoredAgentEvent {
  id: number
  runId: string
  ts: string
  type: string
  data: Record<string, unknown>
}

export interface FileChange {
  id: number
  runId: string
  path: string
  action: string
  status: 'applied' | 'reverted'
  createdAt: string
  before: string | null
  after: string | null
}

export interface ConversationDetail extends ConversationSummary {
  messages: StoredMessage[]
  events: StoredAgentEvent[]
  changes: FileChange[]
  running: boolean
}
