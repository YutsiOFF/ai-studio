/**
 * Base de données locale (SQLite intégré à Node / Electron via `node:sqlite`).
 * Aucun module natif à compiler : l'installation reste fiable sur tous les PC.
 */
import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

/** Migrations ordonnées. Ne jamais modifier une migration publiée : en ajouter une nouvelle. */
const MIGRATIONS: string[] = [
  `CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );
   CREATE TABLE projects (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     folder TEXT NOT NULL,
     settings TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE UNIQUE INDEX projects_folder ON projects(folder);
   CREATE TABLE activity_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts TEXT NOT NULL,
     type TEXT NOT NULL,
     message TEXT NOT NULL,
     data TEXT
   );
   CREATE INDEX activity_ts ON activity_log(ts);`,
  `CREATE TABLE conversations (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     project_id TEXT,
     model_ref TEXT NOT NULL,
     mode TEXT NOT NULL DEFAULT 'chat',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     meta TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL
   );
   CREATE INDEX messages_conv ON messages(conversation_id, id);
   CREATE TABLE agent_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     run_id TEXT NOT NULL,
     ts TEXT NOT NULL,
     type TEXT NOT NULL,
     data TEXT NOT NULL
   );
   CREATE INDEX agent_events_conv ON agent_events(conversation_id, id);
   CREATE TABLE file_changes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conversation_id TEXT NOT NULL,
     run_id TEXT NOT NULL,
     project_id TEXT NOT NULL,
     path TEXT NOT NULL,
     action TEXT NOT NULL,
     before_content TEXT,
     after_content TEXT,
     status TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE generations (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     project_id TEXT,
     engine TEXT NOT NULL,
     location TEXT NOT NULL,
     prompt TEXT NOT NULL DEFAULT '',
     params TEXT NOT NULL DEFAULT '{}',
     files TEXT NOT NULL DEFAULT '[]',
     created_at TEXT NOT NULL
   );
   CREATE INDEX generations_kind ON generations(kind, created_at);
   CREATE TABLE provider_keys (
     provider_id TEXT PRIMARY KEY,
     enc TEXT,
     extra TEXT NOT NULL DEFAULT '{}',
     enabled INTEGER NOT NULL DEFAULT 1
   );
   CREATE TABLE usage_daily (
     provider_id TEXT NOT NULL,
     day TEXT NOT NULL,
     requests INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (provider_id, day)
   );`
]

export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

export function migrate(db: Db): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  let version = row.user_version
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version]!
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.exec(`PRAGMA user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    version++
  }
}

export function logActivity(db: Db, type: string, message: string, data?: unknown): void {
  db.prepare('INSERT INTO activity_log (ts, type, message, data) VALUES (?, ?, ?, ?)').run(
    new Date().toISOString(),
    type,
    message,
    data === undefined ? null : JSON.stringify(data)
  )
}

export function listActivity(db: Db, limit = 200): { id: number; ts: string; type: string; message: string }[] {
  const safe = Math.min(Math.max(1, Math.floor(limit)), 1000)
  return db
    .prepare('SELECT id, ts, type, message FROM activity_log ORDER BY id DESC LIMIT ?')
    .all(safe) as { id: number; ts: string; type: string; message: string }[]
}
