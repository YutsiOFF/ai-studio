import { OrbitControls } from '@react-three/drei'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import {
  Box,
  Cloud,
  Download,
  Eye,
  EyeOff,
  FileUp,
  Grid3x3,
  ImagePlus,
  Layers,
  Loader2,
  MousePointerClick,
  Palette,
  Scissors,
  Sparkles,
  Sun,
  Trash2,
  Wand2
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GenerationRecord, Mesh3DJob } from '@shared/ipc'
import { MESH_ENGINES, type MeshQuality } from '@shared/mesh-engines'
import type * as THREE from 'three'
import { ParticleForge, type ForgePhase } from '../components/ParticleForge'
import { ErrorBoundary, webglAvailable } from '../components/ErrorBoundary'
import { Modal } from '../components/Modal'
import { TaskProgress } from '../components/Tasks'
import { Badge, Button, Field, Toggle, cn, inputClass } from '../components/ui'
import { api, useAsync } from '../lib/hooks'
import { SceneModel, type TextureInfo } from '../lib/scene3d'
import { useTaskStore } from '../lib/tasks'
import { toast } from '../lib/toast'

function extOf(p: string): string {
  const m = /\.[a-z0-9]+$/i.exec(p)
  return m ? m[0].toLowerCase() : ''
}
function meshFile(g: GenerationRecord): string | undefined {
  return g.files.find((f) => /\.(glb|gltf|obj|stl|ply)$/i.test(f))
}
function previewFile(g: GenerationRecord): string | undefined {
  return g.files.find((f) => /\.(png|jpe?g|webp)$/i.test(f))
}

export function ThreeDPage() {
  const [source, setSource] = useState<string | null>(() => {
    try {
      const s = sessionStorage.getItem('aistudio.to3d')
      sessionStorage.removeItem('aistudio.to3d')
      return s
    } catch {
      return null
    }
  })
  const [textPrompt, setTextPrompt] = useState('')
  const [seed, setSeed] = useState(0)
  const [engineId, setEngineId] = useState<Mesh3DJob['engine']>(() => {
    try {
      return (localStorage.getItem('aistudio.mesh-engine') as Mesh3DJob['engine']) || 'trellis'
    } catch {
      return 'trellis'
    }
  })
  const [quality, setQuality] = useState<MeshQuality>('balanced')
  const [textured, setTextured] = useState(true)
  const [numParts, setNumParts] = useState(4)
  const [texSize, setTexSize] = useState(1024)
  const [forge, setForge] = useState<{ imageUrl: string; phase: ForgePhase; target: THREE.Object3D | null } | null>(null)
  const settings = useAsync(() => api.settings.get())
  const [licenseFor, setLicenseFor] = useState<(typeof MESH_ENGINES)[number] | null>(null)
  const allowRestricted = settings.data?.allowRestrictedLicenses ?? false
  const engine = MESH_ENGINES.find((e) => e.id === engineId && (!e.restricted || allowRestricted)) ?? MESH_ENGINES[0]!
  const [busy, setBusy] = useState(false)
  const [textBusy, setTextBusy] = useState(false)
  const space = useAsync(() => api.mesh.spaceStatus())
  const library = useAsync(() => api.mesh.list())
  const imageStatus = useAsync(() => api.images.status())
  const hw = useAsync(() => api.hardware.get())
  const tasks = useTaskStore((s) => s.tasks)
  const meshTask = Object.values(tasks).find((t) => t.kind === 'mesh3d' && t.state === 'running')
  const imageTask = Object.values(tasks).find((t) => t.kind === 'image' && t.state === 'running')

  const [current, setCurrent] = useState<GenerationRecord | null>(null)
  const [model, setModel] = useState<SceneModel | null>(null)
  const [loading, setLoading] = useState(false)
  const [, force] = useState(0)
  const refresh = () => force((n) => n + 1)

  // Affichage
  const [wire, setWire] = useState(false)
  const [colors, setColors] = useState(false)
  const [light, setLight] = useState(1.6)
  const [lightAngle, setLightAngle] = useState(45)
  const [selectMode, setSelectMode] = useState(false)
  const [angle, setAngle] = useState(35)
  const [textures, setTextures] = useState<TextureInfo[] | null>(null)
  const [zoomTex, setZoomTex] = useState<TextureInfo | null>(null)

  const open = useCallback(async (g: GenerationRecord) => {
    const f = meshFile(g)
    if (!f) return toast.error('Aucun fichier 3D dans cette génération.')
    setLoading(true)
    setCurrent(g)
    try {
      const m = await SceneModel.load(api.app.mediaUrl(f), extOf(f))
      setModel((old) => {
        old?.dispose()
        return m
      })
      setTextures(null)
      setColors(false)
      setWire(false)
    } catch (e) {
      toast.error(`Chargement impossible : ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!current && !forge && library.data?.[0]) void open(library.data[0])
  }, [library.data, current, open, forge])
  // Phase visuelle des particules, d'après l'étape réelle remontée par le moteur.
  useEffect(() => {
    if (!forge || !meshTask?.stage || (forge.phase !== 'analyzing' && forge.phase !== 'generating')) return
    const analyzing = /connexion|fond|isolation|recadrage|session/i.test(meshTask.stage)
    const next: ForgePhase = analyzing ? 'analyzing' : 'generating'
    if (next !== forge.phase) setForge({ ...forge, phase: next })
  }, [meshTask?.stage, forge])
  useEffect(() => {
    model?.setWireframe(wire)
  }, [model, wire])
  useEffect(() => {
    model?.setColorMode(colors)
  }, [model, colors])

  const generate = async () => {
    if (!source) return
    setBusy(true)
    setModel((old) => {
      old?.dispose()
      return null
    })
    setCurrent(null)
    setForge({ imageUrl: api.app.mediaUrl(source), phase: 'analyzing', target: null })
    const r = await api.mesh.generate({ engine: engine.id as Mesh3DJob['engine'], imagePath: source, seed, quality, textured, numParts, textureSize: texSize, prompt: textPrompt || undefined })
    setBusy(false)
    if (!r.ok) {
      setForge(null)
      return toast.error(r.error)
    }
    void library.reload()
    const f = meshFile(r.value)
    if (!f) {
      setForge(null)
      return toast.error('Aucun fichier 3D reçu.')
    }
    try {
      const m = await SceneModel.load(api.app.mediaUrl(f), extOf(f))
      m.root.visible = false
      setCurrent(r.value)
      setModel(m)
      setTextures(null)
      setColors(engine.output === 'parts' && m.parts.length > 1)
      setForge((cur) => (cur ? { ...cur, phase: 'forming', target: m.root } : null))
    } catch (e) {
      setForge(null)
      toast.error(`Chargement impossible : ${(e as Error).message}`)
    }
  }

  const textToImage = async () => {
    const st = imageStatus.data
    const modelId = st?.installed[0]
    if (!modelId) return toast.info('Installe d’abord un modèle d’image (page Génération d’images).')
    const cat = await api.models.catalog()
    const m = cat.image.find((x) => x.id === modelId)!
    setTextBusy(true)
    const r = await api.images.generate({
      modelId,
      prompt: `${textPrompt}, objet isolé et centré, fond blanc uni, vue de trois quarts, éclairage studio doux, haute définition`,
      negative: 'plusieurs objets, texte, ombre portée, arrière-plan chargé',
      width: Math.min(m.defaults.width, 1024),
      height: Math.min(m.defaults.height, 1024),
      steps: m.defaults.steps,
      cfg: m.defaults.cfg,
      seed: -1,
      count: 1,
      sampler: m.defaults.sampler
    })
    setTextBusy(false)
    if (!r.ok) return toast.error(r.error)
    setSource(r.value.files[0] ?? null)
    toast.info('Image de référence créée : vérifie-la puis lance la génération 3D.')
  }

  const doExport = async (format: 'glb' | 'obj' | 'stl', ids: number[] | 'visible', name: string) => {
    if (!model) return
    try {
      const data = await model.export(format, ids)
      const path = await api.mesh.saveExport(`${name}.${format}`, data)
      if (path) toast.success(`Exporté : ${path}`)
    } catch (e) {
      toast.error(`Export impossible : ${(e as Error).message}`)
    }
  }

  const onPick = (e: ThreeEvent<MouseEvent>) => {
    if (!model || !selectMode || e.delta > 4 || e.faceIndex == null) return
    e.stopPropagation()
    const p = model.extractRegion(e.object, e.faceIndex, angle)
    if (!p) toast.info('Toute la partie a été sélectionnée : réduis l’angle pour une sélection plus fine.')
    else {
      setColors(true)
      model.setColorMode(true)
      toast.success(`${p.name} créée (${p.tris.length} triangles).`)
    }
    refresh()
  }

  const local3D = hw.data?.assessment.local3D

  return (
    <div className="flex h-full">
      {/* Génération */}
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-line">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold tracking-wide text-fg-subtle uppercase">Moteur 3D</span>
              <Badge tone="cloud">Gratuit · sans clé</Badge>
            </div>
            <div className="mt-2 space-y-1.5">
              {MESH_ENGINES.map((e) => {
                const st = space.data?.find((x) => x.engine === e.id)
                const on = e.id === engine.id
                return (
                  <button
                    key={e.id}
                    onClick={() => {
                      if (e.restricted && !allowRestricted) {
                        setLicenseFor(e)
                        return
                      }
                      setEngineId(e.id as Mesh3DJob['engine'])
                      try {
                        localStorage.setItem('aistudio.mesh-engine', e.id)
                      } catch {
                        /* indisponible */
                      }
                    }}
                    className={cn('w-full rounded-xl border px-3 py-2.5 text-left transition-colors', on ? 'border-accent/50 bg-accent/[0.06]' : 'border-line bg-surface hover:border-line-strong')}
                  >
                    <div className="flex items-center gap-2">
                      <Cloud className={cn('size-3.5', on ? 'text-accent' : 'text-cloud')} />
                      <span className="text-[13px] font-medium whitespace-nowrap">{e.label}</span>
                      <span className="truncate text-[11px] text-fg-subtle">{e.publisher}</span>
                      <span className="flex-1" />
                      {e.restricted && <Badge tone="warn">{allowRestricted ? 'Licence UE' : 'Verrouillé'}</Badge>}
                      <span
                        className={cn('size-2 shrink-0 rounded-full', st === undefined ? 'bg-fg-subtle' : st.available ? 'bg-accent' : 'bg-danger')}
                        title={st === undefined ? 'Vérification…' : st.available ? `Disponible${st.stage === 'SLEEPING' ? ' (en veille, démarrage ~1 min)' : ''}` : `Indisponible : ${st.error ?? st.stage}`}
                      />
                    </div>
                    {on && (
                      <p className="mt-1 text-[11.5px] leading-snug text-fg-muted">
                        {e.description} <span className="text-fg-subtle">Licence {e.license} · {e.gpuSeconds} de GPU.</span>
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-fg-subtle">
              Quota GPU gratuit commun : ~2 min/jour sans compte, 5 min avec un jeton Hugging Face gratuit (Paramètres &gt; IA). 3D 100 % locale : pas encore disponible.
            </p>
          </div>

          <Field label="Image de départ">
            {source ? (
              <div className="relative overflow-hidden rounded-xl border border-line-strong bg-[repeating-conic-gradient(#1a1d23_0%_25%,#14161b_0%_50%)] bg-[length:16px_16px]">
                <img src={api.app.mediaUrl(source)} className="h-44 w-full object-contain" alt="" />
                <button className="absolute top-2 right-2 rounded-md bg-black/60 px-2 py-1 text-[11px]" onClick={() => setSource(null)}>
                  Changer
                </button>
              </div>
            ) : (
              <Button className="w-full" icon={ImagePlus} onClick={async () => setSource(await api.images.pickInput())}>
                Importer une image
              </Button>
            )}
          </Field>

          <Field label="Ou décrire l’objet (texte → image → 3D)">
            <textarea className={`${inputClass} h-20 resize-none py-2`} value={textPrompt} onChange={(e) => setTextPrompt(e.target.value)} placeholder="Une épée fantastique avec une garde dorée" />
            <Button className="mt-2 w-full" icon={Sparkles} loading={textBusy || Boolean(imageTask)} disabled={!textPrompt.trim()} onClick={textToImage}>
              Créer l’image de référence
            </Button>
            {imageTask && (
              <div className="mt-2">
                <TaskProgress task={imageTask} compact />
              </div>
            )}
          </Field>

          <Field label="Qualité">
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ['fast', 'Rapide'],
                  ['balanced', 'Équilibrée'],
                  ['high', 'Maximale']
                ] as const
              ).map(([q, l]) => (
                <button
                  key={q}
                  onClick={() => setQuality(q)}
                  className={cn('rounded-lg border py-1.5 text-[12px]', quality === q ? 'border-accent/50 bg-accent-soft text-accent' : 'border-line-strong text-fg-muted hover:text-fg')}
                >
                  {l}
                </button>
              ))}
            </div>
            <span className="mt-1 block text-[11px] text-fg-subtle">Plus la qualité est haute, plus la génération consomme de quota GPU.</span>
          </Field>
          {engine.options.parts && (
            <Field label={`Nombre de parties : ${numParts}`}>
              <input type="range" min={2} max={16} value={numParts} onChange={(e) => setNumParts(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
            </Field>
          )}
          {engine.options.texture && (
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] text-fg-muted">Générer la texture</span>
              <Toggle label="Texture" checked={textured} onChange={setTextured} />
            </div>
          )}
          <details className="group rounded-xl border border-line bg-surface">
            <summary className="cursor-pointer px-3 py-2.5 text-[12.5px] font-medium text-fg-muted">Paramètres avancés</summary>
            <div className="space-y-3 border-t border-line p-3">
              {engine.options.textureSize && (
                <Field label="Taille des textures">
                  <select className={inputClass} value={texSize} onChange={(e) => setTexSize(Number(e.target.value))}>
                    {(engineId === 'trellis2' ? [1024, 2048, 4096] : [512, 1024, 2048]).map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Graine">
                <input className={`${inputClass} font-mono`} value={seed} onChange={(e) => setSeed(Math.max(0, Number(e.target.value) || 0))} />
              </Field>
            </div>
          </details>
        </div>
        <div className="border-t border-line p-4">
          {meshTask ? (
            <div className="space-y-3">
              <TaskProgress task={meshTask} compact />
              <Button className="w-full" variant="danger" onClick={() => api.tasks.cancel(meshTask.id)}>
                Annuler
              </Button>
            </div>
          ) : (
            <Button className="h-10 w-full" variant="primary" icon={Wand2} loading={busy} disabled={!source || space.data?.find((x) => x.engine === engineId)?.available === false} onClick={generate}>
              Générer le modèle 3D
            </Button>
          )}
        </div>
      </aside>

      {/* Visualiseur */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex-1 bg-[radial-gradient(ellipse_at_center,_#181b21_0%,_#0c0d10_75%)]">
          {(model || forge) && !webglAvailable() ? (
            <div className="grid h-full place-items-center p-8 text-center">
              <div className="max-w-sm">
                <Box className="mx-auto size-8 text-warn" />
                <p className="mt-3 text-[13px] font-medium">Affichage 3D indisponible</p>
                <p className="mt-1 text-[12.5px] text-fg-muted">WebGL n’a pas pu démarrer sur ce PC. Mets à jour le pilote de ta carte graphique puis redémarre AI Studio. Les exports restent possibles.</p>
              </div>
            </div>
          ) : model || forge ? (
            <ErrorBoundary resetKey={current?.id}>
            <Canvas camera={{ position: [2.6, 1.6, 2.6], fov: 40, near: 0.01, far: 100 }} gl={{ antialias: true, preserveDrawingBuffer: true }} dpr={[1, 2]}>
              <ambientLight intensity={0.35} />
              <hemisphereLight args={['#dfe7ff', '#1a1c22', 0.6 * light]} />
              <directionalLight position={[Math.cos((lightAngle * Math.PI) / 180) * 4, 4, Math.sin((lightAngle * Math.PI) / 180) * 4]} intensity={light} />
              <directionalLight position={[-3, 1.5, -3]} intensity={0.35 * light} color="#9fb8ff" />
              {model && <primitive object={model.root} onClick={onPick} />}
              {forge && (
                <ParticleForge
                  imageUrl={forge.imageUrl}
                  phase={forge.phase}
                  target={forge.target}
                  onFormed={() => {
                    if (model) model.root.visible = true
                    setForge((cur) => (cur ? { ...cur, phase: 'fading' } : null))
                  }}
                  onFaded={() => setForge(null)}
                />
              )}
              <gridHelper args={[6, 24, '#2e323c', '#1d2027']} position={[0, -1.01, 0]} />
              <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={0.5} maxDistance={12} autoRotate={Boolean(forge)} autoRotateSpeed={1.2} />
            </Canvas>
            </ErrorBoundary>
          ) : (
            <div className="grid h-full place-items-center text-center">
              {loading ? (
                <Loader2 className="size-8 animate-spin text-accent" />
              ) : (
                <div>
                  <Box className="mx-auto size-10 text-fg-subtle" strokeWidth={1.25} />
                  <p className="mt-3 text-[13px] text-fg-muted">Génère un modèle ou importe un fichier GLB, OBJ, STL ou PLY.</p>
                </div>
              )}
            </div>
          )}
          {forge && (
            <div className="pointer-events-none absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-line-strong bg-black/60 px-4 py-2 backdrop-blur">
              <Loader2 className="size-4 animate-spin text-accent" />
              <span className="shimmer-text text-[12.5px] font-medium">
                {forge.phase === 'forming' || forge.phase === 'fading' ? 'Assemblage du modèle' : (meshTask?.stage ?? 'Préparation')}
              </span>
            </div>
          )}
          {model && !forge && (
            <div className="pointer-events-none absolute top-3 left-3 rounded-lg bg-black/50 px-2.5 py-1.5 font-mono text-[11px] text-fg-muted backdrop-blur">
              {model.stats.triangles.toLocaleString('fr-FR')} triangles · {model.parts.length} partie(s)
            </div>
          )}
          {selectMode && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-accent/40 bg-black/60 px-3 py-1.5 text-[12px] text-accent backdrop-blur">
              Clique sur le modèle pour extraire une région (angle max {angle}°)
            </div>
          )}
        </div>
        {/* Bibliothèque */}
        <div className="flex h-[104px] shrink-0 items-center gap-2 overflow-x-auto border-t border-line px-4">
          <button
            onClick={async () => {
              const r = await api.mesh.import()
              if (!r) return
              if (!r.ok) return toast.error(r.error)
              await library.reload()
              void open(r.value)
            }}
            className="grid size-[76px] shrink-0 place-items-center rounded-lg border border-dashed border-line-strong text-fg-subtle hover:text-fg"
            title="Importer un modèle 3D"
          >
            <FileUp className="size-5" />
          </button>
          {library.data?.map((g) => {
            const prev = previewFile(g)
            return (
              <div key={g.id} className="group relative shrink-0">
                <button onClick={() => open(g)} className={cn('grid size-[76px] place-items-center overflow-hidden rounded-lg border bg-surface', current?.id === g.id ? 'border-accent' : 'border-line')}>
                  {prev ? <img src={api.app.mediaUrl(prev)} className="size-full object-cover" alt="" /> : <Box className="size-6 text-fg-subtle" />}
                </button>
                <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[9.5px] text-fg-muted">{g.location === 'cloud' ? 'Cloud' : g.engine === 'import' ? 'Import' : 'Local'}</span>
                <button
                  className="absolute top-1 right-1 rounded-md bg-black/70 p-1 opacity-0 group-hover:opacity-100"
                  aria-label="Supprimer"
                  onClick={async () => {
                    await api.mesh.remove(g.id)
                    if (current?.id === g.id) {
                      setCurrent(null)
                      setModel(null)
                    }
                    void library.reload()
                  }}
                >
                  <Trash2 className="size-3 text-danger" />
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* Outils */}
      <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-line">
        <Panel title="Affichage" icon={Sun}>
          <Row label="Filaire">
            <Toggle label="Filaire" checked={wire} onChange={setWire} disabled={!model} />
          </Row>
          <Row label="Couleurs par partie">
            <Toggle label="Couleurs" checked={colors} onChange={setColors} disabled={!model} />
          </Row>
          <Field label={`Intensité de la lumière : ${light.toFixed(1)}`}>
            <input type="range" min={0.2} max={4} step={0.1} value={light} onChange={(e) => setLight(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
          </Field>
          <Field label={`Direction de la lumière : ${lightAngle}°`}>
            <input type="range" min={0} max={360} value={lightAngle} onChange={(e) => setLightAngle(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
          </Field>
        </Panel>

        <Panel title="Segmentation" icon={Scissors}>
          <p className="text-[11.5px] text-fg-muted">Découpage géométrique réel. Les parties ne sont pas nommées automatiquement : renomme-les toi-même.</p>
          <Button
            className="w-full"
            icon={Layers}
            disabled={!model}
            onClick={() => {
              const n = model!.splitComponents()
              if (n === 0) toast.info('Le modèle est d’un seul bloc. Utilise la sélection par région pour le découper.')
              else {
                setColors(true)
                toast.success(`${n} pièce(s) séparée(s).`)
              }
              refresh()
            }}
          >
            Séparer les pièces disjointes
          </Button>
          <Button className="w-full" variant={selectMode ? 'primary' : 'secondary'} icon={MousePointerClick} disabled={!model} onClick={() => setSelectMode((s) => !s)}>
            {selectMode ? 'Terminer la sélection' : 'Sélection par région'}
          </Button>
          {selectMode && (
            <Field label={`Angle maximal entre faces : ${angle}°`}>
              <input type="range" min={5} max={90} value={angle} onChange={(e) => setAngle(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
            </Field>
          )}
        </Panel>

        <Panel title={`Parties${model ? ` (${model.parts.length})` : ''}`} icon={Grid3x3}>
          {!model && <p className="text-[12px] text-fg-subtle">Aucun modèle chargé.</p>}
          <ul className="space-y-1">
            {model?.parts.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: `#${p.color.getHexString()}` }} />
                <input
                  className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
                  defaultValue={p.name}
                  onBlur={(e) => {
                    model.rename(p.id, e.target.value)
                    refresh()
                  }}
                />
                <button
                  title={p.visible ? 'Masquer' : 'Afficher'}
                  onClick={() => {
                    model.setVisible(p.id, !p.visible)
                    refresh()
                  }}
                >
                  {p.visible ? <Eye className="size-3.5 text-fg-muted" /> : <EyeOff className="size-3.5 text-fg-subtle" />}
                </button>
                <button title="Exporter cette partie (GLB)" onClick={() => doExport('glb', [p.id], p.name)}>
                  <Download className="size-3.5 text-fg-muted hover:text-fg" />
                </button>
                <button
                  title="Supprimer cette partie"
                  onClick={() => {
                    model.remove(p.id)
                    refresh()
                  }}
                >
                  <Trash2 className="size-3.5 text-fg-subtle hover:text-danger" />
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Textures" icon={Palette}>
          <Button className="w-full" disabled={!model} onClick={() => setTextures(model!.textures())}>
            Afficher les textures
          </Button>
          {textures && textures.length === 0 && <p className="text-[12px] text-fg-subtle">Ce modèle n’a pas de texture.</p>}
          <div className="grid grid-cols-3 gap-2">
            {textures?.map((t, i) => (
              <button key={i} onClick={() => setZoomTex(t)} className="text-left">
                <img src={t.url} className="aspect-square w-full rounded-md border border-line object-cover" alt="" />
                <div className="mt-0.5 truncate text-[10.5px] text-fg-muted">{t.slot}</div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Exporter (parties visibles)" icon={Download}>
          <div className="grid grid-cols-3 gap-2">
            {(['glb', 'obj', 'stl'] as const).map((f) => (
              <Button key={f} disabled={!model} onClick={() => doExport(f, 'visible', `modele-${current?.id.slice(0, 8) ?? '3d'}`)}>
                {f.toUpperCase()}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-fg-subtle">GLB conserve les textures. FBX : nécessite Blender (non intégré pour l’instant).</p>
        </Panel>
      </aside>

      <Modal
        open={!!licenseFor}
        onOpenChange={(v) => !v && setLicenseFor(null)}
        title={`Activer ${licenseFor?.label ?? ''} ?`}
        description={licenseFor?.restricted}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLicenseFor(null)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                await api.settings.update({ allowRestrictedLicenses: true })
                await settings.reload()
                if (licenseFor) setEngineId(licenseFor.id as Mesh3DJob['engine'])
                setLicenseFor(null)
              }}
            >
              J’ai compris, activer
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-fg-muted">
          Licence : {licenseFor?.license}. Tu pourras désactiver ces moteurs à tout moment dans Paramètres &gt; Général.
        </p>
      </Modal>
      <Modal open={!!zoomTex} onOpenChange={(v) => !v && setZoomTex(null)} title={zoomTex ? `${zoomTex.slot} · ${zoomTex.material}` : ''} description={zoomTex ? `${zoomTex.width} × ${zoomTex.height}` : undefined} footer={<Button onClick={() => setZoomTex(null)}>Fermer</Button>}>
        {zoomTex && <img src={zoomTex.url} className="w-full rounded-lg" alt="" />}
      </Modal>
    </div>
  )
}

function Panel({ title, icon: Icon, children }: { title: string; icon: typeof Sun; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} className="border-b border-line px-4 py-4">
      <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold tracking-wide text-fg-subtle uppercase">
        <Icon className="size-3.5" /> {title}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12.5px] text-fg-muted">{label}</span>
      {children}
    </div>
  )
}
