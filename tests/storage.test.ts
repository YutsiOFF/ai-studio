import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listActivity, openDatabase, type Db } from '../src/main/db'
import { createProject, listProjects, removeProject, updateProject } from '../src/main/projects'
import { DEFAULT_SETTINGS, readSettings, writeSettings } from '../src/main/settings'

let dir: string
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aistudio-test-'))
  db = openDatabase(join(dir, 'test.db'))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('base de données', () => {
  it('applique les migrations une seule fois', () => {
    db.close()
    db = openDatabase(join(dir, 'test.db'))
    const v = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(v.user_version).toBe(1)
  })
})

describe('paramètres', () => {
  it('retourne les valeurs par défaut puis enregistre les modifications', () => {
    expect(readSettings(db)).toEqual(DEFAULT_SETTINGS)
    writeSettings(db, { notifications: false })
    expect(readSettings(db).notifications).toBe(false)
    expect(readSettings(db).autoCheckUpdates).toBe(true)
  })
  it('refuse les clés inconnues ou les mauvais types', () => {
    expect(() => writeSettings(db, { hacker: true })).toThrow()
    expect(() => writeSettings(db, { notifications: 'oui' })).toThrow()
  })
})

describe('projets', () => {
  it('crée, modifie et retire un projet sans toucher au dossier', () => {
    const folder = join(dir, 'Mon jeu')
    mkdirSync(folder)
    const r = createProject(db, { name: '  Mon jeu Minecraft ', description: 'Test', folder })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.name).toBe('Mon jeu Minecraft')
    expect(r.value.folderExists).toBe(true)

    const u = updateProject(db, { id: r.value.id, name: 'Renommé' })
    expect(u.ok && u.value.name).toBe('Renommé')

    expect(removeProject(db, r.value.id).ok).toBe(true)
    expect(listProjects(db)).toHaveLength(0)
    // Le dossier existe toujours.
    expect(createProject(db, { name: 'Encore', folder }).ok).toBe(true)
    expect(listActivity(db).map((a) => a.type)).toContain('project.removed')
  })
  it('refuse un dossier inexistant, un nom vide et un dossier déjà utilisé', () => {
    const folder = join(dir, 'p')
    mkdirSync(folder)
    expect(createProject(db, { name: 'X', folder: join(dir, 'nope') }).ok).toBe(false)
    expect(createProject(db, { name: '   ', folder }).ok).toBe(false)
    expect(createProject(db, { name: 'A', folder }).ok).toBe(true)
    const dup = createProject(db, { name: 'B', folder })
    expect(dup.ok).toBe(false)
  })
  it('signale un dossier supprimé du disque', () => {
    const folder = join(dir, 'temp')
    mkdirSync(folder)
    createProject(db, { name: 'T', folder })
    rmSync(folder, { recursive: true })
    expect(listProjects(db)[0]?.folderExists).toBe(false)
  })
})
