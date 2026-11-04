/**
 * Génération 3D 100 % locale, sans compte ni quota :
 * - TripoSR (Stability AI × Tripo, MIT) : rapide, fonctionne aussi sur processeur ;
 * - TripoSG (VAST/Tripo, MIT) : géométrie bien plus fine, carte NVIDIA ≥ 8 Go conseillée.
 *
 * Installation en un clic, sans droits administrateur :
 * 1. uv (Astral, MIT/Apache) télécharge un Python 3.11 isolé ;
 * 2. chaque moteur reçoit son environnement (PyTorch CUDA ou processeur + dépendances épinglées) ;
 * 3. le code source est téléchargé depuis GitHub (commit épinglé) et les extensions à compiler
 *    sont contournées (voir local3d-spec.ts) ;
 * 4. les poids officiels sont téléchargés depuis Hugging Face avec vérification SHA-256.
 * Après l'installation, la génération fonctionne hors ligne.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import type { Accelerator } from '@shared/types'
import { logActivity, type Db } from './db'
import { taskController, taskUpdate } from './events'
import { withGpu } from './gpu'
import { saveGeneration, type GenerationRecord } from './images'
import { LOCAL3D_SPECS, type Local3DEngineId, type Local3DSpec } from './local3d-spec'
import { downloadFile, extractZip, hfListFiles, latestGithubRelease, type HfFileInfo } from './net'

export type { Local3DEngineId }

export interface Local3DEngineStatus {
  id: Local3DEngineId
  installed: boolean
  /** Faux si ce PC ne peut pas faire tourner le moteur (raison dans `reason`). */
  supported: boolean
  reason?: string
  sizeEstimateMB: number
  note: string
}

export interface Local3DStatus {
  device: 'cuda' | 'cpu'
  vramMB: number
  engines: Record<Local3DEngineId, Local3DEngineStatus>
}

export class Local3D {
  private proc: ChildProcess | null = null
  private weightsSize = new Map<Local3DEngineId, number>()

  constructor(
    private readonly db: Db,
    private readonly root: string,
    /** Dossier parent des poids : <modelsDir>/<moteur>. */
    private readonly modelsDir: string,
    private readonly outputDir: string,
    private readonly hardware: () => Promise<{ accelerator: Accelerator; vramMB: number }>,
    private readonly freeGpu: () => Promise<void>
  ) {}

  private envDir(spec: Local3DSpec): string {
    return spec.dir ? join(this.root, spec.dir) : this.root
  }
  private weightsDir(spec: Local3DSpec): string {
    return join(this.modelsDir, spec.id)
  }
  private python(spec: Local3DSpec): string {
    const d = this.envDir(spec)
    return process.platform === 'win32' ? join(d, 'venv', 'Scripts', 'python.exe') : join(d, 'venv', 'bin', 'python')
  }

  private uv(): string | null {
    const dir = join(this.root, 'uv')
    if (!existsSync(dir)) return null
    const name = process.platform === 'win32' ? 'uv.exe' : 'uv'
    const walk = (d: string, depth: number): string | null => {
      if (existsSync(join(d, name))) return join(d, name)
      if (depth <= 0) return null
      for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) {
        const r = walk(join(d, e.name), depth - 1)
        if (r) return r
      }
      return null
    }
    return walk(dir, 2)
  }

  private marker(spec: Local3DSpec): { version: number; device: string } | null {
    try {
      return JSON.parse(readFileSync(join(this.envDir(spec), 'ready.json'), 'utf8'))
    } catch {
      return null
    }
  }

  private isInstalled(spec: Local3DSpec): boolean {
    const m = this.marker(spec)
    return Boolean(m && m.version === spec.setupVersion && existsSync(this.python(spec)) && existsSync(join(this.weightsDir(spec), '.complete')))
  }

  async status(): Promise<Local3DStatus> {
    const hw = await this.hardware()
    const device = hw.accelerator === 'cuda' ? 'cuda' : 'cpu'
    const torchMB = device === 'cuda' ? 3400 : 900
    const engines = {} as Record<Local3DEngineId, Local3DEngineStatus>
    for (const spec of Object.values(LOCAL3D_SPECS)) {
      const supported = !spec.requiresCuda || (device === 'cuda' && hw.vramMB >= spec.minVramMB)
      const reason = supported
        ? undefined
        : device !== 'cuda'
          ? `${spec.label} a besoin d’une carte NVIDIA (CUDA). Utilise TripoSR sur ce PC, ou un moteur Cloud.`
          : `${spec.label} a besoin d’environ ${Math.round(spec.minVramMB / 1000)} Go de mémoire vidéo (ta carte : ${Math.round(hw.vramMB / 1000)} Go).`
      const weightsMB = this.weightsSize.get(spec.id) ?? (spec.id === 'triposr' ? 1700 : 6500)
      engines[spec.id] = {
        id: spec.id,
        installed: this.isInstalled(spec),
        supported,
        reason,
        sizeEstimateMB: torchMB + 700 + weightsMB,
        note:
          spec.id === 'triposr'
            ? device === 'cuda'
              ? 'Quelques secondes par modèle sur ta carte NVIDIA.'
              : 'Sans carte NVIDIA, compter 1 à 3 minutes par modèle sur le processeur.'
            : 'Géométrie détaillée (sans texture), 30 s à 2 min par modèle selon la qualité.'
      }
    }
    return { device, vramMB: hw.vramMB, engines }
  }

  private env(spec: Local3DSpec): NodeJS.ProcessEnv {
    return {
      ...process.env,
      UV_CACHE_DIR: join(this.root, 'cache', 'uv'),
      UV_PYTHON_INSTALL_DIR: join(this.root, 'python'),
      // Les environnements sont sur le même disque que le cache : liens au lieu de copies.
      UV_LINK_MODE: 'hardlink',
      HF_HOME: join(this.root, 'cache', 'hf'),
      U2NET_HOME: join(this.root, 'cache', 'u2net'),
      PYTHONPATH: join(this.envDir(spec), 'src'),
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1'
    }
  }

  private run(spec: Local3DSpec, cmd: string, args: string[], onLine: (l: string) => void, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { env: this.env(spec), windowsHide: true })
      let tail = ''
      const onData = (d: Buffer) => {
        const s = d.toString('utf8')
        tail = (tail + s).slice(-3000)
        for (const l of s.split(/\r?\n|\r/)) if (l.trim()) onLine(l.trim())
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      const kill = () => {
        if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        else child.kill()
      }
      signal.addEventListener('abort', kill, { once: true })
      child.on('error', reject)
      child.on('close', (code) => {
        signal.removeEventListener('abort', kill)
        if (code === 0) resolve()
        else reject(new Error(signal.aborted ? 'Annulé.' : `Échec (code ${code}) :\n${tail.split(/\r?\n/).filter(Boolean).slice(-8).join('\n')}`))
      })
    })
  }

  private async weightFiles(spec: Local3DSpec): Promise<(HfFileInfo & { path: string })[]> {
    const all = await hfListFiles(spec.weights.repo)
    const files = spec.weights.files === 'all' ? all : all.filter((f) => (spec.weights.files as string[]).includes(f.path))
    if (spec.weights.files !== 'all' && files.length !== spec.weights.files.length) throw new Error(`Poids incomplets sur Hugging Face (${spec.weights.repo}).`)
    this.weightsSize.set(spec.id, Math.round(files.reduce((s, f) => s + f.size, 0) / 1e6))
    return files
  }

  async install(engine: Local3DEngineId): Promise<void> {
    const spec = LOCAL3D_SPECS[engine]
    const id = `engine:local3d:${engine}`
    const label = `Installation de ${spec.label} (3D locale)`
    const ctrl = taskController(id)
    const up = (stage: string, extra: Record<string, number> = {}) => taskUpdate({ id, kind: 'engine', label, state: 'running', stage, ...extra })
    try {
      if (process.platform !== 'win32') throw new Error("L'installation automatique est prévue pour Windows.")
      const st = await this.status()
      if (!st.engines[engine].supported) throw new Error(st.engines[engine].reason)
      const device = st.device
      const envDir = this.envDir(spec)
      mkdirSync(envDir, { recursive: true })

      // 1. uv
      if (!this.uv()) {
        up('Recherche de uv (gestionnaire Python)')
        const rel = await latestGithubRelease('astral-sh/uv')
        const asset = rel.assets.find((a) => a.name === (process.arch === 'arm64' ? 'uv-aarch64-pc-windows-msvc.zip' : 'uv-x86_64-pc-windows-msvc.zip'))
        if (!asset) throw new Error('uv introuvable sur GitHub.')
        const dest = join(this.root, '_dl', asset.name)
        await downloadFile({ url: asset.url, dest, sha256: asset.digest, signal: ctrl.signal, onProgress: (p) => up(`Téléchargement de uv ${rel.tag}`, { received: p.received, total: p.total || asset.size, speed: p.speed }) })
        await extractZip(dest, join(this.root, 'uv'))
        rmSync(dest, { force: true })
      }
      const uv = this.uv()
      if (!uv) throw new Error("uv.exe introuvable après l'extraction.")

      // 2. Python isolé + environnement propre au moteur
      if (!existsSync(this.python(spec))) {
        await this.run(spec, uv, ['venv', '--python', '3.11', '--seed', join(envDir, 'venv')], (l) => up(`Python 3.11 : ${l.slice(0, 90)}`), ctrl.signal)
      }

      // 3. PyTorch puis dépendances (épinglées, vérifiées ensemble)
      const torchIndex = device === 'cuda' ? 'https://download.pytorch.org/whl/cu121' : 'https://download.pytorch.org/whl/cpu'
      up(device === 'cuda' ? 'Installation de PyTorch CUDA (≈ 2,5 Go, déjà en cache si un autre moteur est installé)' : 'Installation de PyTorch pour processeur (≈ 200 Mo)')
      await this.run(spec, uv, ['pip', 'install', '--python', this.python(spec), ...spec.torch, '--index-url', torchIndex], (l) => up(`PyTorch : ${l.slice(0, 90)}`), ctrl.signal)
      up('Installation des dépendances')
      await this.run(spec, uv, ['pip', 'install', '--python', this.python(spec), ...spec.torch, ...spec.deps], (l) => up(`Dépendances : ${l.slice(0, 90)}`), ctrl.signal)

      // 4. Code source (commit épinglé) + correctifs
      up(`Téléchargement du code de ${spec.label}`)
      const zip = join(envDir, '_dl', 'src.zip')
      await downloadFile({ url: spec.sourceZip, dest: zip, signal: ctrl.signal })
      const tmp = join(envDir, '_dl', 'src')
      rmSync(tmp, { recursive: true, force: true })
      await extractZip(zip, tmp)
      const top = readdirSync(tmp).find((d) => existsSync(join(tmp, d, spec.packageDir)))
      if (!top) throw new Error(`Archive ${spec.label} inattendue (dossier ${spec.packageDir} introuvable).`)
      const srcDir = join(envDir, 'src')
      rmSync(srcDir, { recursive: true, force: true })
      mkdirSync(srcDir, { recursive: true })
      renameSync(join(tmp, top, spec.packageDir), join(srcDir, spec.packageDir))
      for (const [rel, patch] of Object.entries(spec.patches)) {
        const p = join(srcDir, rel)
        writeFileSync(p, patch(existsSync(p) ? readFileSync(p, 'utf8') : ''), 'utf8')
      }
      for (const [rel, content] of Object.entries(spec.extraFiles)) {
        mkdirSync(dirname(join(srcDir, rel)), { recursive: true })
        writeFileSync(join(srcDir, rel), content, 'utf8')
      }
      writeFileSync(join(envDir, 'worker.py'), spec.worker, 'utf8')
      rmSync(join(envDir, '_dl'), { recursive: true, force: true })

      // 5. Poids officiels (Hugging Face, publics, vérifiés SHA-256)
      const wdir = this.weightsDir(spec)
      const files = await this.weightFiles(spec)
      const total = files.reduce((s, f) => s + f.size, 0)
      let done = 0
      for (const f of files) {
        await downloadFile({
          url: f.url,
          dest: join(wdir, ...f.path.split('/')),
          sha256: f.sha256,
          signal: ctrl.signal,
          onProgress: (p) => up(`Téléchargement des poids ${spec.label} (${f.path.split('/').pop()})`, { received: done + p.received, total, speed: p.speed })
        })
        done += f.size
      }
      writeFileSync(join(wdir, '.complete'), new Date().toISOString())

      // 6. Premier chargement en ligne : détourage (rembg) et fichiers annexes mis en cache pour fonctionner hors ligne
      up('Vérification du modèle (premier chargement)')
      await this.run(spec, this.python(spec), ['-c', spec.warmup(wdir)], () => undefined, ctrl.signal)

      writeFileSync(join(envDir, 'ready.json'), JSON.stringify({ version: spec.setupVersion, device, installedAt: new Date().toISOString() }))
      logActivity(this.db, 'engine.installed', `3D locale installée (${spec.label}, ${device.toUpperCase()})`)
      taskUpdate({ id, kind: 'engine', label, state: 'done', stage: 'Installée' })
    } catch (e) {
      const cancelled = ctrl.signal.aborted
      taskUpdate({ id, kind: 'engine', label, state: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : (e as Error).message })
      throw e
    }
  }

  remove(engine: Local3DEngineId): void {
    const spec = LOCAL3D_SPECS[engine]
    const envDir = this.envDir(spec)
    if (spec.dir) rmSync(envDir, { recursive: true, force: true })
    else for (const n of ['venv', 'src', 'worker.py', 'ready.json']) rmSync(join(envDir, n), { recursive: true, force: true })
    rmSync(this.weightsDir(spec), { recursive: true, force: true })
    // Plus aucun moteur : on libère aussi Python, uv et les caches.
    if (!Object.values(LOCAL3D_SPECS).some((s) => existsSync(this.python(s)))) rmSync(this.root, { recursive: true, force: true })
    logActivity(this.db, 'engine.removed', `3D locale (${spec.label}) supprimée`)
  }

  cancel(): void {
    if (this.proc?.pid) {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(this.proc.pid), '/T', '/F'], { windowsHide: true })
      else this.proc.kill()
    }
  }

  private workerArgs(spec: Local3DSpec, job: { imagePath: string; quality: 'fast' | 'balanced' | 'high'; seed: number }, out: string, device: string): { args: string[]; params: Record<string, unknown> } {
    const base = ['--image', job.imagePath, '--out', out, '--weights', this.weightsDir(spec), '--device', device]
    if (spec.id === 'triposr') {
      const mc = job.quality === 'fast' ? 192 : job.quality === 'high' ? 384 : 256
      return { args: [...base, '--mc', String(mc)], params: { mcResolution: mc } }
    }
    const q = { fast: { steps: 25, dense: 7, depth: 8, faces: 60000 }, balanced: { steps: 40, dense: 8, depth: 9, faces: 200000 }, high: { steps: 50, dense: 8, depth: 9, faces: 0 } }[job.quality]
    return {
      args: [...base, '--steps', String(q.steps), '--dense', String(q.dense), '--depth', String(q.depth), '--faces', String(q.faces), '--seed', String(job.seed)],
      params: { steps: q.steps, octreeDepth: q.depth, maxFaces: q.faces || 'illimité', seed: job.seed }
    }
  }

  async generate(engine: Local3DEngineId, job: { imagePath: string; quality: 'fast' | 'balanced' | 'high'; seed: number; projectId?: string | null; prompt?: string }): Promise<GenerationRecord> {
    const spec = LOCAL3D_SPECS[engine]
    const st = await this.status()
    if (!st.engines[engine].installed) throw new Error(`${spec.label} n'est pas installé.`)
    const taskId = `mesh3d:${randomUUID()}`
    const label = `Génération 3D locale (${spec.label})`
    const ctrl = taskController(taskId)
    const run = async (): Promise<GenerationRecord> => {
      const id = randomUUID()
      const dir = join(this.outputDir, 'models3d')
      mkdirSync(dir, { recursive: true })
      const out = join(dir, `${id}.glb`)
      const { args, params } = this.workerArgs(spec, job, out, st.device)
      const errors: string[] = []
      let result: { device?: string; seconds?: number; faces?: number } = {}
      await new Promise<void>((resolve, reject) => {
        const child = spawn(this.python(spec), [join(this.envDir(spec), 'worker.py'), ...args], {
          env: this.env(spec),
          windowsHide: true
        })
        this.proc = child
        let buf = ''
        let tail = ''
        child.stdout.on('data', (d: Buffer) => {
          buf += d.toString('utf8')
          let i: number
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim()
            buf = buf.slice(i + 1)
            try {
              const j = JSON.parse(line) as { stage?: string; done?: string; error?: string; device?: string; seconds?: number; faces?: number}
              if (j.stage) taskUpdate({ id: taskId, kind: 'mesh3d', label, state: 'running', stage: j.stage })
              if (j.error) errors.push(j.error)
              if (j.done) result = j
            } catch {
              /* ligne non JSON */
            }
          }
        })
        child.stderr.on('data', (d: Buffer) => {
          tail = (tail + d.toString('utf8')).slice(-3000)
        })
        ctrl.signal.addEventListener('abort', () => this.cancel(), { once: true })
        child.on('error', reject)
        child.on('close', (code) => {
          this.proc = null
          if (code === 0 && existsSync(out)) resolve()
          else {
            const hint = /out of memory|CUDA error|CUBLAS/i.test(errors.join(' ') + tail) ? ' Mémoire vidéo insuffisante : choisis la qualité « Rapide » et ferme les autres applications qui utilisent la carte graphique.' : ''
            reject(new Error(ctrl.signal.aborted ? 'Génération annulée.' : `${spec.label} a échoué : ${errors[0] ?? tail.split(/\r?\n/).filter(Boolean).slice(-4).join(' ')}${hint}`))
          }
        })
      })
      const src = join(dir, `${id}-source${extname(job.imagePath) || '.png'}`)
      copyFileSync(job.imagePath, src)
      const rec = saveGeneration(this.db, {
        id,
        kind: 'mesh3d',
        projectId: job.projectId ?? null,
        engine: `${engine}-local`,
        location: 'local',
        prompt: job.prompt ?? '',
        params: { engine: `${engine}-local`, quality: job.quality, ...params, ...result },
        files: [out, src]
      })
      logActivity(this.db, 'mesh3d.generated', `Modèle 3D généré en local (${spec.label}, ${result.device ?? st.device}, ${result.seconds ?? '?'} s)`)
      return rec
    }
    try {
      taskUpdate({ id: taskId, kind: 'mesh3d', label, state: 'running', stage: 'Démarrage de Python' })
      const rec = st.device === 'cuda' ? await withGpu('génération 3D locale', this.freeGpu, run) : await run()
      taskUpdate({ id: taskId, kind: 'mesh3d', label, state: 'done', stage: 'Terminé' })
      return rec
    } catch (e) {
      taskUpdate({ id: taskId, kind: 'mesh3d', label, state: ctrl.signal.aborted ? 'cancelled' : 'error', error: (e as Error).message })
      throw e
    }
  }
}
