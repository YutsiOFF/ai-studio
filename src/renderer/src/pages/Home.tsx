import { ArrowRight, Box, FolderPlus, Image, Library, MessagesSquare } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { HardwareCard } from '../components/HardwareCard'
import { Badge, Button, Card, CardHeader, PageHeader } from '../components/ui'
import { api, useAsync } from '../lib/hooks'

const QUICK = [
  { path: '/library', icon: Library, title: 'Installer des IA locales', text: 'Le pack recommandé pour ton PC, en un clic.' },
  { path: '/assistant', icon: MessagesSquare, title: 'Discuter ou lancer un agent', text: 'Local ou Cloud gratuit, sur tes projets.' },
  { path: '/images', icon: Image, title: 'Générer des images', text: 'Z-Image, SDXL, SD 1.5 en local.' },
  { path: '/3d', icon: Box, title: 'Créer un modèle 3D', text: 'Image → 3D, découpage en parties, export.' }
]

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
            <CardHeader title="Commencer" description="Tout fonctionne en local sans compte ; le Cloud gratuit est en option." />
            <div className="grid grid-cols-2 gap-px bg-line">
              {QUICK.map((q) => (
                <button key={q.path} onClick={() => navigate(q.path)} className="group flex items-start gap-3 bg-surface px-5 py-4 text-left transition-colors hover:bg-surface-2">
                  <q.icon className="mt-0.5 size-5 shrink-0 text-accent" strokeWidth={1.75} />
                  <div>
                    <div className="text-[13.5px] font-medium">{q.title}</div>
                    <div className="mt-0.5 text-[12px] text-fg-muted">{q.text}</div>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
