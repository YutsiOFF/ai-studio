/**
 * Mises à jour automatiques via GitHub Releases (gratuit).
 * Actives uniquement dans la version installée.
 */
import { app, Notification, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

const { autoUpdater } = electronUpdater

let status: UpdateStatus = { state: 'idle' }
let getWindow: () => BrowserWindow | null = () => null
let notify: () => boolean = () => false
let onError: (message: string) => void = () => undefined
let pendingVersion = ''

function set(next: UpdateStatus, channel: string): void {
  status = next
  getWindow()?.webContents.send(channel, status)
}

export function initUpdater(opts: { channel: string; window: () => BrowserWindow | null; notificationsEnabled: () => boolean; onError?: (message: string) => void }): void {
  getWindow = opts.window
  notify = opts.notificationsEnabled
  onError = opts.onError ?? onError
  if (!app.isPackaged) {
    status = { state: 'unsupported', reason: 'Les mises à jour automatiques fonctionnent uniquement dans la version installée.' }
    return
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }, opts.channel))
  autoUpdater.on('update-not-available', () => set({ state: 'none', checkedAt: new Date().toISOString() }, opts.channel))
  autoUpdater.on('update-available', (i) => {
    pendingVersion = i.version
    set({ state: 'available', version: i.version }, opts.channel)
  })
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent), version: pendingVersion }, opts.channel))
  autoUpdater.on('update-downloaded', (i) => {
    set({ state: 'ready', version: i.version }, opts.channel)
    if (notify() && Notification.isSupported()) {
      new Notification({ title: 'AI Studio', body: `La version ${i.version} est prête. Elle sera installée au prochain redémarrage.` }).show()
    }
  })
  autoUpdater.on('error', (e) => {
    const message = e?.message ?? String(e)
    set({ state: 'error', message }, opts.channel)
    onError(message)
  })
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (status.state === 'unsupported') return status
  // Ne relance pas une vérification pendant un téléchargement ou si la mise à jour est prête.
  if (status.state === 'downloading' || status.state === 'ready' || status.state === 'checking') return status
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    status = { state: 'error', message: e instanceof Error ? e.message : String(e) }
  }
  return status
}

export function installUpdate(): void {
  if (status.state === 'ready') autoUpdater.quitAndInstall()
}
