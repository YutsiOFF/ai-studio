import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { logActivity, openDatabase, type Db } from './db'
import { registerIpc } from './ipc'
import { readSettings } from './settings'
import { checkForUpdates, initUpdater } from './updater'

const BG = '#0c0d10'
let mainWindow: BrowserWindow | null = null
let db: Db

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(start)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: BG,
    title: 'AI Studio',
    icon: join(__dirname, '../../resources/icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#a1a1aa', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // Aucune nouvelle fenêtre : les liens https s'ouvrent dans le navigateur par défaut.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Interdit toute navigation hors de l'application.
  win.webContents.on('will-navigate', (e, url) => {
    const current = win.webContents.getURL()
    if (url !== current) e.preventDefault()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function start(): void {
  app.setAppUserModelId('io.github.yutsioff.aistudio')
  const dataPath = app.getPath('userData')
  mkdirSync(dataPath, { recursive: true })
  db = openDatabase(join(dataPath, 'aistudio.db'))
  logActivity(db, 'app.started', `AI Studio ${app.getVersion()} démarré`)

  registerIpc({ db, dataPath, window: () => mainWindow })
  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  initUpdater({
    channel: IPC.updatesEvent,
    window: () => mainWindow,
    notificationsEnabled: () => readSettings(db).notifications
  })
  if (readSettings(db).autoCheckUpdates) {
    setTimeout(() => void checkForUpdates(), 10_000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  try {
    db?.close()
  } catch {
    /* base déjà fermée */
  }
})
