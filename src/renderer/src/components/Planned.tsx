import { Construction } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge, Card, PageHeader } from './ui'

/**
 * Page d'une section pas encore développée : elle le dit clairement et
 * décrit ce qui arrive, sans aucun bouton factice.
 */
export function Planned({
  title,
  description,
  milestone,
  features,
  children
}: {
  title: string
  description: string
  milestone: string
  features: { title: string; text: string }[]
  children?: ReactNode
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 border-b border-line bg-surface-2/40 px-6 py-5">
          <div className="grid size-10 place-items-center rounded-xl border border-line-strong bg-surface-2">
            <Construction className="size-5 text-warn" strokeWidth={1.75} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold">En développement</span>
              <Badge tone="warn">Étape {milestone}</Badge>
            </div>
            <p className="mt-0.5 text-[13px] text-fg-muted">
              Cette section n'est pas encore fonctionnelle. Elle sera livrée dans une prochaine mise à jour, installée automatiquement.
            </p>
          </div>
        </div>
        <ul className="grid gap-px bg-line sm:grid-cols-2">
          {features.map((f) => (
            <li key={f.title} className="bg-surface px-6 py-4">
              <div className="text-[13.5px] font-medium">{f.title}</div>
              <div className="mt-1 text-[13px] leading-relaxed text-fg-muted">{f.text}</div>
            </li>
          ))}
        </ul>
      </Card>
      {children}
    </>
  )
}
