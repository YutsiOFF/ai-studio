/** Adaptateur unique pour tous les fournisseurs Cloud compatibles OpenAI. */
import type { CloudProvider } from '@shared/providers'
import { readSse, USER_AGENT } from '../net'
import type { ChatRequest, LlmProvider, ModelInfo, StreamEvent } from './types'

interface Delta {
  content?: string | null
  reasoning?: string | null
  reasoning_content?: string | null
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[]
}

export class OpenAICompatProvider implements LlmProvider {
  location = 'cloud' as const

  constructor(
    private readonly cfg: CloudProvider,
    private readonly key: string | null,
    private readonly extra: Record<string, string>,
    private readonly onRequest: () => void
  ) {}

  private base(): string {
    let url = this.cfg.baseUrl
    for (const [k, v] of Object.entries(this.extra)) url = url.replace(`{${k}}`, encodeURIComponent(v))
    return url.replace(/\/$/, '')
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      ...(this.key ? { Authorization: `Bearer ${this.key}` } : this.cfg.anonymousKey ? { Authorization: `Bearer ${this.cfg.anonymousKey}` } : {}),
      ...this.cfg.extraHeaders
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(this.cfg.modelsUrl ?? `${this.base()}/models`, { headers: this.headers(), signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`${this.cfg.label} : HTTP ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300))
    const json = (await res.json()) as unknown
    const raw: Record<string, unknown>[] = Array.isArray(json)
      ? (json as Record<string, unknown>[])
      : ((json as { data?: Record<string, unknown>[] }).data ?? [])
    let models = raw.map((m) => {
      const id = String(m.id ?? m.name ?? '').replace(/^models\//, '')
      const params = (m.supported_parameters as string[] | undefined) ?? undefined
      const modalities = ((m.architecture as { input_modalities?: string[] } | undefined)?.input_modalities ??
        (m.supported_input_modalities as string[] | undefined)) as string[] | undefined
      const caps = (m.capabilities as string[] | Record<string, boolean> | undefined) ?? undefined
      const capTools = Array.isArray(caps) ? caps.includes('tool-calling') || caps.includes('tools') : caps?.['function_calling']
      return {
        id,
        label: String(m.name ?? id),
        tools: params ? params.includes('tools') : capTools ?? null,
        vision: modalities ? modalities.includes('image') : null,
        contextK: typeof m.context_length === 'number' ? Math.round(m.context_length / 1000) : undefined,
        pricing: m.pricing as { prompt?: string; completion?: string } | undefined
      }
    })
    if (this.cfg.freeFilter === 'openrouter-free') {
      models = models.filter((m) => m.id.endsWith(':free') || (m.pricing?.prompt === '0' && m.pricing?.completion === '0'))
    } else if (this.cfg.freeFilter === 'allowlist' && this.cfg.allowlist) {
      const allowed = new Set(this.cfg.allowlist)
      models = models.filter((m) => allowed.has(m.id))
      for (const id of this.cfg.allowlist) if (!models.some((m) => m.id === id)) models.push({ id, label: id, tools: null, vision: null, contextK: undefined, pricing: undefined })
    }
    // Les modèles d'embedding, d'audio ou d'image ne sont pas des modèles de discussion.
    models = models.filter((m) => !/embed|whisper|tts|rerank|moderation|guard|dall-e|imagen|veo|audio/i.test(m.id))
    return models.map(({ pricing: _p, ...m }) => m).sort((a, b) => a.label.localeCompare(b.label))
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const messages = req.messages.map((m) => {
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }))
        }
      }
      if (m.images?.length) {
        return {
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            ...m.images.map((b64) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }))
          ]
        }
      }
      return { role: m.role, content: m.content }
    })
    const body = {
      model: req.model,
      messages,
      stream: true,
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: t })) } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {})
    }
    this.onRequest()
    const res = await fetch(`${this.base()}/chat/completions`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal })
    const remaining = res.headers.get('x-ratelimit-remaining-requests') ?? res.headers.get('x-ratelimit-remaining')
    const limit = res.headers.get('x-ratelimit-limit-requests') ?? res.headers.get('x-ratelimit-limit')
    if (remaining || limit) {
      yield { type: 'rate-limit', remaining: remaining ? Number(remaining) : undefined, limit: limit ? Number(limit) : undefined, reset: res.headers.get('x-ratelimit-reset-requests') ?? undefined }
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      if (res.status === 429) throw new Error(`${this.cfg.label} : quota gratuit atteint (429). Réessaie plus tard ou choisis un autre fournisseur. ${text.slice(0, 200)}`)
      if (res.status === 401 || res.status === 403) throw new Error(`${this.cfg.label} : clé refusée (${res.status}). Vérifie ta clé dans Paramètres > IA.`)
      throw new Error(`${this.cfg.label} : erreur ${res.status}. ${text.slice(0, 300)}`)
    }

    const pending = new Map<number, { id: string; name: string; args: string }>()
    let finish = 'stop'
    for await (const data of readSse(res.body)) {
      if (data === '[DONE]') break
      let chunk: { choices?: { delta?: Delta; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } }
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      if (chunk.error) throw new Error(`${this.cfg.label} : ${chunk.error.message ?? 'erreur inconnue'}`)
      const choice = chunk.choices?.[0]
      const d = choice?.delta
      if (d?.reasoning_content || d?.reasoning) yield { type: 'reasoning', text: (d.reasoning_content ?? d.reasoning) as string }
      if (d?.content) yield { type: 'text', text: d.content }
      for (const tc of d?.tool_calls ?? []) {
        const cur = pending.get(tc.index) ?? { id: tc.id ?? `call_${tc.index}_${Date.now()}`, name: '', args: '' }
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name += tc.function.name
        if (tc.function?.arguments) cur.args += tc.function.arguments
        pending.set(tc.index, cur)
      }
      if (choice?.finish_reason) finish = choice.finish_reason
      if (chunk.usage) yield { type: 'usage', inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens }
    }
    for (const p of pending.values()) {
      let args: Record<string, unknown> = {}
      try {
        args = p.args ? (JSON.parse(p.args) as Record<string, unknown>) : {}
      } catch {
        args = { __invalid_json: p.args }
      }
      yield { type: 'tool-call', call: { id: p.id, name: p.name, args } }
    }
    yield { type: 'done', reason: finish }
  }
}
