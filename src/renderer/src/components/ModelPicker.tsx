import { Check, ChevronDown, Cloud, HardDrive, Search, Wrench } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { refFromString, refToString } from '@shared/providers'
import { api, useAsync } from '../lib/hooks'
import { Badge, cn, inputClass } from './ui'

export interface ModelOption {
  ref: string
  label: string
  location: 'local' | 'cloud'
  providerLabel: string
  tools: boolean | null
  vision: boolean | null
  badge?: string
}

/** Liste des modèles réellement utilisables : locaux installés + Cloud configurés. */
export function useModelOptions() {
  return useAsync(async () => {
    const out: { group: string; location: 'local' | 'cloud'; badge?: string; error?: string; models: ModelOption[] }[] = []
    const engine = await api.engine.status()
    if (engine.installed || engine.running) {
      const r = await api.models.installed()
      const models: ModelOption[] = []
      if (r.ok) {
        const caps = await Promise.all(r.value.map((m) => api.models.capabilities(m.name)))
        r.value.forEach((m, i) => {
          const c = caps[i]
          models.push({
            ref: refToString({ location: 'local', provider: 'ollama', model: m.name }),
            label: m.name,
            location: 'local',
            providerLabel: 'Sur ce PC',
            tools: c?.ok ? c.value.tools : null,
            vision: c?.ok ? c.value.vision : null
          })
        })
      }
      out.push({ group: 'Local · sur ce PC', location: 'local', models, error: r.ok ? undefined : r.error })
    }
    const providers = (await api.cloud.providers()).filter((p) => p.enabled && p.configured && (p.config.badge === 'free' || p.config.badge === 'free-nokey' || p.configured))
    const results = await Promise.all(providers.map((p) => api.cloud.models(p.config.id)))
    providers.forEach((p, i) => {
      const r = results[i]!
      out.push({
        group: p.config.label,
        location: 'cloud',
        badge: p.config.badge,
        error: r.ok ? undefined : r.error,
        models: r.ok
          ? r.value.map((m) => ({
              ref: refToString({ location: 'cloud', provider: p.config.id, model: m.id }),
              label: m.label === m.id ? m.id : `${m.label}`,
              location: 'cloud' as const,
              providerLabel: p.config.label,
              tools: m.tools,
              vision: m.vision,
              badge: p.config.badge
            }))
          : []
      })
    })
    return out
  })
}

export function describeRef(ref: string | undefined): { label: string; location: 'local' | 'cloud' | null; provider: string } {
  const r = ref ? refFromString(ref) : null
  if (!r) return { label: 'Choisir un modèle', location: null, provider: '' }
  return { label: r.model, location: r.location, provider: r.provider }
}

export function ModelPicker({ value, onChange, requireTools }: { value?: string; onChange: (ref: string) => void; requireTools?: boolean }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const options = useModelOptions()
  const ref = useRef<HTMLDivElement>(null)
  const cur = describeRef(value)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const groups = useMemo(
    () =>
      (options.data ?? []).map((g) => ({
        ...g,
        models: g.models.filter((m) => m.label.toLowerCase().includes(q.toLowerCase()) || m.ref.toLowerCase().includes(q.toLowerCase()))
      })),
    [options.data, q]
  )

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen((o) => !o)
          if (!open) void options.reload()
        }}
        className="flex h-9 max-w-[340px] items-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-3 text-[13px] hover:bg-surface-3"
      >
        {cur.location === 'local' ? <HardDrive className="size-4 text-local" /> : cur.location === 'cloud' ? <Cloud className="size-4 text-cloud" /> : null}
        <span className="truncate font-medium">{cur.label}</span>
        {cur.location && <Badge tone={cur.location === 'local' ? 'local' : 'cloud'}>{cur.location === 'local' ? 'Local' : 'Cloud'}</Badge>}
        <ChevronDown className="size-4 shrink-0 text-fg-subtle" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-11 left-0 z-50 w-[420px] overflow-hidden rounded-xl border border-line-strong bg-surface-2 shadow-2xl shadow-black/50"
          >
            <div className="border-b border-line p-2">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
                <input autoFocus className={`${inputClass} pl-9`} placeholder="Rechercher un modèle…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            <div className="max-h-[420px] overflow-y-auto p-1.5">
              {options.loading && !options.data && <div className="p-4 text-[12.5px] text-fg-muted">Chargement des modèles…</div>}
              {options.data && options.data.length === 0 && (
                <div className="p-4 text-[12.5px] text-fg-muted">
                  Aucun modèle disponible. Installe un modèle local depuis la Bibliothèque, ou configure un fournisseur Cloud dans Paramètres &gt; IA.
                </div>
              )}
              {groups.map((g) => (
                <div key={g.group} className="mb-1">
                  <div className="flex items-center gap-2 px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
                    {g.location === 'local' ? <HardDrive className="size-3" /> : <Cloud className="size-3" />}
                    {g.group}
                    {g.badge === 'free-nokey' && <Badge tone="accent">Sans clé</Badge>}
                  </div>
                  {g.error && <div className="px-2.5 py-1 text-[11.5px] text-danger">{g.error}</div>}
                  {!g.error && g.models.length === 0 && <div className="px-2.5 py-1 text-[11.5px] text-fg-subtle">Aucun modèle.</div>}
                  {g.models.map((m) => {
                    const disabled = requireTools && m.tools === false
                    return (
                      <button
                        key={m.ref}
                        disabled={disabled}
                        onClick={() => {
                          onChange(m.ref)
                          setOpen(false)
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40',
                          m.ref === value && 'bg-surface-3'
                        )}
                        title={disabled ? 'Ce modèle ne sait pas utiliser d’outils (mode Agent impossible).' : undefined}
                      >
                        <span className="flex-1 truncate">{m.label}</span>
                        {m.tools === true && <Wrench className="size-3.5 text-fg-subtle" aria-label="Outils" />}
                        {m.tools === null && m.location === 'cloud' && <span className="text-[10.5px] text-fg-subtle">outils ?</span>}
                        {m.ref === value && <Check className="size-4 text-accent" />}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
