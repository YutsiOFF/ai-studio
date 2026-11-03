import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { IPC, MEDIA_SCHEME } from '@shared/ipc'
import { ChatService } from './chat'
import { CloudProviders } from './cloud'
import { logActivity, openDatabase, type Db } from './db'
import { OllamaEngine } from './engines/ollama'
import { getHardware } from './hardware'
import { ImageEngine } from './images'
import { isInside, registerIpc } from './ipc'
import { LocalModels } from './models'
import { readSettings } from './settings'
import { checkForUpdates, initUpdater } from './updater'

const BG = '#0c0d10'
let mainWindow: BrowserWindow | null = null
let db: Db
let ollama: OllamaEngine | null = null

protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])

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
    width: 1400,
    height: 880,
    minWidth: 1100,
    minHeight: 700,
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
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

function start(): void {
  app.setAppUserModelId('io.github.yutsioff.aistudio')
  const dataPath = app.getPath('userData')
  const outputDir = join(dataPath, 'generations')
  for (const d of ['engines', 'models', 'generations']) mkdirSync(join(dataPath, d), { recursive: true })
  db = openDatabase(join(dataPath, 'aistudio.db'))
  logActivity(db, 'app.started', `AI Studio ${app.getVersion()} démarré`)

  // Fichiers générés servis à l'interface, uniquement depuis le dossier des générations.
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const path = decodeURIComponent(new URL(req.url).pathname.slice(1))
    if (!isInside(outputDir, path)) return new Response('Accès refusé', { status: 403 })
    const res = await net.fetch(pathToFileURL(path).toString())
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, { status: res.status, headers })
  })

  ollama = new OllamaEngine(join(dataPath, 'engines', 'ollama'), join(dataPath, 'models', 'ollama'))
  const models = new LocalModels(db, ollama)
  const cloud = new CloudProviders(db)
  const chat = new ChatService(db, models, cloud, () => ollama!.ensureRunning())
  const images = new ImageEngine(
    db,
    join(dataPath, 'engines', 'sdcpp'),
    join(dataPath, 'models', 'image'),
    outputDir,
    async () => {
      const hw = await getHardware(dataPath)
      return { accelerator: hw.assessment.accelerator, avx2: hw.cpu.simd.avx2 }
    },
    () => models.unloadAll()
  )

  registerIpc({ db, dataPath, outputDir, window: () => mainWindow, ollama, models, cloud, chat, images })
  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  initUpdater({ channel: IPC.updatesEvent, window: () => mainWindow, notificationsEnabled: () => readSettings(db).notifications })
  if (readSettings(db).autoCheckUpdates) setTimeout(() => void checkForUpdates(), 10_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  ollama?.stop()
  try {
    db?.close()
  } catch {
    /* déjà fermée */
  }
})
