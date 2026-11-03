/**
 * Accès aux fichiers d'un projet, limité à son dossier.
 * Toute opération passe par `resolveInside`, qui refuse les sorties du dossier
 * (chemins absolus, `..`, liens symboliques) et les fichiers sensibles.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', 'out', '.next', '.cache', '.idea', '.vs', 'target', 'Library', 'Temp', 'obj'])
const SENSITIVE = [/^\.env(\..*)?$/i, /\.pem$/i, /\.key$/i, /^id_(rsa|ed25519|ecdsa)/i, /\.pfx$/i, /\.p12$/i, /^credentials(\.json)?$/i, /\.kdbx$/i]
export const MAX_READ_BYTES = 256 * 1024

export class AccessDenied extends Error {}

export function isSensitive(path: string): boolean {
  const name = basename(path)
  return SENSITIVE.some((re) => re.test(name))
}

/** Résout un chemin relatif au projet et garantit qu'il reste dans le dossier. */
export function resolveInside(root: string, p: string): string {
  if (typeof p !== 'string' || p.includes('\0')) throw new AccessDenied('Chemin invalide.')
  const rootReal = realpathSync(root)
  const target = resolve(rootReal, isAbsolute(p) ? p : p || '.')
  // Le chemin réel du premier parent existant ne doit pas sortir du dossier (liens symboliques).
  let probe = target
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  const probeReal = realpathSync(probe)
  const inside = (x: string) => x === rootReal || x.startsWith(rootReal.endsWith(sep) ? rootReal : rootReal + sep)
  if (!inside(target) || !inside(probeReal)) throw new AccessDenied(`Accès refusé : « ${p} » est en dehors du dossier du projet.`)
  const rel = relative(rootReal, target)
  if (rel.split(/[\\/]/).includes('.git') && rel !== '.git') {
    // lecture autorisée par l'appelant au cas par cas ; écriture jamais
  }
  return target
}

export function toRel(root: string, abs: string): string {
  return relative(realpathSync(root), abs).split(sep).join('/') || '.'
}

export function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

export function readText(abs: string): string {
  const st = statSync(abs)
  if (!st.isFile()) throw new Error("Ce n'est pas un fichier.")
  if (st.size > MAX_READ_BYTES * 8) throw new Error(`Fichier trop volumineux (${Math.round(st.size / 1024)} Ko).`)
  const buf = readFileSync(abs)
  if (isBinary(buf)) throw new Error('Fichier binaire : lecture non prise en charge.')
  return buf.toString('utf8')
}

export interface DirEntry {
  path: string
  type: 'file' | 'dir'
  size?: number
}

export function listTree(root: string, start: string, maxDepth: number, limit = 400): { entries: DirEntry[]; truncated: boolean } {
  const entries: DirEntry[] = []
  let truncated = false
  const walk = (dir: string, depth: number) => {
    if (entries.length >= limit) {
      truncated = true
      return
    }
    let items: import('node:fs').Dirent[]
    try {
      items = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    items.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const it of items) {
      if (entries.length >= limit) {
        truncated = true
        return
      }
      const abs = join(dir, it.name)
      if (it.isDirectory()) {
        if (IGNORED_DIRS.has(it.name)) continue
        entries.push({ path: toRel(root, abs), type: 'dir' })
        if (depth < maxDepth) walk(abs, depth + 1)
      } else if (it.isFile()) {
        let size: number | undefined
        try {
          size = statSync(abs).size
        } catch {
          size = undefined
        }
        entries.push({ path: toRel(root, abs), type: 'file', size })
      }
    }
  }
  walk(start, 1)
  return { entries, truncated }
}

export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if ('.+^${}()|[]\\'.includes(c)) re += `\\${c}`
    else re += c
  }
  return new RegExp(`^${re}$`, 'i')
}

export interface SearchHit {
  path: string
  line: number
  text: string
}

export function searchFiles(root: string, query: string, opts: { regex?: boolean; glob?: string; limit?: number }): { hits: SearchHit[]; filesScanned: number; truncated: boolean } {
  const limit = opts.limit ?? 100
  const matcher = opts.regex ? new RegExp(query, 'i') : null
  const needle = query.toLowerCase()
  const globRe = opts.glob ? globToRegExp(opts.glob.includes('/') ? opts.glob : `**/${opts.glob}`) : null
  const hits: SearchHit[] = []
  let filesScanned = 0
  let truncated = false
  const rootReal = realpathSync(root)
  const walk = (dir: string) => {
    if (hits.length >= limit) return
    let items: import('node:fs').Dirent[]
    try {
      items = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const it of items) {
      if (hits.length >= limit) {
        truncated = true
        return
      }
      const abs = join(dir, it.name)
      if (it.isDirectory()) {
        if (!IGNORED_DIRS.has(it.name)) walk(abs)
        continue
      }
      if (!it.isFile() || isSensitive(abs)) continue
      const rel = toRel(rootReal, abs)
      if (globRe && !globRe.test(rel)) continue
      let buf: Buffer
      try {
        if (statSync(abs).size > MAX_READ_BYTES * 4) continue
        buf = readFileSync(abs)
      } catch {
        continue
      }
      if (isBinary(buf)) continue
      filesScanned++
      const lines = buf.toString('utf8').split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!
        if (matcher ? matcher.test(l) : l.toLowerCase().includes(needle)) {
          hits.push({ path: rel, line: i + 1, text: l.trim().slice(0, 240) })
          if (hits.length >= limit) {
            truncated = true
            return
          }
        }
      }
    }
  }
  walk(rootReal)
  return { hits, filesScanned, truncated }
}
