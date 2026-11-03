/**
 * Génération 3D via le Cloud gratuit : Space Hugging Face public « TRELLIS »
 * (Microsoft, licence MIT), quota ZeroGPU gratuit (2 min/jour sans compte,
 * 5 min/jour avec un compte Hugging Face gratuit). Fonctionne sur tous les PC.
 *
 * La génération 3D locale (TripoSR / TripoSG) nécessite la compilation de
 * dépendances CUDA sous Windows : elle n'est pas encore proposée (voir docs).
 */
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { logActivity, type Db } from './db'
import { taskController, taskUpdate } from './events'
import { saveGeneration, type GenerationRecord } from './images'
import { USER_AGENT } from './net'

export const TRELLIS_SPACE = 'trellis-community/TRELLIS'

export interface Mesh3DJob {
  imagePath: string
  seed: number
  ssSteps: number
  slatSteps: number
  ssGuidance: number
  slatGuidance: number
  meshSimplify: number
  textureSize: number
  hfToken?: string
  projectId?: string | null
  prompt?: string
}

export interface SpaceStatus {
  space: string
  available: boolean
  stage?: string
  error?: string
}

export async function spaceStatus(space = TRELLIS_SPACE): Promise<SpaceStatus> {
  try {
    const res = await fetch(`https://huggingface.co/api/spaces/${space}/runtime`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return { space, available: false, error: `HTTP ${res.status}` }
    const j = (await res.json()) as { stage?: string }
    return { space, available: j.stage === 'RUNNING' || j.stage === 'SLEEPING' || j.stage === 'RUNNING_BUILDING', stage: j.stage }
  } catch (e) {
    return { space, available: false, error: (e as Error).message }
  }
}

type GradioFile = { url?: string; path?: string } | string | null | undefined

async function fetchGradioFile(f: GradioFile, base: string, token?: string): Promise<Buffer> {
  const url = typeof f === 'string' ? f : (f?.url ?? (f?.path ? `${base}/gradio_api/file=${f.path}` : undefined))
  if (!url) throw new Error('Le Space n’a renvoyé aucun fichier.')
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  if (!res.ok) throw new Error(`Téléchargement du résultat impossible (HTTP ${res.status}).`)
  return Buffer.from(await res.arrayBuffer())
}

export async function generateCloud3D(db: Db, outputDir: string, job: Mesh3DJob): Promise<GenerationRecord> {
  const taskId = `mesh3d:${randomUUID()}`
  const label = 'Génération 3D (Cloud TRELLIS)'
  const ctrl = taskController(taskId)
  const update = (stage: string) => taskUpdate({ id: taskId, kind: 'mesh3d', label, state: 'running', stage })
  try {
    update('Connexion au Space Hugging Face')
    const { Client, handle_file } = await import('@gradio/client')
    const client = await Client.connect(TRELLIS_SPACE, {
      ...(job.hfToken ? { hf_token: job.hfToken as `hf_${string}` } : {}),
      events: ['data', 'status']
    })
    const base = (client.config?.root ?? '').replace(/\/$/, '')
    if (ctrl.signal.aborted) throw new Error('Annulé')

    update('Ouverture de la session')
    await client.predict('/start_session', []).catch(() => undefined)

    const image = new Blob([readFileSync(job.imagePath)], { type: extname(job.imagePath).toLowerCase() === '.jpg' ? 'image/jpeg' : 'image/png' })
    update('Préparation de l’image (suppression du fond)')
    const pre = await client.predict('/preprocess_image', [handle_file(image)])
    const processed = (pre.data as GradioFile[])[0]

    update('Génération du modèle 3D (file d’attente du GPU gratuit)')
    const sub = client.submit('/generate_and_extract_glb', [
      processed,
      [],
      false,
      job.seed,
      job.ssGuidance,
      job.ssSteps,
      job.slatGuidance,
      job.slatSteps,
      'stochastic',
      job.meshSimplify,
      job.textureSize
    ])
    let result: unknown[] | null = null
    ctrl.signal.addEventListener('abort', () => void sub.cancel(), { once: true })
    for await (const msg of sub) {
      if (msg.type === 'status') {
        const s = msg as { stage?: string; queue?: boolean; position?: number; eta?: number; message?: string }
        if (s.stage === 'error') throw new Error(s.message || 'Erreur du Space (quota GPU gratuit épuisé ou Space indisponible).')
        if (s.queue && typeof s.position === 'number') update(`En file d’attente : position ${s.position + 1}${s.eta ? ` (~${Math.round(s.eta)} s)` : ''}`)
        else if (s.stage === 'pending') update('Génération en cours sur le GPU distant')
      } else if (msg.type === 'data') {
        result = (msg as { data: unknown[] }).data
        break
      }
    }
    if (!result) throw new Error('Aucun résultat reçu du Space.')
    const glbRef = (result[2] ?? result[3]) as GradioFile
    const videoRef = result[1] as GradioFile

    update('Téléchargement du modèle 3D')
    const id = randomUUID()
    const dir = join(outputDir, 'models3d')
    mkdirSync(dir, { recursive: true })
    const glbPath = join(dir, `${id}.glb`)
    writeFileSync(glbPath, await fetchGradioFile(glbRef, base, job.hfToken))
    const files = [glbPath]
    try {
      const videoPath = join(dir, `${id}.mp4`)
      writeFileSync(videoPath, await fetchGradioFile(videoRef, base, job.hfToken))
      files.push(videoPath)
    } catch {
      /* aperçu vidéo facultatif */
    }
    const srcCopy = join(dir, `${id}-source${extname(job.imagePath) || '.png'}`)
    copyFileSync(job.imagePath, srcCopy)
    files.push(srcCopy)

    const rec = saveGeneration(db, {
      id,
      kind: 'mesh3d',
      projectId: job.projectId ?? null,
      engine: 'trellis-cloud',
      location: 'cloud',
      prompt: job.prompt ?? '',
      params: { seed: job.seed, ssSteps: job.ssSteps, slatSteps: job.slatSteps, meshSimplify: job.meshSimplify, textureSize: job.textureSize },
      files
    })
    logActivity(db, 'mesh3d.generated', 'Modèle 3D généré (Cloud TRELLIS)')
    taskUpdate({ id: taskId, kind: 'mesh3d', label, state: 'done', stage: 'Terminé' })
    return rec
  } catch (e) {
    const cancelled = ctrl.signal.aborted
    const raw = (e as Error).message ?? String(e)
    const msg = /quota|exceeded|ZeroGPU/i.test(raw)
      ? 'Quota GPU gratuit du jour épuisé (2 min sans compte, 5 min avec un compte Hugging Face gratuit). Réessaie demain ou ajoute un jeton Hugging Face gratuit.'
      : raw
    taskUpdate({ id: taskId, kind: 'mesh3d', label, state: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : msg })
    throw new Error(msg)
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
