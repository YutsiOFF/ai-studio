import { motion } from 'motion/react'
import { Download, ExternalLink, FolderOpen, RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Settings, UpdateStatus } from '@shared/types'
import { HardwareCard } from '../components/HardwareCard'
import { AiTab, SecurityTab } from './SettingsAi'
import { Badge, Button, Card, CardHeader, Meter, PageHeader, Skeleton, Toggle, cn, formatMB } from '../components/ui'
import { api, useAsync, usePolling } from '../lib/hooks'
import { toast } from '../lib/toast'
import { useTaskStore } from '../lib/tasks'
import { TaskProgress } from '../components/Tasks'

const TABS = [
  { id: 'general', label: 'Général' },
  { id: 'resources', label: 'Ressources' },
  { id: 'ai', label: 'IA' },
  { id: 'security', label: 'Sécurité' },
  { id: 'updates', label: 'Mises à jour' },
  { id: 'about', label: 'À propos' }
] as const
type TabId = (typeof TABS)[number]['id']

export function SettingsPage() {
  const [tab, setTab] = useState<TabId>('general')
  return (
    <>
      <PageHeader title="Paramètres" />
      <div className="mb-6 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn('relative px-3.5 pb-3 text-[13.5px] transition-colors', tab === t.id ? 'text-fg' : 'text-fg-muted hover:text-fg')}
          >
            {t.label}
            {tab === t.id && <motion.span layoutId="settings-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>
      {tab === 'general' && <GeneralTab />}
      {tab === 'resources' && <ResourcesTab />}
      {tab === 'ai' && <AiTab />}
      {tab === 'security' && <SecurityTab />}
      {tab === 'updates' && <UpdatesTab />}
      {tab === 'about' && <AboutTab />}
    </>
  )
}

function Row({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div>
        <div className="text-[13.5px] font-medium">{title}</div>
        <div className="mt-0.5 text-[12.5px] text-fg-muted">{description}</div>
      </div>
      {children}
    </div>
  )
}

function useSettings() {
  const { data, setData } = useAsync(() => api.settings.get())
  const update = async (patch: Partial<Settings>) => {
    setData(await api.settings.update(patch))
  }
  return { settings: data, update }
}

function GeneralTab() {
  const { settings, update } = useSettings()
  const { data: info } = useAsync(() => api.app.info())
  if (!settings) return <Skeleton className="h-60" />
  return (
    <div className="space-y-5">
      <Card>
        <div className="divide-y divide-line">
          <Row title="Langue" description="Anglais prévu dans une prochaine mise à jour.">
            <span className="text-[13px] text-fg-muted">Français</span>
          </Row>
          <Row title="Thème" description="Thème clair prévu ultérieurement.">
            <span className="text-[13px] text-fg-muted">Sombre</span>
          </Row>
          <Row title="Lancer au démarrage de Windows" description="Ouvre AI Studio automatiquement à l'ouverture de ta session.">
            <Toggle
              label="Lancer au démarrage"
              checked={settings.launchAtStartup}
              disabled={!info?.isPackaged}
              onChange={(v) => update({ launchAtStartup: v })}
            />
          </Row>
          <Row title="Notifications" description="Notifications Windows (mise à jour prête, et plus tard fin de génération).">
            <Toggle label="Notifications" checked={settings.notifications} onChange={(v) => update({ notifications: v })} />
          </Row>
          <Row title="Moteurs à licence restreinte" description="Hunyuan3D-2.1 (Tencent) : licence excluant l’Union européenne, le Royaume-Uni et la Corée du Sud. Désactivé par défaut.">
            <Toggle label="Licences restreintes" checked={settings.allowRestrictedLicenses} onChange={(v) => update({ allowRestrictedLicenses: v })} />
          </Row>
        </div>
      </Card>
      <Card>
        <CardHeader title="Emplacement des données" description="Base de données, et plus tard moteurs, modèles et générations." />
        <div className="flex items-center gap-3 px-5 py-4">
          <code className="flex-1 truncate rounded-md bg-bg/60 px-2.5 py-1.5 font-mono text-[12px] text-fg-muted" data-selectable>
            {info?.dataPath}
          </code>
          <Button icon={FolderOpen} onClick={() => api.app.openDataFolder()}>
            Ouvrir
          </Button>
        </div>
        <p className="px-5 pb-4 text-[12px] text-fg-subtle">Moteurs, modèles et générations sont stockés dans ce dossier, sur ton PC uniquement.</p>
      </Card>
    </div>
  )
}

function ResourcesTab() {
  const hw = useAsync(() => api.hardware.get())
  const usage = usePolling(() => api.hardware.usage(), 2000)
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Utilisation en direct" description="Mise à jour toutes les 2 secondes." />
        {!usage ? (
          <div className="p-5">
            <Skeleton className="h-24" />
          </div>
        ) : (
          <div className="grid gap-6 p-5 md:grid-cols-2">
            <Gauge label="Processeur" value={`${usage.cpuLoadPercent} %`} pct={usage.cpuLoadPercent} max={100} />
            <Gauge label="Mémoire vive" value={`${formatMB(usage.memUsedMB)} / ${formatMB(usage.memTotalMB)}`} pct={usage.memUsedMB} max={usage.memTotalMB} />
            {usage.gpus.map((g) => (
              <Gauge
                key={g.name}
                label={`VRAM · ${g.name}`}
                value={`${formatMB(g.vramUsedMB)} / ${formatMB(g.vramTotalMB)} · GPU ${g.utilizationPercent} %`}
                pct={g.vramUsedMB}
                max={g.vramTotalMB}
                tone="cloud"
              />
            ))}
            {usage.gpus.length === 0 && (
              <div className="text-[12.5px] text-fg-muted">
                Mesure de la mémoire vidéo en direct : disponible pour les cartes NVIDIA (nvidia-smi). Pour AMD et Intel, la page Modèles locaux affiche la mémoire utilisée par chaque modèle.
              </div>
            )}
            <Gauge label="Disque (données)" value={`${formatMB(usage.disk.freeMB)} libres`} pct={usage.disk.totalMB - usage.disk.freeMB} max={usage.disk.totalMB} tone="warn" />
          </div>
        )}
        <ActiveDownloads />
      </Card>
      <HardwareCard
        hw={hw.data}
        detailed
        onRefresh={async () => {
          hw.setData(await api.hardware.get(true))
        }}
      />
    </div>
  )
}

function ActiveDownloads() {
  const tasks = Object.values(useTaskStore((s) => s.tasks)).filter((t) => t.state === 'running')
  return (
    <div className="border-t border-line px-5 py-3">
      <div className="text-[12.5px] text-fg-muted">Tâches actives : {tasks.length === 0 ? 'aucune' : tasks.length}</div>
      <div className="mt-2 space-y-3">
        {tasks.map((t) => (
          <TaskProgress key={t.id} task={t} />
        ))}
      </div>
    </div>
  )
}

function Gauge({ label, value, pct, max, tone }: { label: string; value: string; pct: number; max: number; tone?: 'accent' | 'cloud' | 'warn' }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="truncate text-[12.5px] text-fg-muted">{label}</span>
        <span className="shrink-0 font-mono text-[12px]">{value}</span>
      </div>
      <Meter value={pct} max={max} tone={tone} />
    </div>
  )
}

function describe(s: UpdateStatus | undefined): string {
  if (!s) return '…'
  switch (s.state) {
    case 'idle':
      return 'Aucune vérification effectuée pour le moment.'
    case 'unsupported':
      return s.reason
    case 'checking':
      return 'Recherche de mises à jour…'
    case 'none':
      return `AI Studio est à jour (vérifié à ${new Date(s.checkedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}).`
    case 'available':
      return `Version ${s.version} disponible, téléchargement en cours…`
    case 'downloading':
      return `Téléchargement de la mise à jour${s.version ? ` ${s.version}` : ''} : ${s.percent} %`
    case 'ready':
      return `Version ${s.version} prête. Elle sera installée au redémarrage.`
    case 'error':
      return `Erreur : ${s.message}`
  }
}

function UpdatesTab() {
  const { settings, update } = useSettings()
  const [status, setStatus] = useState<UpdateStatus>()
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void api.updates.status().then(setStatus)
    return api.updates.onStatus(setStatus)
  }, [])

  return (
    <Card>
      <div className="divide-y divide-line">
        <Row title="Version installée" description={describe(status)}>
          <div className="flex gap-2">
            {status?.state === 'ready' ? (
              <Button variant="primary" icon={RotateCcw} onClick={() => api.updates.install()}>
                Redémarrer et installer
              </Button>
            ) : (
              <Button
                icon={RefreshCw}
                loading={checking}
                disabled={status?.state === 'unsupported'}
                onClick={async () => {
                  setChecking(true)
                  const s = await api.updates.check()
                  setStatus(s)
                  setChecking(false)
                  if (s.state === 'error') toast.error('La vérification des mises à jour a échoué.')
                }}
              >
                Rechercher
              </Button>
            )}
          </div>
        </Row>
        {status?.state === 'downloading' && (
          <div className="px-5 py-4">
            <Meter value={status.percent} max={100} />
          </div>
        )}
        <Row title="Vérifier automatiquement" description="Recherche une nouvelle version au démarrage et la télécharge en arrière-plan.">
          {settings && <Toggle label="Vérification automatique" checked={settings.autoCheckUpdates} onChange={(v) => update({ autoCheckUpdates: v })} />}
        </Row>
      </div>
    </Card>
  )
}

function AboutTab() {
  const { data: info } = useAsync(() => api.app.info())
  return (
    <Card>
      <div className="divide-y divide-line">
        <Row title="AI Studio" description="Plateforme d'IA gratuites, locales et Cloud. Licence MIT.">
          <span className="font-mono text-[12.5px] text-fg-muted">v{info?.version}</span>
        </Row>
        <Row title="Site officiel" description="yutsioff.github.io/ai-studio">
          <Button icon={ExternalLink} onClick={() => api.app.openExternal('https://yutsioff.github.io/ai-studio/')}>
            Ouvrir
          </Button>
        </Row>
        <Row title="Code source" description="github.com/YutsiOFF/ai-studio">
          <Button icon={ExternalLink} onClick={() => api.app.openExternal('https://github.com/YutsiOFF/ai-studio')}>
            Ouvrir
          </Button>
        </Row>
        <Row title="Versions publiées" description="Notes de version et installateurs.">
          <Button icon={Download} onClick={() => api.app.openExternal('https://github.com/YutsiOFF/ai-studio/releases')}>
            Releases
          </Button>
        </Row>
        <Row title="Composants" description={`Electron ${info?.electron ?? ''} · Chromium ${info?.chrome ?? ''} · Node ${info?.node ?? ''}`}>
          <span />
        </Row>
      </div>
    </Card>
  )
}
