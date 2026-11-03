import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck, Download, Loader2, X } from 'lucide-react'
import type { TaskEvent } from '@shared/ipc'
import { api } from '../lib/hooks'
import { formatBytes, formatEta, useTaskStore } from '../lib/tasks'
import { Meter, cn } from './ui'

export function TaskProgress({ task, compact }: { task: TaskEvent; compact?: boolean }) {
  const pct = task.total ? (task.received ?? 0) / task.total : task.of ? (task.current ?? 0) / task.of : undefined
  const eta = formatEta(task)
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        {task.state === 'running' && <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />}
        {task.state === 'done' && <CircleCheck className="size-3.5 shrink-0 text-accent" />}
        {(task.state === 'error' || task.state === 'cancelled') && <CircleAlert className="size-3.5 shrink-0 text-danger" />}
        <span className={cn('truncate text-[12.5px]', compact ? 'text-fg-muted' : 'font-medium')}>{compact ? task.stage : task.label}</span>
        {task.state === 'running' && (
          <button onClick={() => api.tasks.cancel(task.id)} className="ml-auto shrink-0 text-fg-subtle hover:text-danger" aria-label="Annuler">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {!compact && task.stage && <div className="mt-0.5 truncate text-[11.5px] text-fg-muted">{task.stage}</div>}
      {task.state === 'running' && pct !== undefined && (
        <div className="mt-1.5">
          <Meter value={pct * 100} max={100} />
          <div className="mt-1 flex justify-between font-mono text-[10.5px] text-fg-subtle">
            <span>
              {task.total ? `${formatBytes(task.received)} / ${formatBytes(task.total)}` : `${task.current ?? 0} / ${task.of}`}
            </span>
            <span>{task.speed ? `${formatBytes(task.speed)}/s` : ''}{eta ? ` · ${eta}` : ''}</span>
          </div>
        </div>
      )}
      {task.state === 'error' && task.error && <div className="mt-1 line-clamp-3 text-[11.5px] text-danger">{task.error}</div>}
    </div>
  )
}

/** Panneau flottant des tâches en cours (téléchargements, installations, générations). */
export function TaskDock() {
  const tasks = Object.values(useTaskStore((s) => s.tasks))
  return (
    <div className="pointer-events-none fixed bottom-5 left-[284px] z-40 flex w-[340px] flex-col gap-2">
      <AnimatePresence initial={false}>
        {tasks.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.22 }}
            className="pointer-events-auto rounded-xl border border-line-strong bg-surface-2/95 px-3.5 py-3 shadow-2xl shadow-black/40 backdrop-blur"
          >
            <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wide text-fg-subtle uppercase">
              <Download className="size-3" /> {t.kind === 'engine' ? 'Moteur' : t.kind === 'model' ? 'Modèle' : t.kind === 'image' ? 'Image' : '3D'}
            </div>
            <TaskProgress task={t} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
