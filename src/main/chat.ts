/**
 * Conversations et agents.
 *
 * La timeline affichée provient exclusivement des événements émis ici, au moment
 * où le modèle ou les outils les produisent réellement.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { refFromString, type ModelRef } from '@shared/providers'
import type { ChatEvent, ConversationDetail, ConversationSummary, FileChange, StoredAgentEvent, StoredMessage, ToolCallView } from '@shared/chat'
import type { CloudProviders } from './cloud'
import { logActivity, type Db } from './db'
import { emit } from './events'
import { gpuHolder } from './gpu'
import type { LocalModels } from './models'
import { getProject } from './projects'
import { listTree, resolveInside } from './projectfs'
import { OllamaProvider } from './providers/ollama'
import { AutoProvider } from './providers/auto'
import { AUTO_PROVIDER } from '@shared/auto-router'
import type { ChatMessage, LlmProvider, ToolCall } from './providers/types'
import { findTool, needsApproval, toolSpecs, type Preview } from './tools'

const MAX_ITERATIONS = 30

interface Run {
  runId: string
  conversationId: string
  controller: AbortController
  approvals: Map<string, (d: 'allow' | 'deny' | 'allow-all') => void>
  allowAll: boolean
}

export class ChatService {
  private runs = new Map<string, Run>()

  constructor(
    private readonly db: Db,
    private readonly local: LocalModels,
    private readonly cloud: CloudProviders,
    private readonly ollamaUrl: () => Promise<string>
  ) {}

  // ---------- Conversations ----------

  list(projectId?: string | null): ConversationSummary[] {
    const rows = (
      projectId
        ? this.db.prepare('SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC').all(projectId)
        : this.db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 300').all()
    ) as { id: string; title: string; project_id: string | null; model_ref: string; mode: string; updated_at: string }[]
    return rows.map((r) => ({ id: r.id, title: r.title, projectId: r.project_id, modelRef: r.model_ref, mode: r.mode as 'chat' | 'agent', updatedAt: r.updated_at }))
  }

  create(input: { modelRef: string; projectId?: string | null; mode?: 'chat' | 'agent' }): ConversationSummary {
    if (!refFromString(input.modelRef)) throw new Error('Modèle invalide.')
    if (input.projectId && !getProject(this.db, input.projectId)) throw new Error('Projet introuvable.')
    const id = randomUUID()
    const now = new Date().toISOString()
    const mode = input.projectId ? (input.mode ?? 'agent') : 'chat'
    this.db
      .prepare('INSERT INTO conversations (id, title, project_id, model_ref, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, 'Nouvelle conversation', input.projectId ?? null, input.modelRef, mode, now, now)
    return this.list().find((c) => c.id === id)!
  }

  update(id: string, patch: { title?: string; modelRef?: string; mode?: 'chat' | 'agent' }): void {
    if (patch.modelRef && !refFromString(patch.modelRef)) throw new Error('Modèle invalide.')
    const c = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as { title: string; model_ref: string; mode: string; project_id: string | null } | undefined
    if (!c) throw new Error('Conversation introuvable.')
    const mode = patch.mode && c.project_id ? patch.mode : c.mode
    this.db
      .prepare('UPDATE conversations SET title = ?, model_ref = ?, mode = ?, updated_at = ? WHERE id = ?')
      .run(patch.title?.trim().slice(0, 120) || c.title, patch.modelRef ?? c.model_ref, mode, new Date().toISOString(), id)
  }

  remove(id: string): void {
    this.stop(id)
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
  }

  get(id: string): ConversationDetail {
    const c = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | { id: string; title: string; project_id: string | null; model_ref: string; mode: string; updated_at: string }
      | undefined
    if (!c) throw new Error('Conversation introuvable.')
    const messages = (this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id').all(id) as { id: number; role: string; content: string; meta: string; created_at: string }[]).map(
      (m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.created_at, meta: JSON.parse(m.meta) }) as StoredMessage
    )
    const events = (this.db.prepare('SELECT * FROM agent_events WHERE conversation_id = ? ORDER BY id').all(id) as { id: number; run_id: string; ts: string; type: string; data: string }[]).map(
      (e) => ({ id: e.id, runId: e.run_id, ts: e.ts, type: e.type, data: JSON.parse(e.data) }) as StoredAgentEvent
    )
    const changes = (this.db.prepare('SELECT * FROM file_changes WHERE conversation_id = ? ORDER BY id').all(id) as {
      id: number
      run_id: string
      path: string
      action: string
      status: string
      created_at: string
      before_content: string | null
      after_content: string | null
    }[]).map(
      (f) => ({ id: f.id, runId: f.run_id, path: f.path, action: f.action, status: f.status as FileChange['status'], createdAt: f.created_at, before: f.before_content, after: f.after_content })
    )
    return {
      id: c.id,
      title: c.title,
      projectId: c.project_id,
      modelRef: c.model_ref,
      mode: c.mode as 'chat' | 'agent',
      updatedAt: c.updated_at,
      messages,
      events,
      changes,
      running: [...this.runs.values()].some((r) => r.conversationId === id)
    }
  }

  // ---------- Exécution ----------

  private saveMessage(conversationId: string, role: StoredMessage['role'], content: string, meta: StoredMessage['meta']): void {
    const now = new Date().toISOString()
    this.db.prepare('INSERT INTO messages (conversation_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)').run(conversationId, role, content, JSON.stringify(meta), now)
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)
  }

  private event(ev: ChatEvent, persist = false): void {
    emit('chat:event', ev)
    if (persist) {
      const { conversationId, runId, type, ...data } = ev as ChatEvent & Record<string, unknown>
      this.db.prepare('INSERT INTO agent_events (conversation_id, run_id, ts, type, data) VALUES (?, ?, ?, ?, ?)').run(conversationId, runId, new Date().toISOString(), type, JSON.stringify(data))
    }
  }

  private async resolveProvider(ref: ModelRef): Promise<{ provider: LlmProvider; tools: boolean | null; light: boolean }> {
    if (ref.location === 'local') {
      const holder = gpuHolder()
      if (holder) throw new Error(`La carte graphique est occupée (${holder}). Réessaie quand la génération sera terminée.`)
      const caps = await this.local.capabilities(ref.model)
      const entry = (await this.local.catalog()).llm.find((m) => m.id === ref.model)
      const light = (entry?.activeParamsB ?? 8) < 10
      return { provider: new OllamaProvider(this.ollamaUrl), tools: caps.tools, light }
    }
    if (ref.provider === AUTO_PROVIDER) {
      return { provider: new AutoProvider({ candidates: () => this.cloud.autoCandidates(), provider: (id) => this.cloud.provider(id) }), tools: null, light: false }
    }
    const provider = this.cloud.provider(ref.provider)
    const models = await this.cloud.models(ref.provider).catch(() => [])
    const info = models.find((m) => m.id === ref.model)
    return { provider, tools: info?.tools ?? null, light: false }
  }

  send(conversationId: string, text: string, images: string[] = []): string {
    if ([...this.runs.values()].some((r) => r.conversationId === conversationId)) throw new Error('Une réponse est déjà en cours dans cette conversation.')
    const conv = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as
      | { title: string; model_ref: string; mode: string; project_id: string | null }
      | undefined
    if (!conv) throw new Error('Conversation introuvable.')
    const ref = refFromString(conv.model_ref)
    if (!ref) throw new Error('Modèle invalide.')
    if (!text.trim() && images.length === 0) throw new Error('Message vide.')

    this.saveMessage(conversationId, 'user', text, images.length ? { images } : {})
    if (conv.title === 'Nouvelle conversation') {
      this.db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(text.trim().replace(/\s+/g, ' ').slice(0, 60) || 'Image', conversationId)
    }
    const run: Run = { runId: randomUUID(), conversationId, controller: new AbortController(), approvals: new Map(), allowAll: false }
    this.runs.set(run.runId, run)
    void this.execute(run, ref, conv.mode === 'agent' ? conv.project_id : null).finally(() => this.runs.delete(run.runId))
    return run.runId
  }

  stop(conversationId: string): void {
    for (const r of this.runs.values()) {
      if (r.conversationId === conversationId) {
        r.controller.abort()
        for (const resolve of r.approvals.values()) resolve('deny')
      }
    }
  }

  approve(runId: string, callId: string, decision: 'allow' | 'deny' | 'allow-all'): void {
    const run = this.runs.get(runId)
    const resolve = run?.approvals.get(callId)
    if (!run || !resolve) return
    if (decision === 'allow-all') run.allowAll = true
    run.approvals.delete(callId)
    resolve(decision)
  }

  private history(conversationId: string): ChatMessage[] {
    const rows = this.get(conversationId).messages.filter((m) => !m.meta.error)
    return rows.map((m) => ({
      role: m.role,
      content: m.content,
      images: m.meta.images,
      toolCalls: m.meta.toolCalls,
      toolCallId: m.meta.toolCallId,
      toolName: m.meta.toolName
    }))
  }

  private systemPrompt(projectId: string | null): string {
    const base = "Tu es l'assistant d'AI Studio. Réponds en français, de façon claire et concise, en Markdown."
    if (!projectId) return base
    const p = getProject(this.db, projectId)!
    const { entries, truncated } = listTree(p.folder, p.folder, 2, 150)
    const map = entries.map((e) => (e.type === 'dir' ? `${e.path}/` : e.path)).join('\n')
    return `${base}

Tu travailles comme agent dans le projet « ${p.name} »${p.description ? ` (${p.description})` : ''}.
Racine du projet : ${p.folder}
Règles :
- Utilise les outils pour explorer, lire, rechercher, modifier les fichiers et exécuter des commandes. Les chemins sont relatifs à la racine.
- Avant de modifier un fichier existant, lis-le. Préfère edit_file (remplacement ciblé) à write_file pour un fichier existant.
- Annonce brièvement ton plan avant d'agir, puis résume ce que tu as fait à la fin.
- L'utilisateur valide chaque modification et chaque commande : si une action est refusée, propose une alternative sans insister.
- Ne touche jamais aux fichiers de secrets (.env, clés).

Aperçu du projet (2 niveaux) :
${map || '(dossier vide)'}${truncated ? '\n…' : ''}`
  }

  private async execute(run: Run, ref: ModelRef, projectId: string | null): Promise<void> {
    const { conversationId, runId } = run
    const base = { conversationId, runId }
    const agent = Boolean(projectId)
    this.event({ type: 'run-start', ...base, agent, model: ref.model, location: ref.location }, agent)
    try {
      this.event({ type: 'status', ...base, text: ref.location === 'local' ? 'Chargement du modèle local' : `Connexion à ${ref.provider}` })
      const { provider, tools: toolsSupported, light } = await this.resolveProvider(ref)
      const project = projectId ? getProject(this.db, projectId) : undefined
      if (agent && toolsSupported === false) {
        throw new Error(`Le modèle ${ref.model} ne sait pas utiliser d'outils (vérifié auprès du moteur). Choisis un modèle compatible « Agent » ou passe en mode Discussion.`)
      }
      if (agent && project && !project.folderExists) throw new Error("Le dossier du projet n'existe plus.")
      const tools = agent ? toolSpecs(light) : undefined

      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        const messages: ChatMessage[] = [{ role: 'system', content: this.systemPrompt(projectId) }, ...this.history(conversationId)]
        let text = ''
        let reasoning = ''
        const calls: ToolCall[] = []
        let tps: number | undefined
        let outTokens: number | undefined
        let used = { provider: ref.provider, model: ref.model }
        for await (const ev of provider.chat({ model: ref.model, messages, tools }, run.controller.signal)) {
          if (ev.type === 'text') {
            text += ev.text
            this.event({ type: 'text', ...base, text: ev.text })
          } else if (ev.type === 'reasoning') {
            reasoning += ev.text
            this.event({ type: 'reasoning', ...base, text: ev.text })
          } else if (ev.type === 'tool-call') {
            calls.push(ev.call)
          } else if (ev.type === 'usage') {
            tps = ev.tokensPerSecond
            outTokens = ev.outputTokens
            this.event({ type: 'usage', ...base, tokensPerSecond: tps, outputTokens: outTokens })
            if (tps && ref.location === 'local') this.local.recordSpeed(ref.model, tps)
          } else if (ev.type === 'rate-limit') {
            this.event({ type: 'rate-limit', ...base, remaining: ev.remaining, limit: ev.limit })
          } else if (ev.type === 'route') {
            used = { provider: ev.provider, model: ev.model }
            this.event({ type: 'status', ...base, text: `Auto : ${ev.model} via ${ev.providerLabel}` }, agent)
          } else if (ev.type === 'route-fail') {
            this.event({ type: 'status', ...base, text: ev.text }, agent)
          }
        }
        this.saveMessage(conversationId, 'assistant', text, {
          reasoning: reasoning || undefined,
          toolCalls: calls.length ? calls : undefined,
          provider: used.provider,
          model: used.model,
          location: ref.location,
          tokensPerSecond: tps,
          outputTokens: outTokens
        })
        this.event({ type: 'message-saved', ...base })
        if (!calls.length || !agent || !project) break

        for (const call of calls) {
          if (run.controller.signal.aborted) break
          const output = await this.runTool(run, project.id, project.folder, call)
          this.saveMessage(conversationId, 'tool', output, { toolCallId: call.id, toolName: call.name })
        }
        if (run.controller.signal.aborted) break
        if (iter === MAX_ITERATIONS - 1) this.event({ type: 'status', ...base, text: `Limite de ${MAX_ITERATIONS} étapes atteinte : l'agent s'arrête.` })
      }
      this.event({ type: 'run-end', ...base, status: run.controller.signal.aborted ? 'stopped' : 'done' }, agent)
    } catch (e) {
      const aborted = run.controller.signal.aborted
      const message = aborted ? undefined : friendlyError(e)
      if (message) this.saveMessage(conversationId, 'assistant', '', { error: message, provider: ref.provider, model: ref.model, location: ref.location })
      this.event({ type: 'run-end', ...base, status: aborted ? 'stopped' : 'error', error: message }, agent)
    }
  }

  private async runTool(run: Run, projectId: string, root: string, call: ToolCall): Promise<string> {
    const base = { conversationId: run.conversationId, runId: run.runId }
    const tool = findTool(call.name)
    const view: ToolCallView = { id: call.id, name: call.name, label: tool?.label ?? call.name, risk: tool?.risk ?? 'read', args: call.args }
    if (!tool) {
      this.event({ type: 'tool-call', ...base, call: view }, true)
      this.event({ type: 'tool-status', ...base, callId: call.id, status: 'error', summary: 'Outil inconnu' }, true)
      return `Erreur : l'outil « ${call.name} » n'existe pas.`
    }
    const parsed = tool.schema.safeParse(call.args)
    if (!parsed.success) {
      this.event({ type: 'tool-call', ...base, call: view }, true)
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      this.event({ type: 'tool-status', ...base, callId: call.id, status: 'error', summary: 'Paramètres invalides' }, true)
      return `Erreur : paramètres invalides pour ${call.name} (${msg}). Corrige l'appel.`
    }
    const input = parsed.data
    view.target = tool.target?.(input)
    this.event({ type: 'tool-call', ...base, call: view }, true)

    const ctx = {
      root,
      signal: run.controller.signal,
      recordChange: (c: { path: string; action: string; before: string | null; after: string | null }) => {
        this.db
          .prepare('INSERT INTO file_changes (conversation_id, run_id, project_id, path, action, before_content, after_content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(run.conversationId, run.runId, projectId, c.path, c.action, c.before, c.after, 'applied', new Date().toISOString())
        logActivity(this.db, 'agent.change', `Agent : ${c.action} ${c.path}`)
      },
      onOutput: (chunk: string) => this.event({ type: 'tool-output', ...base, callId: call.id, chunk })
    }

    try {
      if (needsApproval(tool, input as Record<string, unknown>) && !run.allowAll) {
        let preview: Preview
        try {
          preview = tool.preview!(input, ctx)
        } catch (e) {
          this.event({ type: 'tool-status', ...base, callId: call.id, status: 'error', summary: (e as Error).message }, true)
          return `Erreur : ${(e as Error).message}`
        }
        this.event({ type: 'approval', ...base, callId: call.id, preview })
        const decision = await new Promise<'allow' | 'deny' | 'allow-all'>((resolve) => run.approvals.set(call.id, resolve))
        this.event({ type: 'status', ...base, text: decision === 'deny' ? 'Action refusée' : 'Action autorisée' })
        if (decision === 'deny') {
          this.event({ type: 'tool-status', ...base, callId: call.id, status: 'denied', summary: "Refusé par l'utilisateur" }, true)
          return "L'utilisateur a refusé cette action. Ne la répète pas ; propose une alternative ou demande des précisions."
        }
      }
      this.event({ type: 'tool-status', ...base, callId: call.id, status: 'running' })
      const result = await tool.run(input, ctx)
      this.event({ type: 'tool-status', ...base, callId: call.id, status: result.ok ? 'done' : 'error', summary: result.summary, output: result.output.slice(0, 4000) }, true)
      return result.output
    } catch (e) {
      const msg = (e as Error).message
      this.event({ type: 'tool-status', ...base, callId: call.id, status: 'error', summary: msg.slice(0, 200) }, true)
      return `Erreur : ${msg}`
    }
  }

  /** Annule une modification de fichier appliquée par l'agent. */
  revertChange(changeId: number): void {
    const c = this.db.prepare('SELECT * FROM file_changes WHERE id = ?').get(changeId) as
      | { project_id: string; path: string; action: string; before_content: string | null; after_content: string | null; status: string }
      | undefined
    if (!c || c.status !== 'applied') throw new Error('Modification introuvable ou déjà annulée.')
    const p = getProject(this.db, c.project_id)
    if (!p) throw new Error('Projet introuvable.')
    if (c.action === 'move') throw new Error('Un déplacement ne peut pas être annulé automatiquement.')
    const abs = resolveInside(p.folder, c.path)
    if (c.before_content === null) {
      if (existsSync(abs)) unlinkSync(abs)
    } else {
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, c.before_content, 'utf8')
    }
    this.db.prepare("UPDATE file_changes SET status = 'reverted' WHERE id = ?").run(changeId)
    logActivity(this.db, 'agent.revert', `Modification annulée : ${c.path}`)
  }
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(msg)) return `Connexion impossible : ${msg}. Vérifie ta connexion Internet (Cloud) ou que le moteur local est installé.`
  if (/model .* not found|not found, try pulling/i.test(msg)) return "Ce modèle n'est pas installé. Installe-le depuis la Bibliothèque de modèles."
  return msg
}
