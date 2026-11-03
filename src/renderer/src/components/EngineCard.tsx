import { Cpu, Download, Power } from 'lucide-react'
import type { EngineStatus } from '@shared/ipc'
import { api } from '../lib/hooks'
import { useTask } from '../lib/tasks'
import { toast } from '../lib/toast'
import { TaskProgress } from './Tasks'
import { Badge, Button, Card, formatMB } from './ui'

/** État du moteur local et installation en un clic. */
export function EngineCard({ status, onChange }: { status: EngineStatus | undefined; onChange: () => void }) {
  const task = useTask('engine:ollama')
  const installing = task?.state === 'running'
  if (!status) return null

  return (
    <Card className="flex items-center gap-4 px-5 py-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-line-strong bg-surface-2">
        <Cpu className="size-5 text-accent" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold">Moteur local</span>
          <Badge tone="local">Local</Badge>
          {status.running ? (
            <Badge tone="accent">Actif{status.version ? ` · v${status.version}` : ''}</Badge>
          ) : status.installed ? (
            <Badge tone="neutral">Installé · arrêté</Badge>
          ) : (
            <Badge tone="warn">Non installé</Badge>
          )}
        </div>
        {installing && task ? (
          <div className="mt-2 max-w-xl">
            <TaskProgress task={task} compact />
          </div>
        ) : (
          <p className="mt-0.5 text-[12.5px] text-fg-muted">
            {status.mode === 'external'
              ? 'Ollama déjà installé sur ce PC : AI Studio l’utilise directement. Aucune clé, aucun compte.'
              : status.installed
                ? 'Ollama (MIT) est géré par AI Studio. Il démarre automatiquement quand tu utilises un modèle local.'
                : `AI Studio peut installer Ollama (MIT) pour toi, sans droits administrateur, sans compte ni clé.${status.downloadSizeMB ? ` Téléchargement : ${formatMB(status.downloadSizeMB)}.` : ''}`}
          </p>
        )}
      </div>
      {!status.installed && !installing && (
        <Button
          variant="primary"
          icon={Download}
          onClick={async () => {
            const r = await api.engine.install()
            if (!r.ok) toast.error(r.error)
            else toast.success('Moteur local installé.')
            onChange()
          }}
        >
          Installer le moteur
        </Button>
      )}
      {status.running && status.mode === 'managed' && (
        <Button
          variant="ghost"
          icon={Power}
          onClick={async () => {
            await api.engine.stop()
            onChange()
          }}
        >
          Arrêter
        </Button>
      )}
    </Card>
  )
}
