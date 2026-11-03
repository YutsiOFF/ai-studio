import { useEffect } from 'react'
import { create } from 'zustand'
import type { TaskEvent } from '@shared/ipc'
import { api } from './hooks'

interface TaskStore {
  tasks: Record<string, TaskEvent>
  set: (e: TaskEvent) => void
}

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: {},
  set: (e) =>
    set((s) => {
      const next = { ...s.tasks, [e.id]: e }
      if (e.state !== 'running') {
        setTimeout(() => {
          useTaskStore.setState((st) => {
            if (st.tasks[e.id]?.state === 'running') return st
            const copy = { ...st.tasks }
            delete copy[e.id]
            return { tasks: copy }
          })
        }, 6000)
      }
      return { tasks: next }
    })
}))

let subscribed = false
/** À appeler une fois (Layout) : synchronise les tâches du processus principal. */
export function useTaskSync(): void {
  useEffect(() => {
    if (subscribed) return
    subscribed = true
    void api.tasks.list().then((list) => list.forEach((t) => useTaskStore.getState().set(t)))
    const off = api.tasks.onEvent((e) => useTaskStore.getState().set(e))
    return () => {
      off()
      subscribed = false
    }
  }, [])
}

export function useTask(id: string): TaskEvent | undefined {
  return useTaskStore((s) => s.tasks[id])
}

/** Exécute une fonction quand une tâche se termine (pour recharger les données). */
export function useOnTaskDone(prefix: string, fn: () => void): void {
  useEffect(() => {
    return useTaskStore.subscribe((s, prev) => {
      for (const [id, t] of Object.entries(s.tasks)) {
        if (id.startsWith(prefix) && t.state !== 'running' && prev.tasks[id]?.state === 'running') fn()
      }
    })
  }, [prefix, fn])
}

export function formatBytes(n?: number): string {
  if (!n || n <= 0) return '0 o'
  const u = ['o', 'Ko', 'Mo', 'Go', 'To']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1).replace('.', ',')} ${u[i]}`
}

export function formatEta(t: TaskEvent): string | null {
  if (!t.total || !t.received || !t.speed || t.speed <= 0) return null
  const s = (t.total - t.received) / t.speed
  if (!Number.isFinite(s)) return null
  if (s < 60) return `${Math.ceil(s)} s`
  if (s < 3600) return `${Math.ceil(s / 60)} min`
  return `${(s / 3600).toFixed(1).replace('.', ',')} h`
}
