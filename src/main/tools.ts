/**
 * Système d'outils des agents. Chaque outil déclare son niveau de risque ;
 * les outils qui modifient le projet ou exécutent des commandes passent par
 * une validation de l'utilisateur (sauf autorisation explicite).
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { shell } from 'electron'
import { z } from 'zod'
import { AccessDenied, isSensitive, listTree, readText, resolveInside, searchFiles, toRel } from './projectfs'
import type { ToolSpec } from './providers/types'

export type ToolRisk = 'read' | 'write' | 'destructive' | 'exec'

export interface ChangePreview {
  kind: 'file'
  path: string
  action: 'create' | 'modify' | 'delete' | 'move'
  before: string | null
  after: string | null
  to?: string
}

export interface CommandPreview {
  kind: 'command'
  command: string
  cwd: string
}

export type Preview = ChangePreview | CommandPreview

export interface ToolContext {
  root: string
  signal: AbortSignal
  /** Enregistre une modification appliquée (pour l'annuler plus tard). */
  recordChange: (c: { path: string; action: string; before: string | null; after: string | null }) => void
  onOutput?: (chunk: string) => void
}

export interface ToolResult {
  ok: boolean
  /** Texte renvoyé au modèle. */
  output: string
  /** Résumé court affiché dans la timeline. */
  summary: string
}

export interface Tool<I = Record<string, unknown>> {
  name: string
  label: string
  description: string
  risk: ToolRisk
  schema: z.ZodType<I>
  jsonSchema: Record<string, unknown>
  /** Fichier concerné, pour l'affichage. */
  target?: (input: I) => string | undefined
  preview?: (input: I, ctx: ToolContext) => Preview
  run: (input: I, ctx: ToolContext) => Promise<ToolResult>
}

const MAX_OUTPUT = 20_000
function clip(s: string, max = MAX_OUTPUT): string {
  return s.length > max ? `${s.slice(0, max)}\n… (sortie tronquée, ${s.length - max} caractères de plus)` : s
}

function denyWrite(root: string, path: string): string {
  const abs = resolveInside(root, path)
  const rel = toRel(root, abs)
  if (rel === '.' || rel.split('/').includes('.git')) throw new AccessDenied('Modification du dossier .git interdite.')
  if (isSensitive(abs)) throw new AccessDenied(`Fichier sensible protégé : ${rel}`)
  return abs
}

const listDir: Tool<{ path?: string; depth?: number }> = {
  name: 'list_dir',
  label: 'Exploration du dossier',
  description: 'Liste les fichiers et dossiers du projet (ignore .git, node_modules…). Chemins relatifs à la racine du projet.',
  risk: 'read',
  schema: z.object({ path: z.string().optional(), depth: z.number().int().min(1).max(4).optional() }),
  jsonSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Dossier relatif (défaut : racine)' }, depth: { type: 'integer', description: 'Profondeur 1 à 4 (défaut 2)' } }
  },
  target: (i) => i.path || '.',
  async run(i, ctx) {
    const abs = resolveInside(ctx.root, i.path ?? '.')
    if (!statSync(abs).isDirectory()) return { ok: false, output: "Ce chemin n'est pas un dossier.", summary: 'Pas un dossier' }
    const { entries, truncated } = listTree(ctx.root, abs, i.depth ?? 2)
    const text = entries.map((e) => (e.type === 'dir' ? `${e.path}/` : `${e.path} (${e.size ?? '?'} o)`)).join('\n')
    return { ok: true, output: clip(text || '(dossier vide)') + (truncated ? '\n… (liste tronquée)' : ''), summary: `${entries.length} éléments` }
  }
}

const readFile: Tool<{ path: string; start_line?: number; end_line?: number }> = {
  name: 'read_file',
  label: 'Lecture de fichier',
  description: 'Lit un fichier texte du projet. Pour les gros fichiers, préciser start_line/end_line.',
  risk: 'read',
  schema: z.object({ path: z.string(), start_line: z.number().int().min(1).optional(), end_line: z.number().int().min(1).optional() }),
  jsonSchema: {
    type: 'object',
    required: ['path'],
    properties: { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }
  },
  target: (i) => i.path,
  async run(i, ctx) {
    const abs = resolveInside(ctx.root, i.path)
    if (isSensitive(abs)) throw new AccessDenied('Fichier sensible protégé (secrets).')
    const lines = readText(abs).split(/\r?\n/)
    const start = (i.start_line ?? 1) - 1
    const end = Math.min(lines.length, i.end_line ?? start + 800)
    const body = lines.slice(start, end).map((l, k) => `${String(start + k + 1).padStart(5)}  ${l}`).join('\n')
    const more = end < lines.length ? `\n… (${lines.length - end} lignes restantes : utiliser start_line=${end + 1})` : ''
    return { ok: true, output: clip(body) + more, summary: `${end - start} lignes sur ${lines.length}` }
  }
}

const search: Tool<{ query: string; regex?: boolean; glob?: string }> = {
  name: 'search',
  label: 'Recherche dans le projet',
  description: 'Recherche un texte (ou une expression régulière) dans les fichiers du projet. glob optionnel, ex. "*.ts".',
  risk: 'read',
  schema: z.object({ query: z.string().min(1), regex: z.boolean().optional(), glob: z.string().optional() }),
  jsonSchema: {
    type: 'object',
    required: ['query'],
    properties: { query: { type: 'string' }, regex: { type: 'boolean' }, glob: { type: 'string' } }
  },
  target: (i) => i.glob,
  async run(i, ctx) {
    const r = searchFiles(ctx.root, i.query, { regex: i.regex, glob: i.glob })
    const text = r.hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join('\n')
    return { ok: true, output: clip(text || 'Aucun résultat.') + (r.truncated ? '\n… (résultats tronqués)' : ''), summary: `${r.hits.length} résultat(s) dans ${r.filesScanned} fichiers` }
  }
}

const writeFile: Tool<{ path: string; content: string }> = {
  name: 'write_file',
  label: 'Écriture de fichier',
  description: 'Crée un fichier ou remplace entièrement son contenu. Préférer edit_file pour une modification ciblée.',
  risk: 'write',
  schema: z.object({ path: z.string().min(1), content: z.string() }),
  jsonSchema: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } },
  target: (i) => i.path,
  preview(i, ctx) {
    const abs = denyWrite(ctx.root, i.path)
    const before = existsSync(abs) ? readText(abs) : null
    return { kind: 'file', path: toRel(ctx.root, abs), action: before === null ? 'create' : 'modify', before, after: i.content }
  },
  async run(i, ctx) {
    const abs = denyWrite(ctx.root, i.path)
    const before = existsSync(abs) ? readText(abs) : null
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, i.content, 'utf8')
    ctx.recordChange({ path: toRel(ctx.root, abs), action: before === null ? 'create' : 'modify', before, after: i.content })
    return { ok: true, output: `Fichier ${before === null ? 'créé' : 'remplacé'} : ${toRel(ctx.root, abs)}`, summary: before === null ? 'Créé' : 'Remplacé' }
  }
}

function applyEdit(content: string, oldText: string, newText: string): string {
  const count = content.split(oldText).length - 1
  if (count === 0) throw new Error("Le texte à remplacer (old_text) est introuvable dans le fichier. Relis le fichier et copie le passage exact.")
  if (count > 1) throw new Error(`Le texte à remplacer apparaît ${count} fois : ajoute du contexte pour qu'il soit unique.`)
  return content.replace(oldText, () => newText)
}

const editFile: Tool<{ path: string; old_text: string; new_text: string }> = {
  name: 'edit_file',
  label: 'Modification de fichier',
  description: 'Remplace un passage exact (old_text, unique dans le fichier) par new_text.',
  risk: 'write',
  schema: z.object({ path: z.string().min(1), old_text: z.string().min(1), new_text: z.string() }),
  jsonSchema: {
    type: 'object',
    required: ['path', 'old_text', 'new_text'],
    properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }
  },
  target: (i) => i.path,
  preview(i, ctx) {
    const abs = denyWrite(ctx.root, i.path)
    const before = readText(abs)
    return { kind: 'file', path: toRel(ctx.root, abs), action: 'modify', before, after: applyEdit(before, i.old_text, i.new_text) }
  },
  async run(i, ctx) {
    const abs = denyWrite(ctx.root, i.path)
    const before = readText(abs)
    const after = applyEdit(before, i.old_text, i.new_text)
    writeFileSync(abs, after, 'utf8')
    ctx.recordChange({ path: toRel(ctx.root, abs), action: 'modify', before, after })
    return { ok: true, output: `Fichier modifié : ${toRel(ctx.root, abs)}`, summary: 'Modifié' }
  }
}

const deleteFile: Tool<{ path: string }> = {
  name: 'delete_file',
  label: 'Suppression de fichier',
  description: 'Supprime un fichier du projet (il est placé dans la Corbeille de Windows).',
  risk: 'destructive',
  schema: z.object({ path: z.string().min(1) }),
  jsonSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
  target: (i) => i.path,
  preview(i, ctx) {
    const abs = denyWrite(ctx.root, i.path)
    let before: string | null = null
    try {
      before = readText(abs)
    } catch {
      before = null
    }
    return { kind: 'file', path: toRel(ctx.root, abs), action: 'delete', before, after: null }
  },
  async run(i, ctx) {
    const abs = denyWrite(ctx.root, i.path)
    if (!existsSync(abs) || !statSync(abs).isFile()) return { ok: false, output: 'Fichier introuvable.', summary: 'Introuvable' }
    let before: string | null = null
    try {
      before = readText(abs)
    } catch {
      before = null
    }
    await shell.trashItem(abs)
    ctx.recordChange({ path: toRel(ctx.root, abs), action: 'delete', before, after: null })
    return { ok: true, output: `Fichier placé dans la Corbeille : ${toRel(ctx.root, abs)}`, summary: 'Mis à la Corbeille' }
  }
}

const moveFile: Tool<{ from: string; to: string }> = {
  name: 'move_file',
  label: 'Déplacement / renommage',
  description: 'Déplace ou renomme un fichier du projet.',
  risk: 'write',
  schema: z.object({ from: z.string().min(1), to: z.string().min(1) }),
  jsonSchema: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } },
  target: (i) => `${i.from} → ${i.to}`,
  preview(i, ctx) {
    const a = denyWrite(ctx.root, i.from)
    const b = denyWrite(ctx.root, i.to)
    return { kind: 'file', path: toRel(ctx.root, a), to: toRel(ctx.root, b), action: 'move', before: null, after: null }
  },
  async run(i, ctx) {
    const a = denyWrite(ctx.root, i.from)
    const b = denyWrite(ctx.root, i.to)
    if (existsSync(b)) return { ok: false, output: 'La destination existe déjà.', summary: 'Destination existante' }
    mkdirSync(dirname(b), { recursive: true })
    renameSync(a, b)
    ctx.recordChange({ path: `${toRel(ctx.root, a)} → ${toRel(ctx.root, b)}`, action: 'move', before: toRel(ctx.root, a), after: toRel(ctx.root, b) })
    return { ok: true, output: `Déplacé vers ${toRel(ctx.root, b)}`, summary: 'Déplacé' }
  }
}

/** Commandes en lecture seule exécutables sans confirmation. */
export const SAFE_COMMANDS = [/^git (status|diff|log|branch|show)( |$)/, /^(dir|ls|pwd|where|which|node -v|npm -v|python --version)( |$)/]
const BLOCKED_COMMANDS = [/\bformat\s+[a-z]:/i, /\brm\s+-rf\s+[\/\\]($|\s)/i, /\bdel\s+\/s\s+\/q\s+[a-z]:\\?$/i, /\breg\s+(delete|add)\b/i, /\bshutdown\b/i, /\bbcdedit\b/i, /\bdiskpart\b/i, /\bcipher\s+\/w/i, /\bvssadmin\b/i]

const runCommand: Tool<{ command: string; timeout_s?: number }> = {
  name: 'run_command',
  label: 'Exécution de commande',
  description: 'Exécute une commande dans le terminal, dans le dossier du projet (ex. npm test, python script.py, git status). Sortie limitée.',
  risk: 'exec',
  schema: z.object({ command: z.string().min(1).max(2000), timeout_s: z.number().int().min(1).max(600).optional() }),
  jsonSchema: {
    type: 'object',
    required: ['command'],
    properties: { command: { type: 'string' }, timeout_s: { type: 'integer', description: 'Délai maximal en secondes (défaut 120)' } }
  },
  target: (i) => i.command,
  preview: (i, ctx) => ({ kind: 'command', command: i.command, cwd: ctx.root }),
  run(i, ctx) {
    if (BLOCKED_COMMANDS.some((re) => re.test(i.command))) {
      return Promise.resolve({ ok: false, output: 'Commande bloquée par la politique de sécurité d’AI Studio.', summary: 'Bloquée' })
    }
    return new Promise((resolvePromise) => {
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/key|token|secret|password/i.test(k)))
      const child = spawn(i.command, { cwd: ctx.root, shell: true, windowsHide: true, env })
      let out = ''
      const onData = (d: Buffer) => {
        const s = d.toString('utf8')
        out += s
        ctx.onOutput?.(s)
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      const kill = () => {
        if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        else child.kill('SIGKILL')
      }
      const timer = setTimeout(() => {
        out += '\n[AI Studio] Délai dépassé : commande arrêtée.'
        kill()
      }, (i.timeout_s ?? 120) * 1000)
      ctx.signal.addEventListener('abort', kill, { once: true })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolvePromise({ ok: code === 0, output: clip(`Code de sortie : ${code}\n${out}`), summary: `Code ${code}` })
      })
      child.on('error', (e) => {
        clearTimeout(timer)
        resolvePromise({ ok: false, output: e.message, summary: 'Erreur' })
      })
    })
  }
}

export const TOOLS: Tool<any>[] = [listDir, readFile, search, writeFile, editFile, moveFile, deleteFile, runCommand]
/** Jeu réduit pour les petits modèles (moins de 10 milliards de paramètres actifs). */
export const LIGHT_TOOLS = ['list_dir', 'read_file', 'search', 'write_file', 'edit_file', 'run_command']

export function toolSpecs(light: boolean): ToolSpec[] {
  return TOOLS.filter((t) => !light || LIGHT_TOOLS.includes(t.name)).map((t) => ({ name: t.name, description: t.description, parameters: t.jsonSchema }))
}

export function findTool(name: string): Tool<any> | undefined {
  return TOOLS.find((t) => t.name === name)
}

export function needsApproval(tool: Tool<any>, input: Record<string, unknown>): boolean {
  if (tool.risk === 'read') return false
  if (tool.risk === 'exec') return !SAFE_COMMANDS.some((re) => re.test(String(input.command ?? '').trim()))
  return true
}
