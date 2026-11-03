/**
 * Génération d'images locale avec stable-diffusion.cpp (MIT) :
 * binaire choisi selon le matériel (CUDA, Vulkan, CPU), modèles téléchargés
 * depuis Hugging Face (dépôts publics, sans compte), progression lue sur la
 * sortie réelle du programme.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ImageEntry } from '@shared/catalog'
import type { Accelerator } from '@shared/types'
import { logActivity, type Db } from './db'
import { taskController, taskUpdate } from './events'
import { withGpu } from './gpu'
import { downloadFile, extractZip, hfFileInfo, latestGithubRelease } from './net'

export interface ImageJob {
  modelId: string
  prompt: string
  negative?: string
  width: number
  height: number
  steps: number
  cfg: number
  seed: number // -1 = aléatoire
  count: number
  sampler?: string
  initImage?: string // chemin absolu
  strength?: number
  projectId?: string | null
}

export interface GenerationRecord {
  id: string
  kind: 'image' | 'mesh3d'
  projectId: string | null
  engine: string
  location: 'local' | 'cloud'
  prompt: string
  params: Record<string, unknown>
  files: string[]
  createdAt: string
}

export function listGenerations(db: Db, kind: 'image' | 'mesh3d', limit = 200): GenerationRecord[] {
  const rows = db.prepare('SELECT * FROM generations WHERE kind = ? ORDER BY created_at DESC LIMIT ?').all(kind, limit) as {
    id: string
    kind: string
    project_id: string | null
    engine: string
    location: string
    prompt: string
    params: string
    files: string
    created_at: string
  }[]
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as 'image' | 'mesh3d',
    projectId: r.project_id,
    engine: r.engine,
    location: r.location as 'local' | 'cloud',
    prompt: r.prompt,
    params: JSON.parse(r.params),
    files: (JSON.parse(r.files) as string[]).filter((f) => existsSync(f)),
    createdAt: r.created_at
  }))
}

export function saveGeneration(db: Db, g: Omit<GenerationRecord, 'createdAt'>): GenerationRecord {
  const createdAt = new Date().toISOString()
  db.prepare('INSERT INTO generations (id, kind, project_id, engine, location, prompt, params, files, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    g.id,
    g.kind,
    g.projectId,
    g.engine,
    g.location,
    g.prompt,
    JSON.stringify(g.params),
    JSON.stringify(g.files),
    createdAt
  )
  return { ...g, createdAt }
}

export function deleteGeneration(db: Db, id: string): void {
  const row = db.prepare('SELECT files FROM generations WHERE id = ?').get(id) as { files: string } | undefined
  if (!row) return
  for (const f of JSON.parse(row.files) as string[]) rmSync(f, { force: true })
  db.prepare('DELETE FROM generations WHERE id = ?').run(id)
}

const EXE = process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli'
const LEGACY_EXE = process.platform === 'win32' ? 'sd.exe' : 'sd'

export class ImageEngine {
  private current: ChildProcess | null = null

  constructor(
    private readonly db: Db,
    private readonly engineDir: string,
    private readonly modelsDir: string,
    private readonly outputDir: string,
    private readonly accelerator: () => Promise<{ accelerator: Accelerator; avx2: boolean }>,
    private readonly freeGpu: () => Promise<void>
  ) {}

  private exe(): string | null {
    const find = (dir: string, depth: number): string | null => {
      if (!existsSync(dir)) return null
      for (const n of [EXE, LEGACY_EXE]) if (existsSync(join(dir, n))) return join(dir, n)
      if (depth <= 0) return null
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (d.isDirectory()) {
          const r = find(join(dir, d.name), depth - 1)
          if (r) return r
        }
      }
      return null
    }
    return find(this.engineDir, 2)
  }

  engineInstalled(): boolean {
    return this.exe() !== null
  }

  async installEngine(): Promise<void> {
    const id = 'engine:sdcpp'
    const label = "Installation du moteur d'images (stable-diffusion.cpp)"
    const ctrl = taskController(id)
    taskUpdate({ id, kind: 'engine', label, state: 'running', stage: 'Recherche de la dernière version' })
    try {
      if (process.platform !== 'win32') throw new Error("L'installation automatique est prévue pour Windows.")
      const { accelerator } = await this.accelerator()
      const rel = await latestGithubRelease('leejet/stable-diffusion.cpp')
      const pick = (re: RegExp) => rel.assets.find((a) => re.test(a.name))
      const wanted =
        accelerator === 'cuda'
          ? [pick(/^sd-.*-bin-win-cuda12-x64\.zip$/), pick(/^cudart-sd-bin-win-cu12-x64\.zip$/)]
          : accelerator === 'vulkan'
            ? [pick(/^sd-.*-bin-win-vulkan-x64\.zip$/)]
            : [pick(/^sd-.*-bin-win-(cpu|avx2)-x64\.zip$/)]
      if (wanted.some((a) => !a)) throw new Error(`Fichiers introuvables dans la version ${rel.tag} de stable-diffusion.cpp.`)
      rmSync(this.engineDir, { recursive: true, force: true })
      mkdirSync(this.engineDir, { recursive: true })
      for (const asset of wanted) {
        const dest = join(this.engineDir, '..', '_downloads', asset!.name)
        await downloadFile({
          url: asset!.url,
          dest,
          sha256: asset!.digest,
          signal: ctrl.signal,
          onProgress: (p) => taskUpdate({ id, kind: 'engine', label, state: 'running', stage: `Téléchargement de ${asset!.name}`, received: p.received, total: p.total || asset!.size, speed: p.speed })
        })
        taskUpdate({ id, kind: 'engine', label, state: 'running', stage: `Extraction de ${asset!.name}` })
        await extractZip(dest, this.engineDir)
        rmSync(dest, { force: true })
      }
      if (!this.exe()) throw new Error("L'archive ne contient pas sd-cli.exe.")
      taskUpdate({ id, kind: 'engine', label, state: 'done', stage: `stable-diffusion.cpp ${rel.tag} (${accelerator.toUpperCase()})` })
    } catch (e) {
      const cancelled = ctrl.signal.aborted
      taskUpdate({ id, kind: 'engine', label, state: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : (e as Error).message })
      if (!cancelled) throw e
    }
  }

  private filePath(m: ImageEntry, f: ImageEntry['files'][number]): string {
    return join(this.modelsDir, m.id, f.path.split('/').pop()!)
  }

  modelInstalled(m: ImageEntry): boolean {
    return m.files.every((f) => existsSync(this.filePath(m, f)))
  }

  async installModel(m: ImageEntry): Promise<void> {
    const id = `image-model:${m.id}`
    const label = `Téléchargement de ${m.name}`
    const ctrl = taskController(id)
    taskUpdate({ id, kind: 'model', label, state: 'running', stage: 'Lecture des informations Hugging Face' })
    try {
      const infos = await Promise.all(m.files.map((f) => hfFileInfo(f.repo, f.path)))
      const total = infos.reduce((s, i) => s + i.size, 0)
      let doneBytes = 0
      for (let k = 0; k < m.files.length; k++) {
        const f = m.files[k]!
        const info = infos[k]!
        const dest = this.filePath(m, f)
        if (existsSync(dest) && statSync(dest).size === info.size) {
          doneBytes += info.size
          continue
        }
        await downloadFile({
          url: info.url,
          dest,
          sha256: info.sha256,
          signal: ctrl.signal,
          onProgress: (p) =>
            taskUpdate({ id, kind: 'model', label, state: 'running', stage: `Fichier ${k + 1}/${m.files.length} : ${f.path.split('/').pop()}`, received: doneBytes + p.received, total, speed: p.speed })
        })
        doneBytes += info.size
      }
      logActivity(this.db, 'image-model.installed', `Modèle d'image ${m.name} installé`)
      taskUpdate({ id, kind: 'model', label, state: 'done', stage: 'Installé' })
    } catch (e) {
      const cancelled = ctrl.signal.aborted
      taskUpdate({ id, kind: 'model', label, state: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : (e as Error).message })
      if (!cancelled) throw e
    }
  }

  removeModel(m: ImageEntry): void {
    rmSync(join(this.modelsDir, m.id), { recursive: true, force: true })
    logActivity(this.db, 'image-model.removed', `Modèle d'image ${m.name} supprimé`)
  }

  cancel(): void {
    if (this.current?.pid) {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(this.current.pid), '/T', '/F'], { windowsHide: true })
      else this.current.kill()
    }
  }

  async generate(m: ImageEntry, job: ImageJob): Promise<GenerationRecord> {
    const exe = this.exe()
    if (!exe) throw new Error("Le moteur d'images n'est pas installé.")
    if (!this.modelInstalled(m)) throw new Error(`Le modèle ${m.name} n'est pas installé.`)
    const taskId = `image:${randomUUID()}`
    const label = `Génération : ${job.prompt.slice(0, 40)}`
    return withGpu("génération d'image", this.freeGpu, async () => {
      const id = randomUUID()
      const dir = join(this.outputDir, 'images')
      mkdirSync(dir, { recursive: true })
      const files: string[] = []
      const seeds: number[] = []
      const count = Math.max(1, Math.min(8, job.count))
      try {
        for (let n = 0; n < count; n++) {
          const seed = job.seed >= 0 ? job.seed + n : Math.floor(Math.random() * 2 ** 31)
          const out = join(dir, `${id}-${n + 1}.png`)
          const args: string[] = []
          for (const f of m.files) {
            const p = this.filePath(m, f)
            if (f.role === 'model') args.push('-m', p)
            if (f.role === 'diffusion') args.push('--diffusion-model', p)
            if (f.role === 'vae') args.push('--vae', p)
            if (f.role === 'llm') args.push('--llm', p)
          }
          args.push('-p', job.prompt)
          if (job.negative) args.push('-n', job.negative)
          args.push('-W', String(job.width), '-H', String(job.height), '--steps', String(job.steps), '--cfg-scale', String(job.cfg), '-s', String(seed), '-o', out, '-v')
          if (job.sampler) args.push('--sampling-method', job.sampler)
          if (job.initImage) args.push('-i', job.initImage, '--strength', String(job.strength ?? 0.6))
          args.push(...m.extraArgs)
          await this.runOnce(exe, args, (stage, cur, total) =>
            taskUpdate({ id: taskId, kind: 'image', label, state: 'running', stage: count > 1 ? `Image ${n + 1}/${count} · ${stage}` : stage, current: cur, of: total })
          )
          if (!existsSync(out)) throw new Error("Le moteur n'a produit aucune image. Consulte le message d'erreur ci-dessus.")
          files.push(out)
          seeds.push(seed)
        }
        const rec = saveGeneration(this.db, {
          id,
          kind: 'image',
          projectId: job.projectId ?? null,
          engine: m.id,
          location: 'local',
          prompt: job.prompt,
          params: { ...job, seeds, initImage: job.initImage ? true : undefined },
          files
        })
        writeFileSync(join(dir, `${id}.json`), JSON.stringify(rec, null, 2))
        logActivity(this.db, 'image.generated', `${files.length} image(s) générée(s) avec ${m.name}`)
        taskUpdate({ id: taskId, kind: 'image', label, state: 'done', stage: 'Terminé' })
        return rec
      } catch (e) {
        for (const f of files) rmSync(f, { force: true })
        taskUpdate({ id: taskId, kind: 'image', label, state: 'error', error: (e as Error).message })
        throw e
      }
    })
  }

  private runOnce(exe: string, args: string[], onProgress: (stage: string, cur?: number, total?: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      onProgress('Chargement du modèle')
      const child = spawn(exe, args, { windowsHide: true })
      this.current = child
      let tail = ''
      let stage = 'Chargement du modèle'
      const onData = (d: Buffer) => {
        const s = d.toString('utf8')
        tail = (tail + s).slice(-4000)
        for (const line of s.split(/[\r\n]+/)) {
          const prog = /\|\s*(\d+)\/(\d+)\s*-/.exec(line)
          if (/sampling/i.test(line) && !prog) stage = 'Échantillonnage'
          else if (/decod/i.test(line)) stage = 'Décodage de l’image'
          else if (/loading|load .*model/i.test(line) && stage === 'Chargement du modèle') stage = 'Chargement du modèle'
          if (prog) onProgress(stage === 'Chargement du modèle' ? 'Échantillonnage' : stage, Number(prog[1]), Number(prog[2]))
          else if (/save result|saved/i.test(line)) onProgress('Enregistrement')
          else onProgress(stage)
        }
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      child.on('error', (e) => reject(e))
      child.on('close', (code) => {
        this.current = null
        if (code === 0) resolve()
        else {
          const hint = /out of memory|cudaMalloc|alloc/i.test(tail) ? ' Mémoire vidéo insuffisante : réduis la résolution ou choisis un modèle plus léger.' : ''
          reject(new Error(`Le moteur d'images s'est arrêté (code ${code}).${hint}\n${tail.split(/\r?\n/).filter(Boolean).slice(-6).join('\n')}`))
        }
      })
    })
  }
}
