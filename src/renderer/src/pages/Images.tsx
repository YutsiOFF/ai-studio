import { Box, Dice5, Download, FolderOpen, ImagePlus, Loader2, Sparkles, Square, Trash2, Wand2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ImageEntry } from '@shared/catalog'
import type { GenerationRecord } from '@shared/ipc'
import { assessImage, recommendImage } from '@shared/recommender'
import { TaskProgress } from '../components/Tasks'
import { Badge, Button, Field, cn, formatMB, inputClass } from '../components/ui'
import { api, useAsync } from '../lib/hooks'
import { useOnTaskDone, useTaskStore } from '../lib/tasks'
import { toast } from '../lib/toast'
import { FIT_LABEL } from './Library'

const SIZES = [
  { label: 'Carré', w: 1, h: 1 },
  { label: 'Portrait', w: 3, h: 4 },
  { label: 'Paysage', w: 4, h: 3 },
  { label: 'Large', w: 16, h: 9 }
]

function dims(base: number, ratio: { w: number; h: number }): { width: number; height: number } {
  const area = base * base
  const w = Math.sqrt((area * ratio.w) / ratio.h)
  const h = area / w
  const r8 = (x: number) => Math.max(256, Math.round(x / 64) * 64)
  return { width: r8(w), height: r8(h) }
}

export function ImagesPage() {
  const navigate = useNavigate()
  const catalog = useAsync(() => api.models.catalog())
  const hw = useAsync(() => api.hardware.get())
  const status = useAsync(() => api.images.status())
  const gallery = useAsync(() => api.images.list())
  const tasks = useTaskStore((s) => s.tasks)
  const [modelId, setModelId] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [ratio, setRatio] = useState(0)
  const [steps, setSteps] = useState(8)
  const [cfg, setCfg] = useState(1)
  const [seed, setSeed] = useState(-1)
  const [count, setCount] = useState(1)
  const [initImage, setInitImage] = useState<string | null>(null)
  const [strength, setStrength] = useState(0.6)
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState<GenerationRecord | null>(null)
  const [viewIndex, setViewIndex] = useState(0)

  const reload = useCallback(() => {
    void status.reload()
  }, [status.reload])
  useOnTaskDone('image-model:', reload)
  useOnTaskDone('engine:sdcpp', reload)

  const model: ImageEntry | undefined = catalog.data?.image.find((m) => m.id === modelId)
  useEffect(() => {
    if (!catalog.data || !hw.data || modelId) return
    const installedFirst = catalog.data.image.find((m) => status.data?.installed.includes(m.id))
    setModelId(installedFirst?.id ?? recommendImage(catalog.data, hw.data) ?? catalog.data.image[0]!.id)
  }, [catalog.data, hw.data, status.data, modelId])
  useEffect(() => {
    if (model) {
      setSteps(model.defaults.steps)
      setCfg(model.defaults.cfg)
    }
  }, [model])

  const base = model?.defaults.width ?? 1024
  const size = dims(base, SIZES[ratio]!)
  const installed = model ? (status.data?.installed.includes(model.id) ?? false) : false
  const runningTask = Object.values(tasks).find((t) => t.kind === 'image' && t.state === 'running')
  const installTask = model ? (tasks[`image-model:${model.id}`] ?? tasks['engine:sdcpp']) : undefined

  const install = async () => {
    if (!model) return
    if (!status.data?.engineInstalled) {
      const r = await api.images.installEngine()
      if (!r.ok) return toast.error(r.error)
    }
    const r = await api.images.installModel(model.id)
    if (!r.ok) toast.error(r.error)
    reload()
  }

  const generate = async () => {
    if (!model || !prompt.trim()) return
    setBusy(true)
    const r = await api.images.generate({
      modelId: model.id,
      prompt,
      negative: negative || undefined,
      width: size.width,
      height: size.height,
      steps,
      cfg,
      seed,
      count,
      sampler: model.defaults.sampler,
      initImage: initImage ?? undefined,
      strength: initImage ? strength : undefined
    })
    setBusy(false)
    if (!r.ok) return toast.error(r.error)
    setCurrent(r.value)
    setViewIndex(0)
    void gallery.reload()
  }

  const shown = current ?? gallery.data?.[0] ?? null
  const fit = useMemo(() => (model && hw.data ? assessImage(model, hw.data) : null), [model, hw.data])

  return (
    <div className="flex h-full">
      {/* Paramètres */}
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-line">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <Field label="Modèle">
            <select className={inputClass} value={modelId} onChange={(e) => setModelId(e.target.value)}>
              {catalog.data?.image.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {status.data?.installed.includes(m.id) ? ' · installé' : ''}
                </option>
              ))}
            </select>
          </Field>
          {model && fit && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-muted">
              <Badge tone="local">Local</Badge>
              <Badge tone={FIT_LABEL[fit.fit].tone}>{FIT_LABEL[fit.fit].label}</Badge>
              <span className={model.commercial ? '' : 'text-warn'}>{model.license}</span>
            </div>
          )}

          {model && !installed ? (
            <div className="rounded-xl border border-line-strong bg-surface p-4">
              <div className="text-[13px] font-medium">{model.name} n’est pas installé</div>
              <p className="mt-1 text-[12.5px] text-fg-muted">
                Téléchargement : {formatMB(model.files.reduce((s, f) => s + f.sizeMB, 0))}
                {!status.data?.engineInstalled ? ' + moteur stable-diffusion.cpp' : ''}. Depuis Hugging Face, sans compte.
              </p>
              {installTask?.state === 'running' ? (
                <div className="mt-3">
                  <TaskProgress task={installTask} compact />
                </div>
              ) : (
                <Button className="mt-3 w-full" variant="primary" icon={Download} onClick={install}>
                  Installer
                </Button>
              )}
            </div>
          ) : (
            <>
              <Field label="Description de l’image">
                <textarea className={`${inputClass} h-28 resize-none py-2`} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Un renard en origami dans une forêt brumeuse, lumière du matin…" />
              </Field>
              <Field label="À éviter" hint="Facultatif">
                <input className={inputClass} value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="flou, texte, filigrane" />
              </Field>
              <Field label="Format">
                <div className="grid grid-cols-4 gap-1.5">
                  {SIZES.map((s, i) => (
                    <button
                      key={s.label}
                      onClick={() => setRatio(i)}
                      className={cn('rounded-lg border py-1.5 text-[11.5px]', ratio === i ? 'border-accent/50 bg-accent-soft text-accent' : 'border-line-strong text-fg-muted hover:text-fg')}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <div className="mt-1 font-mono text-[11px] text-fg-subtle">
                  {size.width} × {size.height}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Étapes : ${steps}`}>
                  <input type="range" min={1} max={60} value={steps} onChange={(e) => setSteps(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
                </Field>
                <Field label={`Guidage : ${cfg}`}>
                  <input type="range" min={0} max={15} step={0.5} value={cfg} onChange={(e) => setCfg(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Variantes">
                  <select className={inputClass} value={count} onChange={(e) => setCount(Number(e.target.value))}>
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Graine">
                  <div className="flex gap-1">
                    <input className={`${inputClass} font-mono`} value={seed} onChange={(e) => setSeed(Number(e.target.value) || -1)} />
                    <button className="rounded-lg border border-line-strong px-2 text-fg-muted hover:text-fg" title="Aléatoire" onClick={() => setSeed(-1)}>
                      <Dice5 className="size-4" />
                    </button>
                  </div>
                </Field>
              </div>
              {model?.img2img && (
                <Field label="Image de référence" hint="Facultatif : transforme une image existante.">
                  {initImage ? (
                    <div className="space-y-2">
                      <div className="relative">
                        <img src={api.app.mediaUrl(initImage)} className="h-28 w-full rounded-lg object-cover" alt="" />
                        <button className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1" onClick={() => setInitImage(null)} aria-label="Retirer">
                          <X className="size-3.5" />
                        </button>
                      </div>
                      <Field label={`Force de transformation : ${strength}`}>
                        <input type="range" min={0.1} max={1} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
                      </Field>
                    </div>
                  ) : (
                    <Button className="w-full" icon={ImagePlus} onClick={async () => setInitImage(await api.images.pickInput())}>
                      Choisir une image
                    </Button>
                  )}
                </Field>
              )}
            </>
          )}
        </div>
        {installed && (
          <div className="border-t border-line p-4">
            {runningTask ? (
              <div className="space-y-3">
                <TaskProgress task={runningTask} compact />
                <Button className="w-full" variant="danger" icon={Square} onClick={() => api.images.cancel()}>
                  Arrêter
                </Button>
              </div>
            ) : (
              <Button className="h-10 w-full" variant="primary" icon={Wand2} loading={busy} disabled={!prompt.trim()} onClick={generate}>
                Générer
              </Button>
            )}
          </div>
        )}
      </aside>

      {/* Aperçu */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,_#15171c_0%,_#0c0d10_70%)] p-8">
          <AnimatePresence mode="wait">
            {runningTask ? (
              <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
                <div className="mx-auto grid size-16 place-items-center rounded-2xl border border-line-strong bg-surface-2">
                  <Loader2 className="size-7 animate-spin text-accent" />
                </div>
                <div className="mt-4 text-[14px] font-medium">{runningTask.stage}</div>
                {runningTask.of ? (
                  <div className="mt-1 font-mono text-[12px] text-fg-muted">
                    Étape {runningTask.current} / {runningTask.of}
                  </div>
                ) : null}
              </motion.div>
            ) : shown && shown.files[viewIndex] ? (
              <motion.img
                key={shown.files[viewIndex]}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                src={api.app.mediaUrl(shown.files[viewIndex]!)}
                className="max-h-full max-w-full rounded-xl object-contain shadow-2xl shadow-black/60"
                alt={shown.prompt}
              />
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
                <Sparkles className="mx-auto size-8 text-fg-subtle" />
                <p className="mt-3 text-[13px] text-fg-muted">Tes images apparaîtront ici.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {shown && !runningTask && (
          <div className="flex items-center gap-3 border-t border-line px-5 py-3">
            <p className="min-w-0 flex-1 truncate text-[12.5px] text-fg-muted" title={shown.prompt}>
              {shown.prompt}
            </p>
            {shown.files.length > 1 &&
              shown.files.map((f, i) => (
                <button key={f} onClick={() => setViewIndex(i)} className={cn('size-9 overflow-hidden rounded-md border', i === viewIndex ? 'border-accent' : 'border-line-strong')}>
                  <img src={api.app.mediaUrl(f)} className="size-full object-cover" alt="" />
                </button>
              ))}
            <Button variant="ghost" icon={FolderOpen} onClick={() => api.app.showInFolder(shown.files[viewIndex]!)}>
              Ouvrir
            </Button>
            <Button
              variant="ghost"
              icon={Box}
              onClick={() => {
                try {
                  sessionStorage.setItem('aistudio.to3d', shown.files[viewIndex]!)
                } catch {
                  /* indisponible */
                }
                navigate('/3d')
              }}
            >
              Vers la 3D
            </Button>
          </div>
        )}
        {/* Historique */}
        <div className="h-[116px] shrink-0 overflow-x-auto border-t border-line">
          <div className="flex h-full items-center gap-2 px-4">
            {gallery.data?.length === 0 && <span className="text-[12px] text-fg-subtle">Historique vide.</span>}
            {gallery.data?.flatMap((g) =>
              g.files.map((f, i) => (
                <div key={f} className="group relative shrink-0">
                  <button
                    onClick={() => {
                      setCurrent(g)
                      setViewIndex(i)
                    }}
                    className={cn('block size-[84px] overflow-hidden rounded-lg border', shown?.files[viewIndex] === f ? 'border-accent' : 'border-line')}
                  >
                    <img src={api.app.mediaUrl(f)} className="size-full object-cover transition-transform group-hover:scale-105" alt="" loading="lazy" />
                  </button>
                  {i === 0 && (
                    <button
                      className="absolute top-1 right-1 rounded-md bg-black/70 p-1 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Supprimer"
                      onClick={async () => {
                        await api.images.remove(g.id)
                        if (current?.id === g.id) setCurrent(null)
                        void gallery.reload()
                      }}
                    >
                      <Trash2 className="size-3 text-danger" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
