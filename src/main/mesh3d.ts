/**
 * Génération 3D via des Spaces Hugging Face publics (API Gradio) : gratuits,
 * sans clé ni compte, sur tous les PC. Un jeton Hugging Face gratuit facultatif
 * augmente le quota GPU quotidien.
 *
 * Chaque moteur a son propre enchaînement d'appels, relevé dans le code source
 * du Space (app.py). Les étapes affichées sont celles réellement exécutées.
 */
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { MESH_ENGINES, type MeshQuality } from '@shared/mesh-engines'
import { logActivity, type Db } from './db'
import { taskController, taskUpdate } from './events'
import { saveGeneration, type GenerationRecord } from './images'
import { USER_AGENT } from './net'
import type { GpuQuotaInfo } from '@shared/ipc'
import { parseQuotaError } from '@shared/quota'

export interface Mesh3DJob {
  engine: string
  imagePath?: string
  seed: number
  quality: MeshQuality
  textured: boolean
  numParts: number
  textureSize: number
  hfToken?: string
  projectId?: string | null
  prompt?: string
}

export interface SpaceStatus {
  engine: string
  space: string
  available: boolean
  stage?: string
  hardware?: string
  error?: string
}

export async function spaceStatus(space: string): Promise<Omit<SpaceStatus, 'engine'>> {
  try {
    const res = await fetch(`https://huggingface.co/api/spaces/${space}/runtime`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return { space, available: false, error: `HTTP ${res.status}` }
    const j = (await res.json()) as { stage?: string; hardware?: { current?: string | null } }
    const ok = ['RUNNING', 'SLEEPING', 'RUNNING_BUILDING', 'RUNNING_APP_STARTING'].includes(j.stage ?? '')
    return { space, available: ok, stage: j.stage, hardware: j.hardware?.current ?? undefined }
  } catch (e) {
    return { space, available: false, error: (e as Error).message }
  }
}

export async function allSpaceStatus(): Promise<SpaceStatus[]> {
  return Promise.all(MESH_ENGINES.filter((e) => e.location !== 'local').map(async (e) => ({ engine: e.id, ...(await spaceStatus(e.space)) })))
}

type GradioFile = { url?: string; path?: string } | string | null | undefined
type Client = Awaited<ReturnType<typeof import('@gradio/client').Client.connect>>
type Update = (stage: string) => void

async function fetchGradioFile(f: GradioFile, base: string, token?: string): Promise<Buffer> {
  const url = typeof f === 'string' ? (f.startsWith('http') ? f : `${base}/gradio_api/file=${f}`) : (f?.url ?? (f?.path ? `${base}/gradio_api/file=${f.path}` : undefined))
  if (!url) throw new Error('Le Space n’a renvoyé aucun fichier.')
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  if (!res.ok) throw new Error(`Téléchargement du résultat impossible (HTTP ${res.status}).`)
  return Buffer.from(await res.arrayBuffer())
}

/** Appel suivi : file d'attente, erreurs et annulation remontent réellement. */
async function call(client: Client, endpoint: string, data: unknown[], update: Update, label: string, signal: AbortSignal): Promise<unknown[]> {
  update(label)
  const sub = client.submit(endpoint, data)
  const onAbort = () => void sub.cancel()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    for await (const msg of sub) {
      if (msg.type === 'status') {
        const s = msg as { stage?: string; queue?: boolean; position?: number; eta?: number; message?: string; progress_data?: { desc?: string; index?: number; length?: number }[] }
        if (s.stage === 'error') throw new Error(s.message || `Le Space a renvoyé une erreur (${endpoint}).`)
        if (s.queue && typeof s.position === 'number') update(`${label} · file d’attente : position ${s.position + 1}${s.eta ? ` (~${Math.round(s.eta)} s)` : ''}`)
        else if (s.progress_data?.[0]?.length) {
          const p = s.progress_data[0]
          update(`${label} · ${p.desc ? `${p.desc} ` : ''}${p.index ?? 0}/${p.length}`)
        }
      } else if (msg.type === 'data') {
        return (msg as { data: unknown[] }).data
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  throw new Error(signal.aborted ? 'Annulé.' : `Aucun résultat reçu (${endpoint}).`)
}

const Q = <T,>(q: MeshQuality, fast: T, balanced: T, high: T): T => (q === 'fast' ? fast : q === 'high' ? high : balanced)

interface RunCtx {
  client: Client
  image: Blob | null
  handle: (b: Blob | null) => unknown
  job: Mesh3DJob
  update: Update
  signal: AbortSignal
}

/** Enchaînement d'appels propre à chaque Space. Renvoie le fichier GLB final (et un aperçu facultatif). */
const RUNNERS: Record<string, (c: RunCtx) => Promise<{ glb: GradioFile; preview?: GradioFile }>> = {
  async trellis({ client, image, handle, job, update, signal }) {
    await client.predict('/start_session', []).catch(() => undefined)
    const pre = await call(client, '/preprocess_image', [handle(image)], update, 'Suppression du fond et recadrage', signal)
    const steps = Q(job.quality, 8, 12, 25)
    const out = await call(
      client,
      '/generate_and_extract_glb',
      [pre[0], [], false, job.seed, 7.5, steps, 3.0, steps, 'stochastic', Q(job.quality, 0.97, 0.95, 0.92), job.textureSize],
      update,
      'Génération de la forme et des textures',
      signal
    )
    return { glb: (out[2] ?? out[3]) as GradioFile, preview: out[1] as GradioFile }
  },

  async trellis2({ client, image, handle, job, update, signal }) {
    await client.predict('/start_session', []).catch(() => undefined)
    const pre = await call(client, '/preprocess_image', [handle(image)], update, 'Suppression du fond et recadrage', signal)
    const steps = Q(job.quality, 8, 12, 20)
    const res = Q(job.quality, '512', '1024', '1536')
    await call(client, '/image_to_3d', [pre[0], job.seed, res, 7.5, 0.7, steps, 5.0, 7.5, 0.5, steps, 3.0, 1.0, 0.0, steps, 3.0], update, 'Génération de la structure 3D', signal)
    const out = await call(client, '/extract_glb', [Q(job.quality, 150000, 300000, 500000), job.textureSize], update, 'Extraction du maillage et des textures PBR', signal)
    return { glb: (out[0] ?? out[1]) as GradioFile }
  },

  async partcrafter({ client, image, handle, job, update, signal }) {
    await client.predict('/start_session', []).catch(() => undefined)
    const out = await call(
      client,
      '/run_partcrafter',
      [handle(image), Math.max(1, Math.min(16, job.numParts)), job.seed, Q(job.quality, 512, 1024, 2048), Q(job.quality, 25, 50, 50), 7.0, false, true],
      update,
      `Génération de ${job.numParts} partie(s)`,
      signal
    )
    return { glb: out[0] as GradioFile }
  },

  async triposg({ client, image, handle, job, update, signal }) {
    await client.predict('/start_session', []).catch(() => undefined)
    const seg = await call(client, '/run_segmentation', [handle(image)], update, 'Isolation de l’objet', signal)
    const geo = await call(
      client,
      '/image_to_3d',
      [seg[0], job.seed, Q(job.quality, 20, 30, 50), 7.0, true, Q(job.quality, 50000, 100000, 200000)],
      update,
      'Génération de la géométrie',
      signal
    )
    if (!job.textured) return { glb: geo[0] as GradioFile }
    const tex = await call(client, '/run_texture', [handle(image), geo[0], job.seed], update, 'Génération de la texture', signal)
    return { glb: tex[0] as GradioFile }
  },

  async 'trellis2-text'({ client, job, update, signal }) {
    if (!job.prompt?.trim()) throw new Error('Ce moteur a besoin d’une description en texte.')
    await client.predict('/start_session', []).catch(() => undefined)
    const img = await call(client, '/generate_txt2img', [job.prompt], update, 'Création de l’image à partir du texte', signal)
    const pre = await call(client, '/preprocess_image', [img[0]], update, 'Préparation de l’image', signal)
    const steps = Q(job.quality, 8, 12, 20)
    const out = await call(
      client,
      '/generate_3d',
      [pre[0], job.seed, Q(job.quality, '512', '1024', '1536'), Q(job.quality, 100000, 150000, 300000), job.textureSize, 7.5, 0.7, steps, 5.0, 7.5, 0.5, steps, 3.0, 1.0, 0.0, steps, 3.0],
      update,
      'Génération du modèle TRELLIS.2',
      signal
    )
    return { glb: (out[1] ?? out[0]) as GradioFile }
  },

  async 'shap-e'({ client, image, handle, job, update, signal }) {
    const steps = Q(job.quality, 32, 64, 96)
    if (image) {
      const out = await call(client, '/image-to-3d', [handle(image), job.seed, 3.0, steps], update, 'Génération Shap-E depuis l’image', signal)
      return { glb: out[0] as GradioFile }
    }
    if (!job.prompt?.trim()) throw new Error('Donne une image ou une description en texte.')
    const out = await call(client, '/text-to-3d', [job.prompt, job.seed, 15.0, steps], update, 'Génération Shap-E depuis le texte', signal)
    return { glb: out[0] as GradioFile }
  },

  async hunyuan21({ client, image, handle, job, update, signal }) {
    const data = [handle(image), null, null, null, null, Q(job.quality, 10, 30, 50), 5.0, job.seed, Q(job.quality, 196, 256, 384), true, 8000, false]
    if (job.textured) {
      const out = await call(client, '/generation_all', data, update, 'Génération de la forme et de la texture', signal)
      return { glb: (out[1] ?? out[0]) as GradioFile }
    }
    const out = await call(client, '/shape_generation', data, update, 'Génération de la forme', signal)
    return { glb: out[0] as GradioFile }
  },

  async instantmesh({ client, image, handle, job, update, signal }) {
    const pre = await call(client, '/preprocess', [handle(image), true], update, 'Suppression du fond', signal)
    await call(client, '/generate_mvs', [pre[0], Q(job.quality, 30, 50, 75), job.seed], update, 'Génération des 6 vues', signal)
    const out = await call(client, '/make3d', [], update, 'Reconstruction du maillage', signal)
    return { glb: (out[1] ?? out[0]) as GradioFile }
  },

  async hi3dgen({ client, image, handle, job, update, signal }) {
    const pre = await call(client, '/preprocess_image', [handle(image)], update, 'Suppression du fond et recadrage', signal)
    const out = await call(client, '/generate_3d', [pre[0], job.seed, 3, Q(job.quality, 25, 50, 50), 3.0, Q(job.quality, 4, 6, 10)], update, 'Génération de la géométrie détaillée', signal)
    return { glb: (out[2] ?? out[3]) as GradioFile }
  },

  async step1x({ client, image, handle, job, update, signal }) {
    const geo = await call(client, '/generate_geometry', [handle(image), 7.5, Q(job.quality, 25, 50, 75), 400000, 'symmetry', 'sharp'], update, 'Génération de la géométrie', signal)
    if (!job.textured) return { glb: geo[0] as GradioFile }
    const tex = await call(client, '/generate_texture', [handle(image)], update, 'Génération de la texture', signal)
    return { glb: tex[0] as GradioFile }
  }
}

/** Dernier état connu du quota ZeroGPU, extrait des vraies réponses de Hugging Face. */
let lastQuota: GpuQuotaInfo | null = null

export function gpuQuota(withAccount: boolean): GpuQuotaInfo | null {
  if (!lastQuota) return null
  // Après la réinitialisation annoncée, l'ancienne mesure n'a plus de sens.
  if (lastQuota.resetAt && Date.parse(lastQuota.resetAt) < Date.now()) return null
  if (lastQuota.withAccount !== withAccount) return null
  return lastQuota
}

export async function generateCloud3D(db: Db, outputDir: string, job: Mesh3DJob, allowRestricted = false): Promise<GenerationRecord> {
  const engine = MESH_ENGINES.find((e) => e.id === job.engine)
  const runner = RUNNERS[job.engine]
  if (!engine || !runner) throw new Error('Moteur 3D inconnu.')
  if (engine.restricted && !allowRestricted) throw new Error(`${engine.label} est désactivé : sa licence doit d’abord être acceptée (page Génération 3D).`)
  const taskId = `mesh3d:${randomUUID()}`
  const label = `Génération 3D (${engine.label})`
  const ctrl = taskController(taskId)
  const update: Update = (stage) => taskUpdate({ id: taskId, kind: 'mesh3d', label, state: 'running', stage })
  try {
    update(`Connexion à ${engine.space}`)
    const { Client, handle_file } = await import('@gradio/client')
    const client = await Client.connect(engine.space, {
      ...(job.hfToken ? { hf_token: job.hfToken as `hf_${string}` } : {}),
      events: ['data', 'status']
    })
    const base = (client.config?.root ?? '').replace(/\/$/, '')
    if (ctrl.signal.aborted) throw new Error('Annulé.')
    const ext = job.imagePath ? extname(job.imagePath).toLowerCase() : ''
    const image = job.imagePath ? new Blob([readFileSync(job.imagePath)], { type: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png' }) : null
    if (!image && engine.input !== 'text' && engine.input !== 'both') throw new Error(`${engine.label} a besoin d’une image de départ.`)

    const handle = (b: Blob | null) => {
      if (!b) throw new Error(`${engine.label} a besoin d’une image de départ.`)
      return handle_file(b)
    }
    const result = await runner({ client, image, handle, job, update, signal: ctrl.signal })

    update('Téléchargement du modèle 3D')
    const id = randomUUID()
    const dir = join(outputDir, 'models3d')
    mkdirSync(dir, { recursive: true })
    const glbPath = join(dir, `${id}.glb`)
    writeFileSync(glbPath, await fetchGradioFile(result.glb, base, job.hfToken))
    const files = [glbPath]
    if (result.preview) {
      try {
        const p = join(dir, `${id}.mp4`)
        writeFileSync(p, await fetchGradioFile(result.preview, base, job.hfToken))
        files.push(p)
      } catch {
        /* aperçu facultatif */
      }
    }
    if (job.imagePath) {
      const srcCopy = join(dir, `${id}-source${ext || '.png'}`)
      copyFileSync(job.imagePath, srcCopy)
      files.push(srcCopy)
    }

    const rec = saveGeneration(db, {
      id,
      kind: 'mesh3d',
      projectId: job.projectId ?? null,
      engine: engine.id,
      location: 'cloud',
      prompt: job.prompt ?? '',
      params: { engine: engine.id, seed: job.seed, quality: job.quality, textured: job.textured, numParts: job.numParts, textureSize: job.textureSize },
      files
    })
    logActivity(db, 'mesh3d.generated', `Modèle 3D généré (${engine.label}, Cloud gratuit)`)
    taskUpdate({ id: taskId, kind: 'mesh3d', label, state: 'done', stage: 'Terminé' })
    return rec
  } catch (e) {
    const cancelled = ctrl.signal.aborted
    const raw = (e as Error).message ?? String(e)
    const q = parseQuotaError(raw, Boolean(job.hfToken))
    if (q) {
      const { requestedSeconds: _r, ...info } = q
      lastQuota = info
    }
    const wait = q?.resetAt ? ` Réinitialisation vers ${new Date(q.resetAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.` : ''
    const msg = q
      ? q.requestedSeconds && q.leftSeconds
        ? `${engine.label} demande ${q.requestedSeconds} s de GPU mais il te reste ${q.leftSeconds} s de quota gratuit aujourd’hui. Choisis un moteur plus léger (TRELLIS, TripoSG, Shap-E) ou la 3D locale, illimitée.${wait}`
        : `Quota GPU gratuit du jour épuisé (commun à tous les moteurs Cloud).${wait} ${job.hfToken ? 'La 3D locale, elle, n’a aucun quota.' : 'Ajoute un jeton Hugging Face gratuit (Paramètres > IA) pour plus de quota, ou utilise la 3D locale, illimitée.'}`
      : /GPU task aborted/i.test(raw)
        ? `${engine.label} : la tâche GPU a dépassé sa durée maximale sur Hugging Face. Réessaie en qualité « Rapide ».`
      : /sleep|building|not running|Space is paused|503/i.test(raw)
        ? `${engine.label} est en veille ou en cours de démarrage sur Hugging Face. Réessaie dans une minute, ou choisis un autre moteur.`
        : `${engine.label} : ${raw}`
    taskUpdate({ id: taskId, kind: 'mesh3d', label, state: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : msg })
    throw new Error(cancelled ? 'Génération annulée.' : msg)
  }
}

/** Importe un modèle 3D existant (GLB, OBJ, STL, PLY) dans la bibliothèque. */
export function importMesh(db: Db, outputDir: string, src: string): GenerationRecord {
  const ext = extname(src).toLowerCase()
  if (!['.glb', '.gltf', '.obj', '.stl', '.ply'].includes(ext)) throw new Error('Format non pris en charge (GLB, GLTF, OBJ, STL, PLY).')
  const id = randomUUID()
  const dir = join(outputDir, 'models3d')
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, `${id}${ext}`)
  copyFileSync(src, dest)
  return saveGeneration(db, { id, kind: 'mesh3d', projectId: null, engine: 'import', location: 'local', prompt: src.split(/[\\/]/).pop() ?? '', params: {}, files: [dest] })
}
