import { Eye, Library, MemoryStick, Power, Sparkles, Trash2, Wrench } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ModelCapabilities } from '@shared/ipc'
import { EngineCard } from '../components/EngineCard'
import { TaskProgress } from '../components/Tasks'
import { Badge, Button, Card, CardHeader, PageHeader, Skeleton, formatMB } from '../components/ui'
import { api, useAsync, usePolling } from '../lib/hooks'
import { useOnTaskDone, useTaskStore } from '../lib/tasks'
import { toast } from '../lib/toast'

export function LocalModelsPage() {
  const navigate = useNavigate()
  const engine = useAsync(() => api.engine.status())
  const installed = useAsync(async () => {
    const s = await api.engine.status()
    if (!s.installed) return { ok: true as const, value: [] }
    return api.models.installed()
  })
  const images = useAsync(() => api.images.status())
  const catalog = useAsync(() => api.models.catalog())
  const loaded = usePolling(() => api.models.loaded(), 3000)
  const speeds = useAsync(() => api.models.speeds())
  const [caps, setCaps] = useState<Record<string, ModelCapabilities | 'error'>>({})
  const tasks = Object.values(useTaskStore((s) => s.tasks)).filter((t) => t.kind === 'model' || t.kind === 'engine')

  const reload = useCallback(() => {
    void engine.reload()
    void installed.reload()
    void images.reload()
  }, [engine.reload, installed.reload, images.reload])
  useOnTaskDone('model:', reload)
  useOnTaskDone('engine:', reload)
  useOnTaskDone('image-model:', reload)

  const list = installed.data?.ok ? installed.data.value : []
  useEffect(() => {
    for (const m of list) {
      if (caps[m.name]) continue
      void api.models.capabilities(m.name).then((r) => setCaps((c) => ({ ...c, [m.name]: r.ok ? r.value : 'error' })))
    }
  }, [list, caps])

  return (
    <>
      <PageHeader
        title="Modèles locaux"
        description="Les modèles installés sur ton PC. Ils fonctionnent hors ligne, sans clé API, sans compte et sans abonnement."
        actions={
          <Button icon={Library} onClick={() => navigate('/library')}>
            Bibliothèque
          </Button>
        }
      />
      <div className="space-y-5">
        <EngineCard status={engine.data} onChange={reload} />

        {tasks.length > 0 && (
          <Card>
            <CardHeader title="Téléchargements en cours" />
            <div className="space-y-4 p-5">
              {tasks.map((t) => (
                <TaskProgress key={t.id} task={t} />
              ))}
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="En mémoire" description="Modèles actuellement chargés (mesure réelle du moteur). Décharger libère la mémoire vidéo." />
          {!loaded || loaded.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-fg-muted">Aucun modèle chargé.</p>
          ) : (
            <ul className="divide-y divide-line">
              {loaded.map((m) => (
                <li key={m.name} className="flex items-center gap-4 px-5 py-3">
                  <MemoryStick className="size-4 text-accent" />
                  <span className="flex-1 font-mono text-[13px]">{m.name}</span>
                  <span className="text-[12.5px] text-fg-muted">
                    {formatMB(m.vramMB)} en VRAM{m.sizeMB > m.vramMB ? ` · ${formatMB(m.sizeMB - m.vramMB)} en RAM` : ''}
                  </span>
                  <Button variant="ghost" icon={Power} onClick={() => api.models.unload(m.name)}>
                    Décharger
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Modèles de discussion installés" description="Capacités vérifiées directement auprès du moteur." />
          {installed.loading && !installed.data ? (
            <div className="p-5">
              <Skeleton className="h-16" />
            </div>
          ) : installed.data && !installed.data.ok ? (
            <p className="px-5 py-4 text-[13px] text-danger">{installed.data.error}</p>
          ) : list.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-fg-muted">Aucun modèle installé. Ouvre la Bibliothèque pour installer le pack recommandé pour ton PC.</p>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((m) => {
                const c = caps[m.name]
                return (
                  <li key={m.name} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-medium">{m.name}</span>
                        <Badge tone="local">Local</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-muted">
                        <span>{formatMB(m.sizeMB)}</span>
                        {m.parameterSize && <span>{m.parameterSize}</span>}
                        {m.quantization && <span>{m.quantization}</span>}
                        {c && c !== 'error' && c.contextK && <span>Contexte {c.contextK}k</span>}
                        {speeds.data?.[m.name] && <span>{speeds.data[m.name]} tokens/s mesurés</span>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {c === undefined && <span className="text-[11.5px] text-fg-subtle">Vérification…</span>}
                      {c && c !== 'error' && (
                        <>
                          <Badge tone={c.tools ? 'accent' : 'neutral'}>
                            <Wrench className="size-3" /> {c.tools ? 'Agent' : 'Sans outils'}
                          </Badge>
                          {c.vision && (
                            <Badge tone="neutral">
                              <Eye className="size-3" /> Vision
                            </Badge>
                          )}
                          {c.thinking && (
                            <Badge tone="neutral">
                              <Sparkles className="size-3" /> Raisonnement
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      icon={Trash2}
                      onClick={async () => {
                        const r = await api.models.remove(m.name)
                        if (!r.ok) toast.error(r.error)
                        else toast.success(`${m.name} supprimé.`)
                        reload()
                      }}
                      aria-label="Supprimer"
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Modèles d’images installés" />
          {!images.data || images.data.installed.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-fg-muted">Aucun modèle d’image installé.</p>
          ) : (
            <ul className="divide-y divide-line">
              {images.data.installed.map((id) => {
                const m = catalog.data?.image.find((x) => x.id === id)
                return (
                  <li key={id} className="flex items-center gap-4 px-5 py-3">
                    <span className="flex-1 text-[13px] font-medium">{m?.name ?? id}</span>
                    <span className="text-[12px] text-fg-muted">{m ? formatMB(m.files.reduce((s, f) => s + f.sizeMB, 0)) : ''}</span>
                    <Button
                      variant="ghost"
                      icon={Trash2}
                      onClick={async () => {
                        await api.images.removeModel(id)
                        reload()
                      }}
                      aria-label="Supprimer"
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
