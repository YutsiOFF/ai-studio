import { FolderOpen, FolderPlus, Pencil, TriangleAlert, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Project } from '@shared/types'
import { Modal } from '../components/Modal'
import { Badge, Button, Card, Field, PageHeader, Skeleton, inputClass } from '../components/ui'
import { api, useAsync } from '../lib/hooks'
import { toast } from '../lib/toast'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ProjectsPage() {
  const [params, setParams] = useSearchParams()
  const { data, loading, reload } = useAsync(() => api.projects.list())
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [removing, setRemoving] = useState<Project | null>(null)
  const highlight = params.get('id')

  useEffect(() => {
    if (params.get('new') === '1') {
      setCreateOpen(true)
      setParams({}, { replace: true })
    }
  }, [params, setParams])

  return (
    <>
      <PageHeader
        title="Projets"
        description="Chaque projet est relié à un dossier de ton PC. L'IA ne pourra travailler que dans les dossiers que tu lui donnes."
        actions={
          <Button variant="primary" icon={FolderPlus} onClick={() => setCreateOpen(true)}>
            Nouveau projet
          </Button>
        }
      />

      <Card className="mb-5 flex items-center gap-3 border-accent/20 bg-accent/[0.04] px-5 py-3.5">
        <Badge tone="accent">Agents</Badge>
        <p className="text-[13px] text-fg-muted">
          Pour faire travailler une IA dans un projet : ouvre l'Assistant IA, choisis le projet, puis décris la tâche. Chaque modification te sera montrée avant d'être appliquée.
        </p>
      </Card>

      {loading && !data && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      )}

      {data && data.length === 0 && (
        <Card className="grid place-items-center px-6 py-16 text-center">
          <div className="grid size-12 place-items-center rounded-2xl border border-line-strong bg-surface-2">
            <FolderPlus className="size-5 text-accent" strokeWidth={1.75} />
          </div>
          <h3 className="mt-4 text-[15px] font-semibold">Aucun projet</h3>
          <p className="mt-1 max-w-sm text-[13px] text-fg-muted">
            Crée un projet et choisis un dossier existant sur ton PC, par exemple celui de ton jeu ou de ton site.
          </p>
          <Button className="mt-5" variant="primary" icon={FolderPlus} onClick={() => setCreateOpen(true)}>
            Créer mon premier projet
          </Button>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <AnimatePresence initial={false}>
          {data?.map((p) => (
            <motion.div
              key={p.id}
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
            >
              <Card className={highlight === p.id ? 'border-accent/50' : ''}>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{p.name}</h3>
                    {!p.folderExists && (
                      <Badge tone="danger">
                        <TriangleAlert className="size-3" /> Dossier introuvable
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 min-h-[38px] text-[13px] text-fg-muted">
                    {p.description || <span className="text-fg-subtle">Pas de description</span>}
                  </p>
                  <div className="mt-3 truncate rounded-md bg-bg/60 px-2.5 py-1.5 font-mono text-[11.5px] text-fg-muted" title={p.folder} data-selectable>
                    {p.folder}
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-line px-3 py-2">
                  <span className="pl-2 text-[12px] text-fg-subtle">Créé le {formatDate(p.createdAt)}</span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      icon={FolderOpen}
                      disabled={!p.folderExists}
                      onClick={async () => {
                        const r = await api.projects.openFolder(p.id)
                        if (!r.ok) toast.error(r.error)
                      }}
                    >
                      Ouvrir
                    </Button>
                    <Button variant="ghost" icon={Pencil} onClick={() => setEditing(p)} aria-label="Modifier" />
                    <Button variant="ghost" icon={Trash2} onClick={() => setRemoving(p)} aria-label="Retirer" />
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <CreateProjectModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (p) => {
          toast.success(`Projet « ${p.name} » créé.`)
          await reload()
        }}
      />
      <EditProjectModal project={editing} onClose={() => setEditing(null)} onSaved={reload} />
      <Modal
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`Retirer « ${removing?.name ?? ''} » ?`}
        description="Le projet est retiré d'AI Studio. Ton dossier et tous ses fichiers restent intacts sur ton PC."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={async () => {
                if (!removing) return
                const r = await api.projects.remove(removing.id)
                if (r.ok) toast.success('Projet retiré. Le dossier a été conservé.')
                else toast.error(r.error)
                setRemoving(null)
                await reload()
              }}
            >
              Retirer le projet
            </Button>
          </>
        }
      />
    </>
  )
}

function CreateProjectModal({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (p: Project) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [folder, setFolder] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setFolder('')
      setError(null)
    }
  }, [open])

  const submit = async () => {
    setBusy(true)
    const r = await api.projects.create({ name, description, folder })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onOpenChange(false)
    await onCreated(r.value)
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Nouveau projet"
      description="Choisis le dossier dans lequel l'IA pourra travailler."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim() || !folder} onClick={submit}>
            Créer le projet
          </Button>
        </>
      }
    >
      <Field label="Nom">
        <input autoFocus className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Mon jeu Minecraft" />
      </Field>
      <Field label="Description" hint="Facultatif">
        <textarea
          className={`${inputClass} h-20 resize-none py-2`}
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ce que contient ce projet…"
        />
      </Field>
      <Field label="Dossier de travail">
        <div className="flex gap-2">
          <div className={`${inputClass} flex items-center truncate font-mono text-[12px] ${folder ? 'text-fg' : 'text-fg-subtle'}`} title={folder}>
            {folder || 'Aucun dossier choisi'}
          </div>
          <Button
            icon={FolderOpen}
            onClick={async () => {
              const f = await api.projects.pickFolder()
              if (f) {
                setFolder(f)
                if (!name.trim()) setName(f.split(/[\\/]/).filter(Boolean).pop() ?? '')
              }
            }}
          >
            Parcourir
          </Button>
        </div>
      </Field>
      {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
    </Modal>
  )
}

function EditProjectModal({ project, onClose, onSaved }: { project: Project | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (project) {
      setName(project.name)
      setDescription(project.description)
      setError(null)
    }
  }, [project])

  return (
    <Modal
      open={!!project}
      onOpenChange={(v) => !v && onClose()}
      title="Modifier le projet"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            onClick={async () => {
              if (!project) return
              const r = await api.projects.update({ id: project.id, name, description })
              if (!r.ok) return setError(r.error)
              toast.success('Projet mis à jour.')
              onClose()
              await onSaved()
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <Field label="Nom">
        <input className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description">
        <textarea className={`${inputClass} h-20 resize-none py-2`} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Dossier" hint="Le dossier d'un projet ne peut pas être changé.">
        <div className={`${inputClass} flex items-center truncate font-mono text-[12px] text-fg-muted`}>{project?.folder}</div>
      </Field>
      {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
    </Modal>
  )
}
