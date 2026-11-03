import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { create } from 'zustand'

type Tone = 'success' | 'error' | 'info'
interface Toast {
  id: number
  tone: Tone
  message: string
}

const useToasts = create<{ items: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }>((set) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random()
    set((s) => ({ items: [...s.items, { ...t, id }] }))
    setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), 4500)
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
}))

export const toast = {
  success: (message: string) => useToasts.getState().push({ tone: 'success', message }),
  error: (message: string) => useToasts.getState().push({ tone: 'error', message }),
  info: (message: string) => useToasts.getState().push({ tone: 'info', message })
}

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info }
const COLORS = { success: 'text-accent', error: 'text-danger', info: 'text-cloud' }

export function Toaster() {
  const { items, dismiss } = useToasts()
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-50 flex w-[360px] flex-col gap-2">
      <AnimatePresence initial={false}>
        {items.map((t) => {
          const Icon = ICONS[t.tone]
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line-strong bg-surface-2/95 px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur"
            >
              <Icon className={`mt-0.5 size-4 shrink-0 ${COLORS[t.tone]}`} strokeWidth={2} />
              <p className="flex-1 text-[13px] leading-snug">{t.message}</p>
              <button onClick={() => dismiss(t.id)} className="text-fg-subtle hover:text-fg" aria-label="Fermer">
                <X className="size-3.5" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
