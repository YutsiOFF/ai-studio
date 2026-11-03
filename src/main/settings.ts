import { z } from 'zod'
import type { Settings } from '@shared/types'
import type { Db } from './db'

export const settingsSchema = z.object({
  launchAtStartup: z.boolean(),
  notifications: z.boolean(),
  autoCheckUpdates: z.boolean()
})

export const settingsPatchSchema = settingsSchema.partial().strict()

export const DEFAULT_SETTINGS: Settings = {
  launchAtStartup: false,
  notifications: true,
  autoCheckUpdates: true
}

const KEY = 'app.settings'

export function readSettings(db: Db): Settings {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined
  if (!row) return { ...DEFAULT_SETTINGS }
  try {
    // Fusion avec les valeurs par défaut : un réglage ajouté dans une nouvelle version reçoit sa valeur par défaut.
    const parsed = settingsSchema.partial().safeParse(JSON.parse(row.value))
    return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeSettings(db: Db, patch: unknown): Settings {
  const valid = settingsPatchSchema.parse(patch)
  const next = { ...readSettings(db), ...valid }
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    KEY,
    JSON.stringify(next)
  )
  return next
}
