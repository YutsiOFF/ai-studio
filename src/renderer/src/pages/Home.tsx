import { ArrowRight, FolderPlus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { HardwareCard } from '../components/HardwareCard'
import { Badge, Button, Card, CardHeader, PageHeader } from '../components/ui'
import { api, useAsync } from '../lib/hooks'
import { NAV, type ModuleStatus } from '../nav'

const STATUS: Record<ModuleStatus, { label: string; tone: 'accent' | 'warn' | 'neutral' }> = {
  available: { label: 'Disponible', tone: 'accent' },
  partial: { label: 'Partiel', tone: 'warn' },
  planned: { label: 'À venir', tone: 'neutral' }
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return 'Bonne nuit'
  if (h < 18) return 'Bonjour'
  return 'Bonsoir'
}

export function HomePage() {
  const navigate = useNavigate()
  const hw = useAsync(() => api.hardware.get())
  const projects = useAsync(() => api.projects.list())

  return (
    <>
      <PageHeader
        title={greeting()}
        description="Tes IA gratuites, locales et Cloud, réunies dans un seul espace de travail."
        actions={
          <Button variant="primary" icon={FolderPlus} onClick={() => navigate('/projects?new=1')}>
            Nouveau projet
          </Button>
        }
      />

      <div className="space-y-5">
        <HardwareCard
          hw={hw.data}
          onRefresh={async () => {
            hw.setData(await api.hardware.get(true))
          }}
        />

        <div className="grid gap-5 lg:grid-cols-[1fr_1.35fr]">
          <Card>
            <CardHeader
              title="Projets récents"
              action={
                <Button variant="ghost" onClick={() => navigate('/projects')}>
                  Tout voir <ArrowRight className="size-3.5" />
                </Button>
              }
            />
            <div className="p-2">
              {projects.data && projects.data.length === 0 && (
                <p className="px-3 py-6 text-center text-[13px] text-fg-muted">Aucun projet pour l'instant.</p>
              )}
              {projects.data?.slice(0, 5).map((p) => (
                <button
                  key={p.id}
                  onClick={() => navigate(`/projects?id=${p.id}`)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium">{p.name}</div>
                    <div className="truncate font-mono text-[11.5px] text-fg-subtle">{p.folder}</div>
                  </div>
                  {!p.folderExists && <Badge tone="danger">Dossier introuvable</Badge>}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="État des modules" description="Ce qui fonctionne déjà, et ce qui arrive dans les prochaines mises à jour." />
            <ul className="divide-y divide-line">
              {NAV.filter((n) => n.path !== '/').map((n) => (
                <li key={n.path} className="flex items-center gap-3 px-5 py-2.5">
                  <n.icon className="size-4 text-fg-subtle" strokeWidth={1.75} />
                  <span className="flex-1 text-[13px]">{n.label}</span>
                  <span className="text-[11.5px] text-fg-subtle">{n.milestone}</span>
                  <Badge tone={STATUS[n.status].tone} className="w-[78px] justify-center">
                    {STATUS[n.status].label}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  )
}
