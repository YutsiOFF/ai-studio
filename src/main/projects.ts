/**
 * Gestionnaire de projets. Un projet référence un dossier existant de l'utilisateur ;
 * AI Studio n'écrit rien dans ce dossier à ce stade et ne le supprime jamais.
 */
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { Project, Result } from '@shared/types'
import { logActivity, type Db } from './db'

const nameSchema = z.string().trim().min(1, 'Le nom est obligatoire.').max(80, 'Le nom ne doit pas dépasser 80 caractères.')
const descriptionSchema = z.string().trim().max(500, 'La description ne doit pas dépasser 500 caractères.')

export const createProjectSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.default(''),
  folder: z.string().min(1, 'Choisissez un dossier.')
})

export const updateProjectSchema = z.object({
  id: z.string().uuid(),
  name: nameSchema.optional(),
  description: descriptionSchema.optional()
})

interface Row {
  id: string
  name: string
  description: string
  folder: string
  created_at: string
  updated_at: string
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function toProject(r: Row): Project {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    folder: r.folder,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    folderExists: isDirectory(r.folder)
  }
}

function firstIssue(e: z.ZodError): string {
  return e.issues[0]?.message ?? 'Données invalides.'
}

export function listProjects(db: Db): Project[] {
  const rows = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as unknown as Row[]
  return rows.map(toProject)
}

export function getProject(db: Db, id: string): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as Row | undefined
  return row ? toProject(row) : undefined
}

export function createProject(db: Db, input: unknown): Result<Project> {
  const parsed = createProjectSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  const folder = resolve(parsed.data.folder)
  if (!isDirectory(folder)) return { ok: false, error: "Ce dossier n'existe pas ou n'est pas accessible." }
  const existing = db.prepare('SELECT name FROM projects WHERE folder = ?').get(folder) as { name: string } | undefined
  if (existing) return { ok: false, error: `Ce dossier est déjà utilisé par le projet « ${existing.name} ».` }

  const now = new Date().toISOString()
  const id = randomUUID()
  db.prepare(
    'INSERT INTO projects (id, name, description, folder, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, parsed.data.name, parsed.data.description, folder, now, now)
  logActivity(db, 'project.created', `Projet « ${parsed.data.name} » créé`, { id, folder })
  return { ok: true, value: getProject(db, id)! }
}

export function updateProject(db: Db, input: unknown): Result<Project> {
  const parsed = updateProjectSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }
  const current = getProject(db, parsed.data.id)
  if (!current) return { ok: false, error: 'Projet introuvable.' }
  const name = parsed.data.name ?? current.name
  const description = parsed.data.description ?? current.description
  db.prepare('UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(
    name,
    description,
    new Date().toISOString(),
    current.id
  )
  logActivity(db, 'project.updated', `Projet « ${name} » modifié`, { id: current.id })
  return { ok: true, value: getProject(db, current.id)! }
}

export function removeProject(db: Db, id: unknown): Result<true> {
  const parsedId = z.string().uuid().safeParse(id)
  if (!parsedId.success) return { ok: false, error: 'Identifiant invalide.' }
  const current = getProject(db, parsedId.data)
  if (!current) return { ok: false, error: 'Projet introuvable.' }
  db.prepare('DELETE FROM projects WHERE id = ?').run(current.id)
  logActivity(db, 'project.removed', `Projet « ${current.name} » retiré d'AI Studio (dossier conservé)`, {
    id: current.id,
    folder: current.folder
  })
  return { ok: true, value: true }
}
