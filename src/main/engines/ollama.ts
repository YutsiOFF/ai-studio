/**
 * Moteur LLM local : Ollama (MIT).
 *
 * - Si Ollama est déjà installé et lancé sur le PC (port 11434), AI Studio l'utilise.
 * - Sinon, AI Studio télécharge l'archive officielle autonome depuis GitHub
 *   (prévue par Ollama pour l'intégration dans d'autres applications), la place dans
 *   son propre dossier et la lance lui-même, sans droits administrateur.
 * - Le serveur n'écoute que sur 127.0.0.1. Aucune clé, aucun compte.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { downloadFile, extractZip, isReachable, latestGithubRelease } from '../net'
import { taskController, taskUpdate } from '../events'

export type OllamaMode = 'external' | 'managed'

export interface OllamaStatus {
  installed: boolean
  running: boolean
  mode: OllamaMode | null
  version?: string
  baseUrl?: string
  /** Taille du téléchargement du moteur, si connue. */
  downloadSizeMB?: number
  error?: string
}

const EXTERNAL_URL = 'http://127.0.0.1:11434'

function freePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => {
      const s2 = createServer()
      s2.listen(0, '127.0.0.1', () => {
        const port = (s2.address() as { port: number }).port
        s2.close(() => resolve(port))
      })
    })
    srv.listen(preferred, '127.0.0.1', () => srv.close(() => resolve(preferred)))
  })
}

export class OllamaEngine {
  private proc: ChildProcess | null = null
  private baseUrl: string | null = null
  private mode: OllamaMode | null = null
  private starting: Promise<string> | null = null

  constructor(
    private readonly engineDir: string,
    private readonly modelsDir: string
  ) {}

  private exePath(): string | null {
    const name = process.platform === 'win32' ? 'ollama.exe' : 'ollama'
    const direct = join(this.engineDir, name)
    if (existsSync(direct)) return direct
    // Certaines archives placent le binaire dans un sous-dossier.
    if (existsSync(this.engineDir)) {
      for (const d of readdirSync(this.engineDir, { withFileTypes: true })) {
        if (d.isDirectory() && existsSync(join(this.engineDir, d.name, name))) return join(this.engineDir, d.name, name)
      }
    }
    return null
  }

  async version(url: string): Promise<string | undefined> {
    try {
      const r = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(1500) })
      if (!r.ok) return undefined
      return ((await r.json()) as { version?: string }).version
    } catch {
      return undefined
    }
  }

  async status(): Promise<OllamaStatus> {
    if (this.baseUrl && (await isReachable(`${this.baseUrl}/api/version`))) {
      return { installed: true, running: true, mode: this.mode, baseUrl: this.baseUrl, version: await this.version(this.baseUrl) }
    }
    const extVersion = await this.version(EXTERNAL_URL)
    if (extVersion) return { installed: true, running: true, mode: 'external', baseUrl: EXTERNAL_URL, version: extVersion }
    return { installed: this.exePath() !== null, running: false, mode: this.exePath() ? 'managed' : null }
  }

  /** Télécharge et installe le moteur dans le dossier d'AI Studio. */
  async install(accelerator: 'cuda' | 'vulkan' | 'cpu', gpuVendor?: string): Promise<void> {
    const taskId = 'engine:ollama'
    const ctrl = taskController(taskId)
    const label = 'Installation du moteur local (Ollama)'
    taskUpdate({ id: taskId, kind: 'engine', label, state: 'running', stage: 'Recherche de la dernière version' })
    try {
      if (process.platform !== 'win32') throw new Error("L'installation automatique du moteur est prévue pour Windows. Installe Ollama manuellement sur ce système.")
      const arm = process.arch === 'arm64'
      const rel = await latestGithubRelease('ollama/ollama')
      const wanted = [arm ? 'ollama-windows-arm64.zip' : 'ollama-windows-amd64.zip']
      // Pilotes AMD ROCm : bibliothèques complémentaires (Vulkan reste utilisé si ROCm n'est pas pris en charge).
      if (!arm && accelerator === 'vulkan' && gpuVendor === 'amd') wanted.push('ollama-windows-amd64-rocm.zip')
      const tmpDir = join(this.engineDir, '..', '_downloads')
      rmSync(this.engineDir, { recursive: true, force: true })
      mkdirSync(this.engineDir, { recursive: true })
      for (const name of wanted) {
        const asset = rel.assets.find((a) => a.name === name)
        if (!asset) throw new Error(`Fichier ${name} introuvable dans la version ${rel.tag} d'Ollama.`)
        const dest = join(tmpDir, `${rel.tag}-${name}`)
        await downloadFile({
          url: asset.url,
          dest,
          sha256: asset.digest,
          signal: ctrl.signal,
          onProgress: (p) =>
            taskUpdate({ id: taskId, kind: 'engine', label, state: 'running', stage: `Téléchargement de ${name} (${rel.tag})`, received: p.received, total: p.total || asset.size, speed: p.speed })
        })
        taskUpdate({ id: taskId, kind: 'engine', label, state: 'running', stage: `Extraction de ${name}` })
        await extractZip(dest, this.engineDir)
        rmSync(dest, { force: true })
      }
      if (!this.exePath()) throw new Error("L'archive ne contient pas ollama.exe.")
      taskUpdate({ id: taskId, kind: 'engine', label, state: 'done', stage: `Ollama ${rel.tag} installé` })
    } catch (e) {
      const cancelled = ctrl.signal.aborted
      taskUpdate({ id: taskId, kind: 'engine', label, state: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : (e as Error).message })
      throw e
    }
  }

  /** Renvoie l'adresse d'un serveur Ollama prêt, en le démarrant si nécessaire. */
  async ensureRunning(): Promise<string> {
    if (this.baseUrl && (await isReachable(`${this.baseUrl}/api/version`))) return this.baseUrl
    if (this.starting) return this.starting
    this.starting = this.start().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async start(): Promise<string> {
    if (await this.version(EXTERNAL_URL)) {
      this.baseUrl = EXTERNAL_URL
      this.mode = 'external'
      return EXTERNAL_URL
    }
    const exe = this.exePath()
    if (!exe) throw new Error("Le moteur local n'est pas installé.")
    const port = await freePort(11500)
    const url = `http://127.0.0.1:${port}`
    mkdirSync(this.modelsDir, { recursive: true })
    this.proc = spawn(exe, ['serve'], {
      env: {
        ...process.env,
        OLLAMA_HOST: `127.0.0.1:${port}`,
        OLLAMA_MODELS: this.modelsDir,
        OLLAMA_NOPRUNE: '1'
      },
      windowsHide: true,
      stdio: 'ignore'
    })
    this.proc.on('exit', () => {
      this.proc = null
      if (this.mode === 'managed') this.baseUrl = null
    })
    for (let i = 0; i < 60; i++) {
      if (await isReachable(`${url}/api/version`, 1000)) {
        this.baseUrl = url
        this.mode = 'managed'
        return url
      }
      if (!this.proc) break
      await new Promise((r) => setTimeout(r, 500))
    }
    this.stop()
    throw new Error("Le moteur local n'a pas démarré. Vérifie que ton antivirus ne bloque pas ollama.exe.")
  }

  stop(): void {
    if (this.proc) {
      if (process.platform === 'win32' && this.proc.pid) {
        spawn('taskkill', ['/pid', String(this.proc.pid), '/T', '/F'], { windowsHide: true })
      } else {
        this.proc.kill()
      }
      this.proc = null
    }
    if (this.mode === 'managed') this.baseUrl = null
  }
}
