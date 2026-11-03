import {
  ArrowUp,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  FileEdit,
  FolderKanban,
  ImagePlus,
  Loader2,
  MessageSquarePlus,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  User,
  X
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEvent, CommandPreview, ConversationDetail, FilePreview, StoredAgentEvent, ToolCallView } from '@shared/chat'
import { DiffView } from '../components/DiffView'
import { Markdown } from '../components/Markdown'
import { ModelPicker, describeRef } from '../components/ModelPicker'
import { Badge, Button, cn } from '../components/ui'
import { api, useAsync } from '../lib/hooks'
import { toast } from '../lib/toast'

// ---------- État en direct d'une exécution ----------

interface LiveCall {
  view: ToolCallView
  status: 'pending' | 'running' | 'done' | 'error' | 'denied'
  summary?: string
  output?: string
  stream?: string
}

interface Live {
  runId: string
  agent: boolean
  text: string
  reasoning: string
  status: string
  calls: Record<string, LiveCall>
  order: string[]
  approvals: Record<string, FilePreview | CommandPreview>
  usage?: { tokensPerSecond?: number }
}

function getLastModel(): string | undefined {
  try {
    return localStorage.getItem('aistudio.lastModel') ?? undefined
  } catch {
    return undefined
  }
}
function setLastModel(ref: string): void {
  try {
    localStorage.setItem('aistudio.lastModel', ref)
  } catch {
    /* stockage indisponible */
  }
}

/** Reconstruit l'état des appels d'outils à partir des événements enregistrés. */
function callsFromEvents(events: StoredAgentEvent[]): Record<string, LiveCall> {
  const map: Record<string, LiveCall> = {}
  for (const e of events) {
    if (e.type === 'tool-call') {
      const view = e.data.call as ToolCallView
      map[view.id] = { view, status: 'pending' }
    } else if (e.type === 'tool-status') {
      const id = e.data.callId as string
      if (map[id]) map[id] = { ...map[id]!, status: e.data.status as LiveCall['status'], summary: e.data.summary as string, output: e.data.output as string }
    }
  }
  return map
}

export function AssistantPage() {
  const convs = useAsync(() => api.chat.list())
  const projects = useAsync(() => api.projects.list())
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [draftModel, setDraftModel] = useState<string | undefined>(getLastModel())
  const [draftProject, setDraftProject] = useState<string | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [panel, setPanel] = useState(true)
  const reloadConvs = convs.reload
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selected

  const loadDetail = useCallback(async (id: string) => {
    const r = await api.chat.get(id)
    if (r.ok) setDetail(r.value)
    else toast.error(r.error)
  }, [])

  useEffect(() => {
    setLive(null)
    if (selected) void loadDetail(selected)
    else setDetail(null)
  }, [selected, loadDetail])

  useEffect(() => {
    return api.chat.onEvent((ev: ChatEvent) => {
      if (ev.type === 'run-end') void reloadConvs()
      if (ev.conversationId !== selectedRef.current) return
      setLive((cur) => {
        const base: Live = cur && cur.runId === ev.runId ? cur : { runId: ev.runId, agent: false, text: '', reasoning: '', status: '', calls: {}, order: [], approvals: {} }
        switch (ev.type) {
          case 'run-start':
            return { ...base, agent: ev.agent, status: 'Analyse de la demande' }
          case 'status':
            return { ...base, status: ev.text }
          case 'text':
            return { ...base, text: base.text + ev.text, status: '' }
          case 'reasoning':
            return { ...base, reasoning: base.reasoning + ev.text, status: 'Réflexion' }
          case 'tool-call':
            return { ...base, calls: { ...base.calls, [ev.call.id]: { view: ev.call, status: 'pending' } }, order: [...base.order, ev.call.id], status: ev.call.label }
          case 'approval':
            return { ...base, approvals: { ...base.approvals, [ev.callId]: ev.preview }, status: 'En attente de ta validation' }
          case 'tool-status': {
            const c = base.calls[ev.callId]
            const approvals = { ...base.approvals }
            delete approvals[ev.callId]
            return c ? { ...base, approvals, calls: { ...base.calls, [ev.callId]: { ...c, status: ev.status, summary: ev.summary ?? c.summary, output: ev.output ?? c.output } } } : base
          }
          case 'tool-output': {
            const c = base.calls[ev.callId]
            return c ? { ...base, calls: { ...base.calls, [ev.callId]: { ...c, stream: ((c.stream ?? '') + ev.chunk).slice(-20000) } } } : base
          }
          case 'usage':
            return { ...base, usage: { tokensPerSecond: ev.tokensPerSecond } }
          case 'message-saved':
            void loadDetail(ev.conversationId)
            return { ...base, text: '', reasoning: '' }
          case 'run-end':
            void loadDetail(ev.conversationId)
            if (ev.status === 'error' && ev.error) toast.error(ev.error)
            return null
          default:
            return base
        }
      })
    })
  }, [reloadConvs, loadDetail])

  const modelRef = detail?.modelRef ?? draftModel
  const projectId = detail ? detail.projectId : draftProject
  const project = projects.data?.find((p) => p.id === projectId)
  const agentMode = Boolean(projectId) && (detail ? detail.mode === 'agent' : true)
  const running = Boolean(live) || Boolean(detail?.running && !live)

  const send = async (text: string, images: string[]) => {
    if (!modelRef) {
      toast.info('Choisis d’abord un modèle en haut de la conversation.')
      return false
    }
    let id = selected
    if (!id) {
      const r = await api.chat.create({ modelRef, projectId: draftProject, mode: draftProject ? 'agent' : 'chat' })
      if (!r.ok) {
        toast.error(r.error)
        return false
      }
      id = r.value.id
      selectedRef.current = id
      setSelected(id)
      void convs.reload()
    }
    const r = await api.chat.send(id, text, images)
    if (!r.ok) {
      toast.error(r.error)
      return false
    }
    setLive({ runId: r.value, agent: agentMode, text: '', reasoning: '', status: 'Analyse de la demande', calls: {}, order: [], approvals: {} })
    void loadDetail(id)
    return true
  }

  const storedCalls = useMemo(() => (detail ? callsFromEvents(detail.events) : {}), [detail])
  const allCalls = useMemo(() => ({ ...storedCalls, ...(live?.calls ?? {}) }), [storedCalls, live])
  const callsInMessages = useMemo(() => new Set(detail?.messages.flatMap((m) => m.meta.toolCalls?.map((c) => c.id) ?? []) ?? []), [detail])

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight
  }, [detail, live])

  return (
    <div className="flex h-full">
      {/* Conversations */}
      <aside className="flex w-[250px] shrink-0 flex-col border-r border-line">
        <div className="p-3">
          <Button
            className="w-full"
            icon={MessageSquarePlus}
            onClick={() => {
              setSelected(null)
              setDetail(null)
            }}
          >
            Nouvelle conversation
          </Button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {convs.data?.length === 0 && <p className="px-3 py-4 text-[12.5px] text-fg-subtle">Aucune conversation.</p>}
          {convs.data?.map((c) => {
            const d = describeRef(c.modelRef)
            return (
              <div
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={cn('group flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2 transition-colors', selected === c.id ? 'bg-surface-2' : 'hover:bg-surface')}
              >
                {c.mode === 'agent' ? <Bot className="mt-0.5 size-4 shrink-0 text-accent" /> : <MessageSquarePlus className="mt-0.5 size-4 shrink-0 text-fg-subtle" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{c.title}</div>
                  <div className="truncate text-[11px] text-fg-subtle">
                    {d.location === 'local' ? 'Local' : 'Cloud'} · {d.label}
                  </div>
                </div>
                <button
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Supprimer"
                  onClick={async (e) => {
                    e.stopPropagation()
                    await api.chat.remove(c.id)
                    if (selected === c.id) setSelected(null)
                    void convs.reload()
                  }}
                >
                  <Trash2 className="size-3.5 text-fg-subtle hover:text-danger" />
                </button>
              </div>
            )
          })}
        </div>
      </aside>

      {/* Conversation */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <ModelPicker
            value={modelRef}
            requireTools={agentMode}
            onChange={async (ref) => {
              setLastModel(ref)
              if (detail) {
                await api.chat.update(detail.id, { modelRef: ref })
                void loadDetail(detail.id)
              } else setDraftModel(ref)
            }}
          />
          <div className="relative">
            <FolderKanban className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
            <select
              disabled={Boolean(detail)}
              value={projectId ?? ''}
              onChange={(e) => setDraftProject(e.target.value || null)}
              className="h-9 appearance-none rounded-lg border border-line-strong bg-surface-2 pr-8 pl-9 text-[13px] text-fg outline-none disabled:opacity-70"
              title={detail ? 'Le projet est fixé à la création de la conversation.' : 'Choisis un projet pour que l’agent puisse y travailler.'}
            >
              <option value="">Sans projet (discussion)</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
          </div>
          {agentMode ? <Badge tone="accent">Agent</Badge> : <Badge tone="neutral">Discussion</Badge>}
          <div className="flex-1" />
          {live?.usage?.tokensPerSecond && <span className="font-mono text-[11.5px] text-fg-subtle">{Math.round(live.usage.tokensPerSecond)} tokens/s</span>}
          {agentMode && (
            <Button variant="ghost" icon={panel ? PanelRightClose : PanelRightOpen} onClick={() => setPanel((p) => !p)} aria-label="Activité" />
          )}
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[820px] px-6 py-6">
            {!detail && !live && <EmptyState project={project?.name} hasModel={Boolean(modelRef)} />}
            {detail?.messages.map((m) => {
              if (m.role === 'tool') return null
              if (m.role === 'user') return <UserBubble key={m.id} text={m.content} images={m.meta.images} />
              return (
                <div key={m.id} className="mb-5">
                  {m.meta.error ? (
                    <div className="flex gap-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-[13px] text-danger">
                      <CircleAlert className="mt-0.5 size-4 shrink-0" /> <span data-selectable>{m.meta.error}</span>
                    </div>
                  ) : (
                    <AssistantBlock
                      text={m.content}
                      reasoning={m.meta.reasoning}
                      meta={`${m.meta.location === 'local' ? 'Local' : 'Cloud'} · ${m.meta.model ?? ''}${m.meta.tokensPerSecond ? ` · ${Math.round(m.meta.tokensPerSecond)} tokens/s` : ''}`}
                    />
                  )}
                  {m.meta.toolCalls?.map((c) => allCalls[c.id] && <ToolRow key={c.id} call={allCalls[c.id]!} />)}
                </div>
              )
            })}
            {live && (
              <div className="mb-5">
                {(live.reasoning || live.text) && <AssistantBlock text={live.text} reasoning={live.reasoning} streaming />}
                {live.order
                  .filter((id) => !callsInMessages.has(id))
                  .map((id) => (
                    <ToolRow key={id} call={live.calls[id]!} />
                  ))}
                <AnimatePresence>
                  {Object.entries(live.approvals).map(([callId, preview]) => (
                    <ApprovalCard key={callId} preview={preview} call={live.calls[callId]?.view} onDecide={(d) => api.chat.approve(live.runId, callId, d)} />
                  ))}
                </AnimatePresence>
                {live.status && Object.keys(live.approvals).length === 0 && (
                  <div className="mt-3 flex items-center gap-2.5 text-[13px]">
                    <span className="thinking-ring grid size-6 place-items-center rounded-full bg-surface-2">
                      <Bot className="size-3.5 text-accent" />
                    </span>
                    <span className="shimmer-text">{live.status}…</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <Composer running={running} disabled={!modelRef} onSend={send} onStop={() => selected && api.chat.stop(selected)} agent={agentMode} />
      </section>

      {/* Activité de l'agent */}
      <AnimatePresence initial={false}>
        {agentMode && panel && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 340, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="shrink-0 overflow-hidden border-l border-line"
          >
            <ActivityPanel detail={detail} live={live} allCalls={allCalls} onReverted={() => detail && loadDetail(detail.id)} />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------- Messages ----------

function EmptyState({ project, hasModel }: { project?: string; hasModel: boolean }) {
  return (
    <div className="mt-16 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-line-strong bg-surface-2">
        {project ? <Bot className="size-5 text-accent" /> : <MessageSquarePlus className="size-5 text-accent" />}
      </div>
      <h2 className="mt-4 text-[17px] font-semibold">{project ? `Agent sur « ${project} »` : 'Nouvelle discussion'}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] text-fg-muted">
        {!hasModel
          ? 'Choisis un modèle en haut : un modèle local (sans clé, hors ligne) ou un fournisseur Cloud gratuit.'
          : project
            ? 'L’agent peut explorer, lire, modifier les fichiers et lancer des commandes dans ce dossier. Chaque modification et chaque commande te sera montrée avant d’être appliquée.'
            : 'Pose une question, demande un texte, une explication ou du code. Choisis un projet pour activer le mode Agent.'}
      </p>
    </div>
  )
}

function UserBubble({ text, images }: { text: string; images?: string[] }) {
  return (
    <div className="mb-5 flex justify-end gap-3">
      <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-surface-3 px-4 py-2.5">
        {images && images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((b64, i) => (
              <img key={i} src={`data:image/png;base64,${b64}`} className="h-24 rounded-lg object-cover" alt="" />
            ))}
          </div>
        )}
        <div className="text-[14px] whitespace-pre-wrap" data-selectable>
          {text}
        </div>
      </div>
      <div className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2">
        <User className="size-3.5 text-fg-muted" />
      </div>
    </div>
  )
}

function AssistantBlock({ text, reasoning, meta, streaming }: { text: string; reasoning?: string; meta?: string; streaming?: boolean }) {
  const [showReasoning, setShowReasoning] = useState(false)
  return (
    <div className="flex gap-3">
      <div className={cn('grid size-7 shrink-0 place-items-center rounded-full bg-surface-2', streaming && 'thinking-ring')}>
        <Bot className="size-3.5 text-accent" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        {reasoning && (
          <button onClick={() => setShowReasoning((s) => !s)} className="mb-2 flex items-center gap-1.5 text-[12px] text-fg-subtle hover:text-fg-muted">
            <Brain className="size-3.5" /> Raisonnement {showReasoning ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        )}
        {reasoning && showReasoning && (
          <div className="mb-3 border-l-2 border-line-strong pl-3 text-[12.5px] whitespace-pre-wrap text-fg-muted" data-selectable>
            {reasoning}
          </div>
        )}
        {text && <Markdown text={text} />}
        {meta && <div className="mt-1.5 text-[11px] text-fg-subtle">{meta}</div>}
      </div>
    </div>
  )
}

const STATUS_ICON = {
  pending: <CircleDashed className="size-4 text-fg-subtle" />,
  running: <Loader2 className="size-4 animate-spin text-accent" />,
  done: <CircleCheck className="size-4 text-accent" />,
  error: <CircleAlert className="size-4 text-danger" />,
  denied: <CircleSlash className="size-4 text-warn" />
}

function ToolRow({ call }: { call: LiveCall }) {
  const [open, setOpen] = useState(false)
  const out = call.stream || call.output
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 ml-10 overflow-hidden rounded-lg border border-line bg-surface">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
        {STATUS_ICON[call.status]}
        <span className="text-[12.5px] font-medium">{call.view.label}</span>
        {call.view.target && <span className="truncate font-mono text-[11.5px] text-fg-muted">{call.view.target}</span>}
        <span className="ml-auto shrink-0 text-[11.5px] text-fg-subtle">{call.summary}</span>
        {out ? open ? <ChevronDown className="size-3.5 text-fg-subtle" /> : <ChevronRight className="size-3.5 text-fg-subtle" /> : null}
      </button>
      {open && out && (
        <pre className="max-h-64 overflow-auto border-t border-line bg-bg px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-fg-muted" data-selectable>
          {out}
        </pre>
      )}
    </motion.div>
  )
}

function ApprovalCard({ preview, call, onDecide }: { preview: FilePreview | CommandPreview; call?: ToolCallView; onDecide: (d: 'allow' | 'deny' | 'allow-all') => void }) {
  const [busy, setBusy] = useState(false)
  const decide = (d: 'allow' | 'deny' | 'allow-all') => {
    setBusy(true)
    onDecide(d)
  }
  const title =
    preview.kind === 'command'
      ? 'Exécuter cette commande ?'
      : preview.action === 'create'
        ? `Créer ${preview.path} ?`
        : preview.action === 'delete'
          ? `Supprimer ${preview.path} ? (Corbeille)`
          : preview.action === 'move'
            ? `Déplacer ${preview.path} vers ${preview.to} ?`
            : `Modifier ${preview.path} ?`
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="mt-3 ml-10 overflow-hidden rounded-xl border border-warn/40 bg-warn/[0.04]"
    >
      <div className="flex items-center gap-2 border-b border-warn/20 px-4 py-2.5">
        {preview.kind === 'command' ? <Terminal className="size-4 text-warn" /> : <FileEdit className="size-4 text-warn" />}
        <span className="text-[13px] font-medium">{title}</span>
        {call && <span className="ml-auto text-[11px] text-fg-subtle">{call.label}</span>}
      </div>
      <div className="p-3">
        {preview.kind === 'command' ? (
          <pre className="rounded-lg bg-bg px-3 py-2 font-mono text-[12.5px] whitespace-pre-wrap" data-selectable>
            {preview.command}
          </pre>
        ) : preview.action === 'move' ? null : (
          <DiffView before={preview.before} after={preview.after} maxHeight={300} />
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-warn/20 px-3 py-2.5">
        <Button variant="primary" icon={ShieldCheck} disabled={busy} onClick={() => decide('allow')}>
          Autoriser
        </Button>
        <Button variant="secondary" icon={X} disabled={busy} onClick={() => decide('deny')}>
          Refuser
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => decide('allow-all')} className="ml-auto">
          Tout autoriser pour cette tâche
        </Button>
      </div>
    </motion.div>
  )
}

function Composer({ running, disabled, onSend, onStop, agent }: { running: boolean; disabled: boolean; onSend: (t: string, imgs: string[]) => Promise<boolean>; onStop: () => void; agent: boolean }) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const ta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (ta.current) {
      ta.current.style.height = 'auto'
      ta.current.style.height = `${Math.min(ta.current.scrollHeight, 220)}px`
    }
  }, [text])
  const submit = async () => {
    if (running || (!text.trim() && !images.length)) return
    const t = text
    const imgs = images
    setText('')
    setImages([])
    const ok = await onSend(t, imgs)
    if (!ok) {
      setText(t)
      setImages(imgs)
    }
  }
  return (
    <div className="border-t border-line px-5 py-4">
      <div className="mx-auto max-w-[820px] rounded-2xl border border-line-strong bg-surface-2 focus-within:border-accent/50">
        {images.length > 0 && (
          <div className="flex gap-2 px-3 pt-3">
            {images.map((b64, i) => (
              <div key={i} className="relative">
                <img src={`data:image/png;base64,${b64}`} className="size-14 rounded-lg object-cover" alt="" />
                <button className="absolute -top-1.5 -right-1.5 rounded-full bg-surface-3 p-0.5" onClick={() => setImages((l) => l.filter((_, k) => k !== i))} aria-label="Retirer">
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={disabled ? 'Choisis un modèle pour commencer' : agent ? 'Décris ce que l’agent doit faire dans le projet…' : 'Écris ton message…'}
          className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14px] outline-none placeholder:text-fg-subtle"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <button
            className="rounded-lg p-2 text-fg-subtle hover:bg-surface-3 hover:text-fg"
            aria-label="Joindre une image"
            title="Joindre une image (modèles avec vision)"
            onClick={async () => setImages([...images, ...(await api.chat.pickImages())].slice(0, 6))}
          >
            <ImagePlus className="size-4" />
          </button>
          <span className="text-[11px] text-fg-subtle">Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne</span>
          <div className="flex-1" />
          {running ? (
            <Button variant="danger" icon={Square} onClick={onStop}>
              Arrêter
            </Button>
          ) : (
            <button
              disabled={disabled || (!text.trim() && !images.length)}
              onClick={() => void submit()}
              className="grid size-8 place-items-center rounded-lg bg-accent text-[#06140d] transition-opacity disabled:opacity-30"
              aria-label="Envoyer"
            >
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- Panneau d'activité ----------

const STEPS = [
  'Analyse de la demande',
  'Réflexion et planification',
  'Exploration du projet',
  'Lecture des fichiers',
  'Sélection des outils',
  'Exécution des actions',
  'Création ou modification',
  'Vérification',
  'Finalisation'
] as const

type StepState = 'pending' | 'running' | 'done' | 'error' | 'skipped'

function computeSteps(calls: LiveCall[], opts: { started: boolean; reasoning: boolean; text: boolean; ended: boolean; failed: boolean }): StepState[] {
  const s: StepState[] = STEPS.map(() => 'pending')
  if (!opts.started) return s
  const stateOf = (list: LiveCall[]): StepState | null => {
    if (!list.length) return null
    if (list.some((c) => c.status === 'running' || c.status === 'pending')) return 'running'
    if (list.every((c) => c.status === 'error')) return 'error'
    return 'done'
  }
  const anyActivity = calls.length > 0 || opts.reasoning || opts.text
  s[0] = anyActivity || opts.ended ? 'done' : 'running'
  s[1] = opts.reasoning || opts.text || calls.length ? (calls.length || opts.ended ? 'done' : 'running') : opts.ended ? 'skipped' : 'pending'
  const by = (names: string[]) => calls.filter((c) => names.includes(c.view.name))
  const writeIdx = calls.findIndex((c) => ['write_file', 'edit_file', 'move_file', 'delete_file'].includes(c.view.name))
  const commands = by(['run_command'])
  const verify = writeIdx >= 0 ? commands.filter((c) => calls.indexOf(c) > writeIdx) : []
  const exec = commands.filter((c) => !verify.includes(c))
  const groups: (LiveCall[] | null)[] = [by(['list_dir', 'search']), by(['read_file']), calls, exec, by(['write_file', 'edit_file', 'move_file', 'delete_file']), verify]
  groups.forEach((g, k) => {
    const st = stateOf(g ?? [])
    s[k + 2] = st ?? (opts.ended ? 'skipped' : 'pending')
  })
  s[8] = opts.ended ? (opts.failed ? 'error' : 'done') : 'pending'
  return s
}

function ActivityPanel({ detail, live, allCalls, onReverted }: { detail: ConversationDetail | null; live: Live | null; allCalls: Record<string, LiveCall>; onReverted: () => void }) {
  const lastRunId = live?.runId ?? [...(detail?.events ?? [])].reverse().find((e) => e.type === 'run-start')?.runId
  const runEvents = (detail?.events ?? []).filter((e) => e.runId === lastRunId)
  const runCalls = Object.values(allCalls).filter((c) => live?.calls[c.view.id] || runEvents.some((e) => e.type === 'tool-call' && (e.data.call as ToolCallView).id === c.view.id))
  const ended = !live && runEvents.some((e) => e.type === 'run-end')
  const failed = runEvents.some((e) => e.type === 'run-end' && e.data.status === 'error')
  const steps = computeSteps(runCalls, { started: Boolean(lastRunId), reasoning: Boolean(live?.reasoning), text: Boolean(live?.text) || ended, ended, failed })
  const [diffFor, setDiffFor] = useState<number | null>(null)
  const changes = detail?.changes ?? []

  return (
    <div className="flex h-full w-[340px] flex-col overflow-y-auto">
      <div className="border-b border-line px-5 py-4">
        <h3 className="text-[13.5px] font-semibold">Activité de l’agent</h3>
        <p className="mt-0.5 text-[12px] text-fg-muted">Étapes réelles de la dernière tâche, issues des actions de l’agent.</p>
      </div>
      <ol className="space-y-0.5 px-4 py-3">
        {STEPS.map((label, i) => {
          const st = steps[i]!
          return (
            <motion.li key={label} layout className="flex items-center gap-3 rounded-lg px-2 py-1.5">
              <span className="grid size-5 place-items-center">
                {st === 'done' && (
                  <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                    <CircleCheck className="size-4 text-accent" />
                  </motion.span>
                )}
                {st === 'running' && <Loader2 className="size-4 animate-spin text-accent" />}
                {st === 'pending' && <CircleDashed className="size-4 text-fg-subtle" />}
                {st === 'error' && <CircleAlert className="size-4 text-danger" />}
                {st === 'skipped' && <span className="size-1.5 rounded-full bg-line-strong" />}
              </span>
              <span className={cn('text-[12.5px]', st === 'running' ? 'font-medium text-fg' : st === 'skipped' || st === 'pending' ? 'text-fg-subtle' : 'text-fg-muted')}>{label}</span>
              {st === 'skipped' && <span className="ml-auto text-[10.5px] text-fg-subtle">non requise</span>}
            </motion.li>
          )
        })}
      </ol>

      <div className="border-t border-line px-5 py-3">
        <h4 className="text-[12px] font-semibold tracking-wide text-fg-subtle uppercase">Chronologie</h4>
        {runCalls.length === 0 && <p className="mt-2 text-[12px] text-fg-subtle">Aucune action pour l’instant.</p>}
        <ul className="mt-2 space-y-2">
          {runCalls.map((c) => (
            <motion.li key={c.view.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2.5">
              <span className="mt-0.5">{STATUS_ICON[c.status]}</span>
              <div className="min-w-0">
                <div className="text-[12.5px]">{c.view.label}</div>
                {c.view.target && <div className="truncate font-mono text-[11px] text-fg-muted">{c.view.target}</div>}
                {c.summary && <div className="text-[11px] text-fg-subtle">{c.summary}</div>}
              </div>
            </motion.li>
          ))}
        </ul>
      </div>

      <div className="border-t border-line px-5 py-3">
        <h4 className="text-[12px] font-semibold tracking-wide text-fg-subtle uppercase">Fichiers modifiés</h4>
        {changes.length === 0 && <p className="mt-2 text-[12px] text-fg-subtle">Aucune modification.</p>}
        <ul className="mt-2 space-y-2">
          {changes.map((c) => (
            <li key={c.id} className="rounded-lg border border-line bg-surface">
              <div className="flex items-center gap-2 px-2.5 py-2">
                <Badge tone={c.action === 'create' ? 'accent' : c.action === 'delete' ? 'danger' : 'cloud'}>
                  {c.action === 'create' ? 'Créé' : c.action === 'delete' ? 'Supprimé' : c.action === 'move' ? 'Déplacé' : 'Modifié'}
                </Badge>
                <span className={cn('min-w-0 flex-1 truncate font-mono text-[11.5px]', c.status === 'reverted' && 'line-through opacity-60')}>{c.path}</span>
                {c.action !== 'move' && (
                  <button className="text-[11px] text-fg-subtle hover:text-fg" onClick={() => setDiffFor(diffFor === c.id ? null : c.id)}>
                    Diff
                  </button>
                )}
                {c.status === 'applied' && c.action !== 'move' && (
                  <button
                    className="text-fg-subtle hover:text-warn"
                    title="Annuler cette modification"
                    onClick={async () => {
                      const r = await api.chat.revert(c.id)
                      if (r.ok) toast.success('Modification annulée.')
                      else toast.error(r.error)
                      onReverted()
                    }}
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                )}
              </div>
              {diffFor === c.id && (
                <div className="border-t border-line p-2">
                  <DiffView before={c.before} after={c.after} maxHeight={240} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
