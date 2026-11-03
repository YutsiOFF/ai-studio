import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccessDenied, globToRegExp, isSensitive, listTree, resolveInside, searchFiles } from '../src/main/projectfs'

let root: string
let outside: string
beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'aistudio-fs-'))
  root = join(base, 'projet')
  outside = join(base, 'secret')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'x'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(root, 'src', 'main.ts'), 'export const hello = "monde"\nconsole.log(hello)\n')
  writeFileSync(join(root, 'README.md'), '# Projet\n')
  writeFileSync(join(root, 'node_modules', 'x', 'index.js'), 'hello')
  writeFileSync(join(outside, 'mdp.txt'), 'secret')
})
afterEach(() => rmSync(join(root, '..'), { recursive: true, force: true }))

describe('ProjectFS : confinement au dossier du projet', () => {
  it('accepte les chemins internes', () => {
    expect(resolveInside(root, 'src/main.ts')).toContain('main.ts')
    expect(resolveInside(root, 'nouveau/dossier/fichier.txt')).toContain('fichier.txt')
  })
  it('refuse .. , les chemins absolus externes et les liens symboliques sortants', () => {
    expect(() => resolveInside(root, '../secret/mdp.txt')).toThrow(AccessDenied)
    expect(() => resolveInside(root, join(outside, 'mdp.txt'))).toThrow(AccessDenied)
    try {
      symlinkSync(outside, join(root, 'lien'), 'dir')
      expect(() => resolveInside(root, 'lien/mdp.txt')).toThrow(AccessDenied)
    } catch (e) {
      if (!(e instanceof AccessDenied) && (e as NodeJS.ErrnoException).code !== 'EPERM') throw e
    }
  })
  it('protège les fichiers sensibles', () => {
    expect(isSensitive('.env')).toBe(true)
    expect(isSensitive('config/.env.local')).toBe(true)
    expect(isSensitive('id_rsa')).toBe(true)
    expect(isSensitive('src/main.ts')).toBe(false)
  })
  it('liste et recherche en ignorant node_modules', () => {
    const { entries } = listTree(root, root, 3)
    expect(entries.map((e) => e.path)).toContain('src/main.ts')
    expect(entries.some((e) => e.path.includes('node_modules'))).toBe(false)
    const r = searchFiles(root, 'hello', {})
    expect(r.hits.every((h) => !h.path.includes('node_modules'))).toBe(true)
    expect(r.hits[0]).toMatchObject({ path: 'src/main.ts', line: 1 })
    expect(searchFiles(root, 'hello', { glob: '*.md' }).hits).toHaveLength(0)
  })
  it('convertit les motifs glob', () => {
    expect(globToRegExp('**/*.ts').test('src/a/b.ts')).toBe(true)
    expect(globToRegExp('*.ts').test('src/b.ts')).toBe(false)
  })
})
