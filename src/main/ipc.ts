/**
 * Routeur IPC : seule porte d'entrée de l'interface vers le système.
 * Chaque entrée est validée avant usage.
 */
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { listActivity, logActivity, type Db } from './db'
import { getHardware, getUsage } from './hardware'
import { createProject, getProject, listProjects, removeProject, updateProject } from './projects'
import { readSettings, writeSettings } from './settings'
import { checkForUpdates, getUpdateStatus, installUpdate } from './updater'

const ALLOWED_EXTERNAL = /^https:\/\//i

export function registerIpc(deps: { db: Db; dataPath: string; window: () => BrowserWindow | null }): void {
  const { db, dataPath } = deps

  ipcMain.handle(IPC.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    dataPath,
    isPackaged: app.isPackaged,
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }))
  ipcMain.handle(IPC.appOpenData, async () => {
    await shell.openPath(dataPath)
  })
  ipcMain.handle(IPC.appOpenExternal, async (_e, url: unknown) => {
    const parsed = z.string().url().safeParse(url)
    if (parsed.success && ALLOWED_EXTERNAL.test(parsed.data)) await shell.openExternal(parsed.data)
  })

  ipcMain.handle(IPC.settingsGet, () => readSettings(db))
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: unknown) => {
    const next = writeSettings(db, patch)
    if (app.isPackaged && process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: next.launchAtStartup })
    }
    logActivity(db, 'settings.updated', 'Paramètres modifiés', patch)
    return next
  })

  ipcMain.handle(IPC.hardwareGet, (_e, refresh: unknown) => getHardware(dataPath, refresh === true))
  ipcMain.handle(IPC.hardwareUsage, () => getUsage(dataPath))

  ipcMain.handle(IPC.projectsList, () => listProjects(db))
  ipcMain.handle(IPC.projectsCreate, (_e, input: unknown) => createProject(db, input))
  ipcMain.handle(IPC.projectsUpdate, (_e, input: unknown) => updateProject(db, input))
  ipcMain.handle(IPC.projectsRemove, (_e, id: unknown) => removeProject(db, id))
  ipcMain.handle(IPC.projectsPickFolder, async () => {
    const win = deps.window()
    const options = { title: 'Choisir le dossier du projet', properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.projectsOpenFolder, async (_e, id: unknown) => {
    const parsed = z.string().uuid().safeParse(id)
    const project = parsed.success ? getProject(db, parsed.data) : undefined
    if (!project) return { ok: false, error: 'Projet introuvable.' }
    if (!project.folderExists) return { ok: false, error: "Le dossier n'existe plus." }
    const err = await shell.openPath(project.folder)
    return err ? { ok: false, error: err } : { ok: true, value: true }
  })

  ipcMain.handle(IPC.activityList, (_e, limit: unknown) => listActivity(db, typeof limit === 'number' ? limit : 200))

  ipcMain.handle(IPC.updatesStatus, () => getUpdateStatus())
  ipcMain.handle(IPC.updatesCheck, () => checkForUpdates())
  ipcMain.handle(IPC.updatesInstall, () => installUpdate())
}
