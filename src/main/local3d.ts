/**
 * Génération 3D 100 % locale : TripoSR (Stability AI × Tripo, licence MIT).
 *
 * Installation en un clic, sans droits administrateur ni compte :
 * 1. uv (gestionnaire Python autonome, Astral, MIT/Apache) télécharge un Python 3.11 isolé ;
 * 2. PyTorch (CUDA pour NVIDIA, sinon version processeur) et les dépendances sont installés
 *    dans un environnement propre à AI Studio ;
 * 3. le code de TripoSR est téléchargé depuis GitHub ; sa seule dépendance à compiler
 *    (torchmcubes) est remplacée par PyMCubes, qui s'installe sans compilation sous Windows ;
 * 4. les poids officiels (stabilityai/TripoSR) sont téléchargés depuis Hugging Face avec
 *    vérification SHA-256.
 * Après l'installation, la génération fonctionne hors ligne.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Accelerator } from '@shared/types'
import { logActivity, type Db } from './db'
import { taskController, taskUpdate } from './events'
import { withGpu } from './gpu'
import { saveGeneration, type GenerationRecord } from './images'
import { downloadFile, extractZip, hfFileInfo, latestGithubRelease } from './net'

const TRIPOSR_ZIP = 'https://codeload.github.com/VAST-AI-Research/TripoSR/zip/refs/heads/main'
const SETUP_VERSION = 1

/** Remplace torchmcubes (compilation CUDA) par PyMCubes, avec la même interface. */
const ISOSURFACE_PY = `# Réécrit par AI Studio : PyMCubes remplace torchmcubes (aucune compilation nécessaire).
from typing import Callable, Optional, Tuple

import mcubes
import numpy as np
import torch
import torch.nn as nn


class IsosurfaceHelper(nn.Module):
    points_range: Tuple[float, float] = (0, 1)

    @property
    def grid_vertices(self) -> torch.FloatTensor:
        raise NotImplementedError


class MarchingCubeHelper(IsosurfaceHelper):
    def __init__(self, resolution: int) -> None:
        super().__init__()
        self.resolution = resolution
        self._grid_vertices: Optional[torch.FloatTensor] = None

    @property
    def grid_vertices(self) -> torch.FloatTensor:
        if self._grid_vertices is None:
            x, y, z = (torch.linspace(*self.points_range, self.resolution),) * 3
            x, y, z = torch.meshgrid(x, y, z, indexing="ij")
            verts = torch.cat([x.reshape(-1, 1), y.reshape(-1, 1), z.reshape(-1, 1)], dim=-1).reshape(-1, 3)
            self._grid_vertices = verts
        return self._grid_vertices

    def forward(self, level: torch.FloatTensor) -> Tuple[torch.FloatTensor, torch.LongTensor]:
        r = self.resolution
        volume = (-level.view(r, r, r)).detach().float().cpu().numpy()
        vertices, faces = mcubes.marching_cubes(volume, 0.0)
        v_pos = torch.from_numpy(np.ascontiguousarray(vertices, dtype=np.float32)) / (r - 1.0)
        t_pos_idx = torch.from_numpy(np.ascontiguousarray(faces, dtype=np.int64))
        return v_pos.to(level.device), t_pos_idx.to(level.device)
`

/** Script d'inférence exécuté par AI Studio ; écrit des lignes JSON sur la sortie standard. */
const WORKER_PY = `import argparse, json, os, sys, time

def emit(**kw):
    sys.stdout.write(json.dumps(kw, ensure_ascii=False) + "\\n")
    sys.stdout.flush()

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--image", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--weights", required=True)
    p.add_argument("--device", default="cuda")
    p.add_argument("--mc", type=int, default=256)
    p.add_argument("--ratio", type=float, default=0.85)
    a = p.parse_args()
    emit(stage="Chargement de PyTorch")
    import numpy as np
    import torch
    import trimesh
    from PIL import Image
    device = a.device if (a.device == "cpu" or torch.cuda.is_available()) else "cpu"
    if device != a.device:
        emit(stage="CUDA indisponible : calcul sur le processeur")
    from tsr.system import TSR
    from tsr.utils import remove_background, resize_foreground
    import rembg
    emit(stage="Chargement du modèle TripoSR")
    model = TSR.from_pretrained(a.weights, config_name="config.yaml", weight_name="model.ckpt")
    model.renderer.set_chunk_size(8192)
    model.to(device)
    emit(stage="Suppression du fond")
    session = rembg.new_session()
    image = remove_background(Image.open(a.image), session)
    image = resize_foreground(image, a.ratio)
    arr = np.array(image).astype(np.float32) / 255.0
    arr = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
    image = Image.fromarray((arr * 255.0).astype(np.uint8))
    emit(stage="Reconstruction 3D (réseau neuronal)")
    t = time.time()
    with torch.no_grad():
        codes = model([image], device=device)
    emit(stage="Extraction du maillage (résolution %d)" % a.mc)
    meshes = model.extract_mesh(codes, True, resolution=a.mc)
    mesh = meshes[0]
    try:
        trimesh.repair.fix_normals(mesh)
    except Exception:
        pass
    emit(stage="Enregistrement du modèle")
    mesh.export(a.out)
    emit(done=a.out, seconds=round(time.time() - t, 1), device=device, faces=int(len(mesh.faces)))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        emit(error=str(e), trace=traceback.format_exc()[-2000:])
        sys.exit(1)
`

const DEPS = [
  'numpy==1.26.4',
  'omegaconf==2.3.0',
  'einops==0.7.0',
  'transformers==4.35.0',
  'huggingface-hub==0.25.2',
  'trimesh==4.0.5',
  'Pillow==10.4.0',
  'PyMCubes==0.1.6',
  'rembg==2.0.59',
  'onnxruntime==1.19.2',
  'scipy==1.13.1',
  'networkx==3.3'
]

export interface Local3DStatus {
  installed: boolean
  device: 'cuda' | 'cpu'
  sizeEstimateMB: number
  note: string
}

export class Local3D {
  private proc: ChildProcess | null = null

  constructor(
    private readonly db: Db,
    private readonly root: string,
    private readonly weightsDir: string,
    private readonly outputDir: string,
    private readonly accelerator: () => Promise<Accelerator>,
    private readonly freeGpu: () => Promise<void>
  ) {}

  private python(): string {
    return process.platform === 'win32' ? join(this.root, 'venv', 'Scripts', 'python.exe') : join(this.root, 'venv', 'bin', 'python')
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

  private marker(): { version: number; device: string } | null {
    try {
      return JSON.parse(readFileSync(join(this.root, 'ready.json'), 'utf8'))
    } catch {
      return null
    }
  }

  async status(): Promise<Local3DStatus> {
    const acc = await this.accelerator()
    const device = acc === 'cuda' ? 'cuda' : 'cpu'
    const m = this.marker()
    const installed = Boolean(m && m.version === SETUP_VERSION && existsSync(this.python()) && existsSync(join(this.weightsDir, 'model.ckpt')))
    return {
      installed,
      device,
      sizeEstimateMB: device === 'cuda' ? 5200 : 2900,
      note:
        device === 'cuda'
          ? 'Accélération CUDA sur ta carte NVIDIA : quelques secondes par modèle.'
          : 'Sans carte NVIDIA, TripoSR tourne sur le processeur : compter 1 à 3 minutes par modèle.'
    }
  }

  private env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      UV_CACHE_DIR: join(this.root, 'cache', 'uv'),
      UV_PYTHON_INSTALL_DIR: join(this.root, 'python'),
      HF_HOME: join(this.root, 'cache', 'hf'),
      U2NET_HOME: join(this.root, 'cache', 'u2net'),
      PYTHONPATH: join(this.root, 'src'),
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1'
    }
  }

  private run(cmd: string, args: string[], onLine: (l: string) => void, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { env: this.env(), windowsHide: true })
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

  async install(): Promise<void> {
    const id = 'engine:local3d'
    const label = 'Installation de la 3D locale (TripoSR)'
    const ctrl = taskController(id)
    const up = (stage: string, extra: Record<string, number> = {}) => taskUpdate({ id, kind: 'engine', label, state: 'running', stage, ...extra })
    try {
      if (process.platform !== 'win32') throw new Error("L'installation automatique est prévue pour Windows.")
      const acc = await this.accelerator()
      const device = acc === 'cuda' ? 'cuda' : 'cpu'
      mkdirSync(this.root, { recursive: true })

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

      // 2. Python isolé + environnement
      if (!existsSync(this.python())) {
        await this.run(uv, ['venv', '--python', '3.11', '--seed', join(this.root, 'venv')], (l) => up(`Python 3.11 : ${l.slice(0, 90)}`), ctrl.signal)
      }

      // 3. PyTorch puis dépendances
      const torchIndex = device === 'cuda' ? 'https://download.pytorch.org/whl/cu121' : 'https://download.pytorch.org/whl/cpu'
      up(device === 'cuda' ? 'Installation de PyTorch CUDA (≈ 2,5 Go, quelques minutes)' : 'Installation de PyTorch pour processeur (≈ 200 Mo)')
      await this.run(uv, ['pip', 'install', '--python', this.python(), 'torch==2.5.1', '--index-url', torchIndex], (l) => up(`PyTorch : ${l.slice(0, 90)}`), ctrl.signal)
      up('Installation des dépendances')
      await this.run(uv, ['pip', 'install', '--python', this.python(), ...DEPS], (l) => up(`Dépendances : ${l.slice(0, 90)}`), ctrl.signal)

      // 4. Code de TripoSR (MIT) + correctif PyMCubes
      up('Téléchargement du code de TripoSR')
      const zip = join(this.root, '_dl', 'triposr.zip')
      await downloadFile({ url: TRIPOSR_ZIP, dest: zip, signal: ctrl.signal })
      const tmp = join(this.root, '_dl', 'triposr')
      rmSync(tmp, { recursive: true, force: true })
      await extractZip(zip, tmp)
      const top = readdirSync(tmp).find((d) => existsSync(join(tmp, d, 'tsr')))
      if (!top) throw new Error('Archive TripoSR inattendue (dossier tsr introuvable).')
      rmSync(join(this.root, 'src'), { recursive: true, force: true })
      mkdirSync(join(this.root, 'src'), { recursive: true })
      renameSync(join(tmp, top, 'tsr'), join(this.root, 'src', 'tsr'))
      writeFileSync(join(this.root, 'src', 'tsr', 'models', 'isosurface.py'), ISOSURFACE_PY, 'utf8')
      writeFileSync(join(this.root, 'worker.py'), WORKER_PY, 'utf8')
      rmSync(join(this.root, '_dl'), { recursive: true, force: true })

      // 5. Poids officiels (Hugging Face, public, vérifiés)
      const files = ['config.yaml', 'model.ckpt']
      const infos = await Promise.all(files.map((f) => hfFileInfo('stabilityai/TripoSR', f)))
      const total = infos.reduce((s, i) => s + i.size, 0)
      let done = 0
      for (let k = 0; k < files.length; k++) {
        const info = infos[k]!
        await downloadFile({
          url: info.url,
          dest: join(this.weightsDir, files[k]!),
          sha256: info.sha256,
          signal: ctrl.signal,
          onProgress: (p) => up(`Téléchargement des poids TripoSR (${files[k]})`, { received: done + p.received, total, speed: p.speed })
        })
        done += info.size
      }

      writeFileSync(join(this.root, 'ready.json'), JSON.stringify({ version: SETUP_VERSION, device, installedAt: new Date().toISOString() }))
      logActivity(this.db, 'engine.installed', `3D locale installée (TripoSR, ${device.toUpperCase()})`)
      taskUpdate({ id, kind: 'engine', label, state: 'done', stage: 'Installée' })
    } catch (e) {
      const cancelled = ctrl.signal.aborted
      taskUpdate({ id, kind: 'engine', label, state: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : (e as Error).message })
      throw e
    }
  }

  remove(): void {
    rmSync(this.root, { recursive: true, force: true })
    rmSync(this.weightsDir, { recursive: true, force: true })
    logActivity(this.db, 'engine.removed', '3D locale (TripoSR) supprimée')
  }

  cancel(): void {
    if (this.proc?.pid) {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(this.proc.pid), '/T', '/F'], { windowsHide: true })
      else this.proc.kill()
    }
  }

  async generate(job: { imagePath: string; quality: 'fast' | 'balanced' | 'high'; projectId?: string | null; prompt?: string }): Promise<GenerationRecord> {
    const st = await this.status()
    if (!st.installed) throw new Error("La 3D locale n'est pas installée.")
    const taskId = `mesh3d:${randomUUID()}`
    const label = 'Génération 3D locale (TripoSR)'
    const ctrl = taskController(taskId)
    const run = async (): Promise<GenerationRecord> => {
      const id = randomUUID()
      const dir = join(this.outputDir, 'models3d')
      mkdirSync(dir, { recursive: true })
      const out = join(dir, `${id}.glb`)
      const mc = job.quality === 'fast' ? 192 : job.quality === 'high' ? 384 : 256
      const errors: string[] = []
      let result: { device?: string; seconds?: number; faces?: number } = {}
      await new Promise<void>((resolve, reject) => {
        const child = spawn(this.python(), [join(this.root, 'worker.py'), '--image', job.imagePath, '--out', out, '--weights', this.weightsDir, '--device', st.device, '--mc', String(mc)], {
          env: this.env(),
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
              const j = JSON.parse(line) as { stage?: string; done?: string; error?: string; device?: string; seconds?: number; faces?: number }
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
            const hint = /out of memory|CUDA error/i.test(errors.join(' ') + tail) ? ' Mémoire vidéo insuffisante : choisis la qualité « Rapide ».' : ''
            reject(new Error(ctrl.signal.aborted ? 'Génération annulée.' : `TripoSR a échoué : ${errors[0] ?? tail.split(/\r?\n/).filter(Boolean).slice(-4).join(' ')}${hint}`))
          }
        })
      })
      const src = join(dir, `${id}-source${extname(job.imagePath) || '.png'}`)
      copyFileSync(job.imagePath, src)
      const rec = saveGeneration(this.db, {
        id,
        kind: 'mesh3d',
        projectId: job.projectId ?? null,
        engine: 'triposr-local',
        location: 'local',
        prompt: job.prompt ?? '',
        params: { engine: 'triposr-local', quality: job.quality, mcResolution: mc, ...result },
        files: [out, src]
      })
      logActivity(this.db, 'mesh3d.generated', `Modèle 3D généré en local (TripoSR, ${result.device ?? st.device}, ${result.seconds ?? '?'} s)`)
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

