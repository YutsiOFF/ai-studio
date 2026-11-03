/**
 * Diffusion d'événements du processus principal vers l'interface.
 * Les événements sont la source de vérité de toute progression affichée.
 */
import { BrowserWindow } from 'electron'

export function emit(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

/** Tâche longue suivie (téléchargement, installation, génération). */
export interface TaskEvent {
  id: string
  kind: 'engine' | 'model' | 'image' | 'mesh3d'
  label: string
  state: 'running' | 'done' | 'error' | 'cancelled'
  stage?: string
  received?: number
  total?: number
  speed?: number
  current?: number
  of?: number
  error?: string
}

const tasks = new Map<string, TaskEvent>()
const controllers = new Map<string, AbortController>()

export function taskUpdate(ev: TaskEvent): void {
  tasks.set(ev.id, ev)
  emit('tasks:event', ev)
  if (ev.state !== 'running') {
    controllers.delete(ev.id)
    setTimeout(() => {
      if (tasks.get(ev.id)?.state !== 'running') tasks.delete(ev.id)
    }, 15_000)
  }
}

export function taskController(id: string): AbortController {
  const c = new AbortController()
  controllers.set(id, c)
  return c
}

export function cancelTask(id: string): boolean {
  const c = controllers.get(id)
  if (!c) return false
  c.abort()
  return true
}

export function listTasks(): TaskEvent[] {
  return [...tasks.values()]
}
