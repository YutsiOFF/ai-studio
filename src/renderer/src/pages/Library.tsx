import { Box, Check, Download, Eye, Gauge, Search, Sparkles, Trash2, Wrench } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useMemo, useState } from 'react'
import type { ImageEntry, LlmEntry, LlmUse } from '@shared/catalog'
import { assessImage, assessLlm, recommendImage, recommendLlms, type Fit } from '@shared/recommender'
import { EngineCard } from '../components/EngineCard'
import { TaskProgress } from '../components/Tasks'
import { Badge, Button, Card, CardHeader, PageHeader, Skeleton, cn, formatMB, inputClass } from '../components/ui'
import { api, useAsync } from '../lib/hooks'
import { useOnTaskDone, useTaskStore } from '../lib/tasks'
import { toast } from '../lib/toast'

export const FIT_LABEL: Record<Fit, { label: string; tone: 'accent' | 'cloud' | 'warn' | 'danger' }> = {
  fast: { label: 'Rapide', tone: 'accent' },
  hybrid: { label: 'Hybride', tone: 'cloud' },
  slow: { label: 'Lent', tone: 'warn' },
  'too-heavy': { label: 'Trop lourd', tone: 'danger' }
}

const USE_LABEL: Record<LlmUse, string> = { chat: 'Discussion', code: 'Code / Agent', vision: 'Vision', docs: 'Documents longs' }
type Tab = 'llm' | 'image' | '3d'

export function LibraryPage() {
  const [tab, setTab] = useState<Tab>('llm')
  const [query, setQuery] = useState('')
  const [use, setUse] = useState<LlmUse | 'all'>('all')
  const catalog = useAsync(() => api.models.catalog())
  const hw = useAsync(() => api.hardware.get())
  const engine = useAsync(() => api.engine.status())
  const installed = useAsync(async () => {
    const s = await api.engine.status()
    if (!s.running && !s.installed) return []
    const r = await api.models.installed()
    return r.ok ? r.value : []
  })
  const images = useAsync(() => api.images.status())
  const speeds = useAsync(() => api.models.speeds())
  const tasks = useTaskStore((s) => s.tasks)

  const reloadAll = useCallback(() => {
    void engine.reload()
    void installed.reload()
    void images.reload()
  }, [engine.reload, installed.reload, images.reload])
  useOnTaskDone('model:', reloadAll)
  useOnTaskDone('image-model:', reloadAll)
  useOnTaskDone('engine:', reloadAll)

  const recs = useMemo(() => (catalog.data && hw.data ? recommendLlms(catalog.data, hw.data) : []), [catalog.data, hw.data])
  const recImage = useMemo(() => (catalog.data && hw.data ? recommendImage(catalog.data, hw.data) : null), [catalog.data, hw.data])
  const installedSet = new Set((installed.data ?? []).map((m) => m.name))

  const pull = async (tag: string) => {
    const st = await api.engine.status()
    if (!st.installed) {
      toast.info('Installe d’abord le moteur local (bouton en haut de la page).')
      return
    }
    const r = await api.models.pull(tag)
    if (!r.ok) toast.error(r.error)
    else toast.success(`${tag} est installé.`)
  }
  const installImage = async (id: string) => {
    const st = await api.images.status()
    if (!st.engineInstalled) {
      const r = await api.images.installEngine()
      if (!r.ok) return toast.error(r.error)
    }
    const r = await api.images.installModel(id)
    if (!r.ok) toast.error(r.error)
    else toast.success('Modèle d’image installé.')
  }

  if (!catalog.data || !hw.data) {
    return (
      <>
        <PageHeader title="Bibliothèque de modèles" />
        <Skeleton className="h-64" />
      </>
    )
  }

  const llms = catalog.data.llm.filter(
    (m) => (use === 'all' || m.quality[use] !== undefined) && `${m.name} ${m.publisher} ${m.id} ${m.description}`.toLowerCase().includes(query.toLowerCase())
  )
  const sortedLlms = [...llms].sort((a, b) => {
    const order: Fit[] = ['fast', 'hybrid', 'slow', 'too-heavy']
    const fa = order.indexOf(assessLlm(a, hw.data!).fit)
    const fb = order.indexOf(assessLlm(b, hw.data!).fit)
    return fa - fb || a.sizeMB - b.sizeMB
  })
  const packIds = [...new Set(recs.map((r) => r.id).filter((x): x is string => !!x))]
  const packToInstall = packIds.filter((id) => !installedSet.has(id))
  const packSize = packToInstall.reduce((s, id) => s + (catalog.data!.llm.find((m) => m.id === id)?.sizeMB ?? 0), 0)

  return (
    <>
      <PageHeader
        title="Bibliothèque de modèles"
        description="Toutes les IA disponibles, classées selon ce que ton PC peut réellement faire tourner. Licence, taille et besoins affichés pour chacune."
      />

      <div className="mb-5 flex gap-1 rounded-xl border border-line bg-surface p-1">
        {(
          [
            ['llm', 'Discussion, code et vision', Sparkles],
            ['image', "Génération d'images", Eye],
            ['3d', 'Génération 3D', Box]
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'relative flex h-9 flex-1 items-center justify-center gap-2 rounded-lg text-[13px] transition-colors',
              tab === id ? 'text-fg' : 'text-fg-muted hover:text-fg'
            )}
          >
            {tab === id && <motion.span layoutId="lib-tab" className="absolute inset-0 rounded-lg bg-surface-3" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            <Icon className="relative size-4" strokeWidth={1.75} />
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>

      {tab === 'llm' && (
        <div className="space-y-5">
          <EngineCard status={engine.data} onChange={reloadAll} />

          <Card className="overflow-hidden">
            <CardHeader
              title="Pack recommandé pour ton PC"
              description="Le meilleur modèle par usage, calculé à partir de ta carte graphique et de ta mémoire."
              action={
                packToInstall.length > 0 && (
                  <Button
                    variant="primary"
                    icon={Download}
                    onClick={async () => {
                      for (const id of packToInstall) await pull(id)
                    }}
                  >
                    Tout installer ({formatMB(packSize)})
                  </Button>
                )
              }
            />
            <div className="grid divide-line md:grid-cols-4 md:divide-x">
              {recs.map((r) => {
                const m = catalog.data!.llm.find((x) => x.id === r.id)
                return (
                  <div key={r.use} className="px-5 py-4">
                    <div className="text-[11.5px] font-medium tracking-wide text-fg-subtle uppercase">{USE_LABEL[r.use]}</div>
                    {m && r.assessment ? (
                      <>
                        <div className="mt-1 text-[14px] font-semibold">{m.name}</div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <Badge tone={FIT_LABEL[r.assessment.fit].tone}>{FIT_LABEL[r.assessment.fit].label}</Badge>
                          {installedSet.has(m.id) && <Badge tone="local">Installé</Badge>}
                        </div>
                        <div className="mt-1.5 text-[12px] text-fg-muted">
                          {formatMB(m.sizeMB)} · ~{speeds.data?.[m.id] ?? r.assessment.tokensPerSecond} tokens/s{speeds.data?.[m.id] ? ' (mesuré)' : ' (estimé)'}
                        </div>
                      </>
                    ) : (
                      <div className="mt-1 text-[12.5px] text-fg-muted">Aucun modèle local adapté : utilise le Cloud gratuit.</div>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
              <input className={`${inputClass} pl-9`} placeholder="Rechercher un modèle…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {(['all', 'chat', 'code', 'vision', 'docs'] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUse(u)}
                className={cn('h-9 rounded-lg border px-3 text-[12.5px] transition-colors', use === u ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line-strong text-fg-muted hover:text-fg')}
              >
                {u === 'all' ? 'Tous' : USE_LABEL[u]}
              </button>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {sortedLlms.map((m) => (
              <LlmCard
                key={m.id}
                m={m}
                fitInfo={assessLlm(m, hw.data!)}
                recommended={packIds.includes(m.id)}
                installed={installedSet.has(m.id)}
                measured={speeds.data?.[m.id]}
                task={tasks[`model:${m.id}`]}
                onInstall={() => pull(m.id)}
                onRemove={async () => {
                  const r = await api.models.remove(m.id)
                  if (!r.ok) toast.error(r.error)
                  reloadAll()
                }}
              />
            ))}
          </div>
          <CustomPull onPull={pull} />
        </div>
      )}

      {tab === 'image' && (
        <div className="space-y-3">
          <Card className="px-5 py-4 text-[13px] text-fg-muted">
            Moteur : <span className="text-fg">stable-diffusion.cpp</span> (MIT), installé automatiquement avec le premier modèle et adapté à ta carte graphique (
            {hw.data.assessment.accelerator.toUpperCase()}). Modèles téléchargés depuis Hugging Face, sans compte, avec vérification de l’intégrité.
          </Card>
          <div className="grid gap-3 lg:grid-cols-2">
            {catalog.data.image.map((m) => (
              <ImageCard
                key={m.id}
                m={m}
                fitInfo={assessImage(m, hw.data!)}
                recommended={m.id === recImage}
                installed={images.data?.installed.includes(m.id) ?? false}
                task={tasks[`image-model:${m.id}`] ?? (tasks['engine:sdcpp']?.state === 'running' ? tasks['engine:sdcpp'] : undefined)}
                onInstall={() => installImage(m.id)}
                onRemove={async () => {
                  await api.images.removeModel(m.id)
                  reloadAll()
                }}
              />
            ))}
          </div>
        </div>
      )}

      {tab === '3d' && <ThreeDLibrary local3D={hw.data.assessment.local3D} />}
    </>
  )
}

function Caps({ caps }: { caps: LlmEntry['capabilities'] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {caps.includes('tools') && (
        <span className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-fg-muted">
          <Wrench className="size-3" /> Outils
        </span>
      )}
      {caps.includes('vision') && (
        <span className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-fg-muted">
          <Eye className="size-3" /> Vision
        </span>
      )}
      {caps.includes('thinking') && (
        <span className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-fg-muted">
          <Sparkles className="size-3" /> Raisonnement
        </span>
      )}
    </div>
  )
}

function LlmCard(props: {
  m: LlmEntry
  fitInfo: ReturnType<typeof assessLlm>
  recommended: boolean
  installed: boolean
  measured?: number
  task?: import('@shared/ipc').TaskEvent
  onInstall: () => void
  onRemove: () => void
}) {
  const { m, fitInfo, task } = props
  const running = task?.state === 'running'
  return (
    <Card className={cn('flex flex-col p-5', props.recommended && 'border-accent/30')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14.5px] font-semibold">{m.name}</h3>
            {props.recommended && <Badge tone="accent">Recommandé</Badge>}
          </div>
          <div className="mt-0.5 text-[12px] text-fg-subtle">
            {m.publisher} · <span className="font-mono">{m.id}</span>
          </div>
        </div>
        <Badge tone={FIT_LABEL[fitInfo.fit].tone}>{FIT_LABEL[fitInfo.fit].label}</Badge>
      </div>
      <p className="mt-2 text-[13px] text-fg-muted">{m.description}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-fg-muted">
        <span>{formatMB(m.sizeMB)}</span>
        <span>{m.paramsB} Md de paramètres{m.activeParamsB < m.paramsB ? ` (${m.activeParamsB} actifs)` : ''}</span>
        <span>Contexte {m.contextK}k</span>
        <span className={m.commercial ? '' : 'text-warn'}>{m.license}</span>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <Caps caps={m.capabilities} />
        {fitInfo.fit !== 'too-heavy' && (
          <span className="flex items-center gap-1 text-[11.5px] text-fg-subtle">
            <Gauge className="size-3.5" /> ~{props.measured ?? fitInfo.tokensPerSecond} tokens/s {props.measured ? 'mesuré' : 'estimé'}
          </span>
        )}
      </div>
      <p className="mt-2 text-[11.5px] text-fg-subtle">{fitInfo.reason}</p>
      <div className="mt-auto pt-4">
        {running && task ? (
          <TaskProgress task={task} compact />
        ) : props.installed ? (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[12.5px] text-accent">
              <Check className="size-4" /> Installé sur ce PC
            </span>
            <Button variant="ghost" icon={Trash2} onClick={props.onRemove}>
              Supprimer
            </Button>
          </div>
        ) : (
          <Button className="w-full" variant={fitInfo.fit === 'too-heavy' ? 'secondary' : 'primary'} icon={Download} onClick={props.onInstall}>
            {fitInfo.fit === 'too-heavy' ? 'Installer quand même' : 'Installer'}
          </Button>
        )}
      </div>
    </Card>
  )
}

function ImageCard(props: {
  m: ImageEntry
  fitInfo: ReturnType<typeof assessImage>
  recommended: boolean
  installed: boolean
  task?: import('@shared/ipc').TaskEvent
  onInstall: () => void
  onRemove: () => void
}) {
  const { m, fitInfo, task } = props
  const size = m.files.reduce((s, f) => s + f.sizeMB, 0)
  return (
    <Card className={cn('flex flex-col p-5', props.recommended && 'border-accent/30')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[14.5px] font-semibold">{m.name}</h3>
            {props.recommended && <Badge tone="accent">Recommandé</Badge>}
          </div>
          <div className="mt-0.5 text-[12px] text-fg-subtle">{m.publisher}</div>
        </div>
        <Badge tone={FIT_LABEL[fitInfo.fit].tone}>{FIT_LABEL[fitInfo.fit].label}</Badge>
      </div>
      <p className="mt-2 text-[13px] text-fg-muted">{m.description}</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-muted">
        <span>{formatMB(size)} ({m.files.length} fichier{m.files.length > 1 ? 's' : ''})</span>
        <span>{m.defaults.width} × {m.defaults.height} · {m.defaults.steps} étapes</span>
        <span className={m.commercial ? '' : 'text-warn'}>{m.license}{m.commercial ? '' : ' · non commercial'}</span>
      </div>
      <p className="mt-2 text-[11.5px] text-fg-subtle">{fitInfo.reason}</p>
      <div className="mt-auto pt-4">
        {task?.state === 'running' ? (
          <TaskProgress task={task} compact />
        ) : props.installed ? (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[12.5px] text-accent">
              <Check className="size-4" /> Installé
            </span>
            <Button variant="ghost" icon={Trash2} onClick={props.onRemove}>
              Supprimer
            </Button>
          </div>
        ) : (
          <Button className="w-full" variant="primary" icon={Download} onClick={props.onInstall}>
            Installer
          </Button>
        )}
      </div>
    </Card>
  )
}

function ThreeDLibrary({ local3D }: { local3D: boolean }) {
  const rows = [
    { name: 'TRELLIS (Microsoft)', where: 'Cloud gratuit (Hugging Face)', license: 'MIT', status: 'Disponible', tone: 'accent' as const, text: 'Image → modèle 3D texturé (GLB). Quota gratuit : ~2 min de GPU/jour sans compte, 5 min avec un compte Hugging Face gratuit.' },
    { name: 'TripoSR', where: 'Local (NVIDIA 6 Go+)', license: 'MIT', status: local3D ? 'En préparation' : 'Incompatible avec ce PC', tone: 'warn' as const, text: 'Nécessite la compilation de dépendances CUDA sous Windows : intégration prévue dans une prochaine version.' },
    { name: 'TripoSG', where: 'Local (NVIDIA 8 Go+)', license: 'MIT', status: local3D ? 'En préparation' : 'Incompatible avec ce PC', tone: 'warn' as const, text: 'Géométrie très précise, sans texture. Même contrainte d’installation que TripoSR.' },
    { name: 'Segmentation géométrique', where: 'Local (tous les PC)', license: '—', status: 'Disponible', tone: 'accent' as const, text: 'Découpage en pièces séparées et sélection de régions par angle, directement dans le visualiseur.' },
    { name: 'Hunyuan3D 2.x / P3-SAM', where: '—', license: 'Tencent (exclut l’UE)', status: 'Non proposé', tone: 'danger' as const, text: 'Licence non valable en France et dans l’Union européenne.' }
  ]
  return (
    <Card>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.name} className="flex items-start gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold">{r.name}</span>
                <Badge tone={r.where.startsWith('Cloud') ? 'cloud' : 'local'}>{r.where.startsWith('Cloud') ? 'Cloud' : 'Local'}</Badge>
              </div>
              <p className="mt-1 text-[13px] text-fg-muted">{r.text}</p>
              <p className="mt-1 text-[11.5px] text-fg-subtle">
                {r.where} · Licence : {r.license}
              </p>
            </div>
            <Badge tone={r.tone}>{r.status}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function CustomPull({ onPull }: { onPull: (tag: string) => Promise<void> }) {
  const [tag, setTag] = useState('')
  const [size, setSize] = useState<number | null | undefined>(undefined)
  return (
    <Card className="p-5">
      <div className="text-[13.5px] font-medium">Installer un autre modèle Ollama</div>
      <p className="mt-0.5 text-[12.5px] text-fg-muted">
        N’importe quel modèle de la bibliothèque publique d’Ollama (ex. <span className="font-mono">phi4:14b</span>). La taille exacte est vérifiée avant le téléchargement. Les modèles « cloud » ne sont pas acceptés ici.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          className={`${inputClass} font-mono`}
          placeholder="nom:taille"
          value={tag}
          onChange={(e) => {
            setTag(e.target.value.trim())
            setSize(undefined)
          }}
        />
        <Button onClick={async () => setSize(await api.models.registrySize(tag))} disabled={!tag}>
          Vérifier
        </Button>
        <Button
          variant="primary"
          icon={Download}
          disabled={!tag || /cloud/i.test(tag)}
          onClick={() => {
            void onPull(tag)
            setTag('')
            setSize(undefined)
          }}
        >
          Installer
        </Button>
      </div>
      {size !== undefined && <p className="mt-2 text-[12.5px] text-fg-muted">{size === null ? 'Modèle introuvable sur le registre (ou hors ligne).' : `Taille du téléchargement : ${formatMB(size)}.`}</p>}
    </Card>
  )
}
