/** Fournisseur local : API native d'Ollama (http://127.0.0.1). Aucune clé. */
import { readNdjson } from '../net'
import { newCallId, type ChatRequest, type LlmProvider, type StreamEvent } from './types'

interface OllamaChunk {
  message?: {
    content?: string
    thinking?: string
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> | string } }[]
  }
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
  eval_duration?: number
  error?: string
}

export class OllamaProvider implements LlmProvider {
  location = 'local' as const
  constructor(private readonly baseUrl: () => Promise<string>) {}

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const url = await this.baseUrl()
    const body = {
      model: req.model,
      stream: true,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.images?.length ? { images: m.images } : {}),
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } : {}),
        ...(m.role === 'tool' && m.toolName ? { tool_name: m.toolName } : {})
      })),
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: t })) } : {}),
      ...(req.think !== undefined ? { think: req.think } : {}),
      options: { ...(req.temperature !== undefined ? { temperature: req.temperature } : {}), num_ctx: req.numCtx ?? 8192 }
    }
    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new Error(`Le moteur local a répondu ${res.status}. ${parseError(text)}`)
    }
    for await (const c of readNdjson<OllamaChunk>(res.body)) {
      if (c.error) throw new Error(c.error)
      if (c.message?.thinking) yield { type: 'reasoning', text: c.message.thinking }
      if (c.message?.content) yield { type: 'text', text: c.message.content }
      for (const tc of c.message?.tool_calls ?? []) {
        const args = typeof tc.function.arguments === 'string' ? safeJson(tc.function.arguments) : tc.function.arguments
        yield { type: 'tool-call', call: { id: newCallId(), name: tc.function.name, args: args ?? {} } }
      }
      if (c.done) {
        const tps = c.eval_count && c.eval_duration ? c.eval_count / (c.eval_duration / 1e9) : undefined
        yield { type: 'usage', inputTokens: c.prompt_eval_count, outputTokens: c.eval_count, tokensPerSecond: tps }
        yield { type: 'done', reason: c.done_reason ?? 'stop' }
      }
    }
  }
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return null
  }
}

function parseError(text: string): string {
  try {
    return (JSON.parse(text) as { error?: string }).error ?? text
  } catch {
    return text
  }
}
