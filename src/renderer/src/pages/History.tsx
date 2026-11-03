import { Activity, Bot, Box, Cloud, Cpu, FolderKanban, HardDrive, Image, Power, Settings } from 'lucide-react'
import { Card, PageHeader, Skeleton } from '../components/ui'
import { api, useAsync } from '../lib/hooks'

const ICONS: Record<string, typeof Activity> = {
  project: FolderKanban,
  settings: Settings,
  app: Power,
  model: HardDrive,
  'image-model': HardDrive,
  engine: Cpu,
  agent: Bot,
  cloud: Cloud,
  image: Image,
  mesh3d: Box
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui"
  if (d.toDateString() === yesterday.toDateString()) return 'Hier'
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function HistoryPage() {
  const { data, loading } = useAsync(() => api.activity.list(300))

  const groups = new Map<string, NonNullable<typeof data>>()
  for (const e of data ?? []) {
    const k = dayLabel(e.ts)
    groups.set(k, [...(groups.get(k) ?? []), e])
  }

  return (
    <>
      <PageHeader
        title="Historique"
        description="Journal local de toutes les actions : projets, modèles, générations, modifications des agents. Il reste sur ton PC et n'est jamais envoyé. Les conversations sont dans l'Assistant, les images et modèles 3D dans leurs pages."

      />
      {loading && !data && <Skeleton className="h-64" />}
      <div className="space-y-6">
        {[...groups.entries()].map(([day, entries]) => (
          <section key={day}>
            <h2 className="mb-2 text-[12px] font-semibold tracking-wide text-fg-subtle uppercase">{day}</h2>
            <Card>
              <ul className="divide-y divide-line">
                {entries.map((e) => {
                  const Icon = ICONS[e.type.split('.')[0] ?? ''] ?? Activity
                  return (
                    <li key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                      <Icon className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
                      <span className="flex-1 truncate text-[13px]">{e.message}</span>
                      <time className="font-mono text-[11.5px] text-fg-subtle">
                        {new Date(e.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </time>
                    </li>
                  )
                })}
              </ul>
            </Card>
          </section>
        ))}
      </div>
    </>
  )
}
