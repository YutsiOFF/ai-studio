/**
 * Téléchargements reprenables avec progression réelle et vérification SHA-256,
 * résolution des fichiers GitHub Releases et Hugging Face, extraction d'archives.
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const USER_AGENT = 'AI-Studio (+https://github.com/YutsiOFF/ai-studio)'

export interface DownloadProgress {
  received: number
  total: number
  /** Octets par seconde, moyenne glissante. */
  speed: number
}

export class DownloadError extends Error {}

export async function downloadFile(opts: {
  url: string
  dest: string
  sha256?: string
  headers?: Record<string, string>
  signal?: AbortSignal
  onProgress?: (p: DownloadProgress) => void
}): Promise<void> {
  const part = `${opts.dest}.part`
  mkdirSync(dirname(opts.dest), { recursive: true })
  let start = existsSync(part) ? statSync(part).size : 0

  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, ...opts.headers }
  if (start > 0) headers['Range'] = `bytes=${start}-`
  const res = await fetch(opts.url, { headers, signal: opts.signal, redirect: 'follow' })
  if (res.status === 416) {
    // Le fichier partiel est déjà complet.
  } else if (!res.ok || !res.body) {
    throw new DownloadError(`Téléchargement impossible (HTTP ${res.status}) : ${opts.url}`)
  } else {
    if (start > 0 && res.status !== 206) start = 0 // le serveur ne gère pas la reprise : on recommence
    const length = Number(res.headers.get('content-length') ?? 0)
    const total = length > 0 ? start + length : 0
    let received = start
    let lastTick = Date.now()
    let lastBytes = received
    let speed = 0
    const body = Readable.fromWeb(res.body as never)
    body.on('data', (chunk: Buffer) => {
      received += chunk.length
      const now = Date.now()
      if (now - lastTick >= 400) {
        const inst = ((received - lastBytes) * 1000) / (now - lastTick)
        speed = speed === 0 ? inst : speed * 0.7 + inst * 0.3
        lastTick = now
        lastBytes = received
        opts.onProgress?.({ received, total, speed })
      }
    })
    await pipeline(body, createWriteStream(part, { flags: start > 0 ? 'a' : 'w' }), { signal: opts.signal })
    opts.onProgress?.({ received, total: total || received, speed })
  }

  if (opts.sha256) {
    const actual = await sha256File(part)
    if (actual.toLowerCase() !== opts.sha256.toLowerCase()) {
      unlinkSync(part)
      throw new DownloadError("Le fichier téléchargé est corrompu (empreinte SHA-256 différente). Il a été supprimé, réessaie.")
    }
  }
  renameSync(part, opts.dest)
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

/** Extrait une archive .zip avec tar.exe (inclus dans Windows 10 1803+) ou unzip/tar ailleurs. */
export function extractZip(archive: string, destDir: string): Promise<void> {
  mkdirSync(destDir, { recursive: true })
  return new Promise((resolve, reject) => {
    const [cmd, args] =
      process.platform === 'win32' ? ['tar', ['-xf', archive, '-C', destDir]] : ['unzip', ['-o', '-q', archive, '-d', destDir]]
    execFile(cmd as string, args as string[], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, _o, stderr) => {
      if (err) reject(new Error(`Extraction impossible : ${stderr || err.message}`))
      else resolve()
    })
  })
}

export interface GithubAsset {
  name: string
  size: number
  url: string
  digest?: string
}

/** Liste les fichiers de la dernière version publiée d'un dépôt GitHub (API publique, sans compte). */
export async function latestGithubRelease(repo: string): Promise<{ tag: string; assets: GithubAsset[] }> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' }
  })
  if (!res.ok) throw new Error(`GitHub ne répond pas (HTTP ${res.status}) pour ${repo}.`)
  const json = (await res.json()) as {
    tag_name: string
    assets: { name: string; size: number; browser_download_url: string; digest?: string | null }[]
  }
  return {
    tag: json.tag_name,
    assets: json.assets.map((a) => ({
      name: a.name,
      size: a.size,
      url: a.browser_download_url,
      digest: a.digest?.startsWith('sha256:') ? a.digest.slice(7) : undefined
    }))
  }
}

export interface HfFileInfo {
  url: string
  size: number
  sha256?: string
}

/** Informations d'un fichier Hugging Face public (taille et SHA-256 officiels), sans compte. */
export async function hfFileInfo(repo: string, path: string, token?: string): Promise<HfFileInfo> {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`https://huggingface.co/api/models/${repo}/tree/main${dir ? `/${dir}` : ''}`, { headers })
  if (!res.ok) throw new Error(`Hugging Face ne répond pas (HTTP ${res.status}) pour ${repo}.`)
  const list = (await res.json()) as { path: string; size: number; lfs?: { oid: string; size: number } }[]
  const f = list.find((e) => e.path === path)
  if (!f) throw new Error(`Fichier introuvable sur Hugging Face : ${repo}/${path}`)
  return {
    url: `https://huggingface.co/${repo}/resolve/main/${path.split('/').map(encodeURIComponent).join('/')}?download=true`,
    size: f.lfs?.size ?? f.size,
    sha256: f.lfs?.oid
  }
}

/** Vérifie si une adresse locale répond. */
export async function isReachable(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

/** Lit un flux NDJSON (une valeur JSON par ligne). */
export async function* readNdjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (line) yield JSON.parse(line) as T
    }
  }
  const rest = buffer.trim()
  if (rest) yield JSON.parse(rest) as T
}

/** Lit un flux Server-Sent Events et renvoie le contenu des lignes `data:`. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let idx: number
    while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '')
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
      if (data) yield data
    }
  }
}
