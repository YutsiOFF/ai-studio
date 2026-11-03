import { createServer, type IncomingMessage, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sent: { channel: string; payload: any }[] = []
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }] },
  shell: { trashItem: async () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
}))

const { openDatabase } = await import('../src/main/db')
const { createProject } = await import('../src/main/projects')
const { ChatService } = await import('../src/main/chat')
const { LocalModels } = await import('../src/main/models')
const { CloudProviders } = await import('../src/main/cloud')
const { OpenAICompatProvider } = await import('../src/main/providers/openai')

function body(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', () => resolve(d ? JSON.parse(d) : {}))
  })
}

let server: Server
let url: string
let dir: string
let chatCalls: any[] = []

beforeEach(async () => {
  sent.length = 0
  chatCalls = []
  dir = mkdtempSync(join(tmpdir(), 'aistudio-agent-'))
  // Faux serveur Ollama : réponses NDJSON identiques au format de l'API officielle.
  server = createServer(async (req, res) => {
    const b = await body(req)
    if (req.url === '/api/show') {
      res.end(JSON.stringify({ capabilities: ['completion', 'tools'], model_info: { 'qwen3.context_length': 40960 } }))
      return
    }
    if (req.url === '/api/chat') {
      chatCalls.push(b)
      const toolMsgs = (b.messages as any[]).filter((m) => m.role === 'tool').length
      res.setHeader('Content-Type', 'application/x-ndjson')
      const line = (o: unknown) => res.write(JSON.stringify(o) + '\n')
      if (toolMsgs === 0) {
        line({ message: { role: 'assistant', content: 'Je regarde le projet.' }, done: false })
        line({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'list_dir', arguments: {} } }] }, done: false })
      } else if (toolMsgs === 1) {
        line({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'write_file', arguments: { path: 'src/hello.ts', content: 'export const x = 1\n' } } }] }, done: false })
      } else {
        line({ message: { role: 'assistant', content: 'Fichier **créé**.' }, done: false })
      }
      line({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', eval_count: 20, eval_duration: 1e9 })
      res.end()
      return
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterEach(() => {
  server.close()
  rmSync(dir, { recursive: true, force: true })
})

async function waitFor(fn: () => boolean, ms = 5000) {
  const t = Date.now()
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('délai dépassé')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('agent local de bout en bout (API Ollama simulée)', () => {
  it('explore, demande la validation, écrit le fichier, enregistre la modification et permet de l’annuler', async () => {
    const db = openDatabase(join(dir, 'db.sqlite'))
    const folder = join(dir, 'projet')
    mkdirSync(folder)
    const p = createProject(db, { name: 'Test', folder })
    if (!p.ok) throw new Error(p.error)
    const fakeEngine = { ensureRunning: async () => url, status: async () => ({ running: true, baseUrl: url, installed: true, mode: 'external' }) } as any
    const local = new LocalModels(db, fakeEngine)
    const chat = new ChatService(db, local, new CloudProviders(db), async () => url)
    const conv = chat.create({ modelRef: 'local|ollama|qwen3:8b', projectId: p.value.id })
    expect(conv.mode).toBe('agent')

    const runId = chat.send(conv.id, 'Crée src/hello.ts')
    await waitFor(() => sent.some((e) => e.payload?.type === 'approval'))
    const approval = sent.find((e) => e.payload?.type === 'approval')!.payload
    expect(approval.preview).toMatchObject({ kind: 'file', path: 'src/hello.ts', action: 'create', after: 'export const x = 1\n' })
    // Rien n'est écrit avant la validation.
    expect(existsSync(join(folder, 'src', 'hello.ts'))).toBe(false)
    chat.approve(runId, approval.callId, 'allow')

    await waitFor(() => sent.some((e) => e.payload?.type === 'run-end'))
    const end = sent.find((e) => e.payload?.type === 'run-end')!.payload
    expect(end.status).toBe('done')
    expect(readFileSync(join(folder, 'src', 'hello.ts'), 'utf8')).toBe('export const x = 1\n')

    // Les outils ont bien été proposés au modèle et les résultats renvoyés.
    expect(chatCalls[0].tools.map((t: any) => t.function.name)).toContain('write_file')
    expect(chatCalls[1].messages.some((m: any) => m.role === 'tool' && m.tool_name === 'list_dir')).toBe(true)

    const d = chat.get(conv.id)
    expect(d.messages.at(-1)?.content).toBe('Fichier **créé**.')
    expect(d.changes).toHaveLength(1)
    expect(d.events.some((e) => e.type === 'tool-status' && e.data.status === 'done')).toBe(true)

    chat.revertChange(d.changes[0]!.id)
    expect(existsSync(join(folder, 'src', 'hello.ts'))).toBe(false)
    db.close()
  })

  it('un refus de l’utilisateur n’écrit rien et est renvoyé au modèle', async () => {
    const db = openDatabase(join(dir, 'db2.sqlite'))
    const folder = join(dir, 'projet2')
    mkdirSync(folder)
    const p = createProject(db, { name: 'T2', folder })
    if (!p.ok) throw new Error(p.error)
    const fakeEngine = { ensureRunning: async () => url, status: async () => ({ running: true, baseUrl: url }) } as any
    const chat = new ChatService(db, new LocalModels(db, fakeEngine), new CloudProviders(db), async () => url)
    const conv = chat.create({ modelRef: 'local|ollama|qwen3:8b', projectId: p.value.id })
    const runId = chat.send(conv.id, 'go')
    await waitFor(() => sent.some((e) => e.payload?.type === 'approval'))
    chat.approve(runId, sent.find((e) => e.payload?.type === 'approval')!.payload.callId, 'deny')
    await waitFor(() => sent.some((e) => e.payload?.type === 'run-end'))
    expect(existsSync(join(folder, 'src', 'hello.ts'))).toBe(false)
    expect(chatCalls[2].messages.some((m: any) => m.role === 'tool' && /refusé/.test(m.content))).toBe(true)
    db.close()
  })
})

describe('fournisseur Cloud compatible OpenAI (SSE simulé)', () => {
  it('assemble les appels d’outils envoyés en morceaux et lit les limites', async () => {
    const sse = createServer(async (req, res) => {
      await body(req)
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('x-ratelimit-remaining-requests', '42')
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`)
      send({ choices: [{ delta: { content: 'Bon' } }] })
      send({ choices: [{ delta: { content: 'jour' } }] })
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_', arguments: '{"pa' } }] } }] })
      send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'file', arguments: 'th":"a.txt"}' } }] }, finish_reason: 'tool_calls' }] })
      res.write('data: [DONE]\n\n')
      res.end()
    })
    await new Promise<void>((r) => sse.listen(0, '127.0.0.1', () => r()))
    const base = `http://127.0.0.1:${(sse.address() as { port: number }).port}`
    let counted = 0
    const p = new OpenAICompatProvider(
      { id: 't', label: 'Test', badge: 'free', baseUrl: base, keyRequired: true, signupUrl: '', freeFilter: 'all', knownLimits: '', asOf: '', hosting: '', trainsOnFreeData: 'non' },
      'cle',
      {},
      () => counted++
    )
    const events: any[] = []
    for await (const e of p.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }, new AbortController().signal)) events.push(e)
    sse.close()
    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Bonjour')
    expect(events.find((e) => e.type === 'tool-call').call).toMatchObject({ id: 'c1', name: 'read_file', args: { path: 'a.txt' } })
    expect(events.find((e) => e.type === 'rate-limit').remaining).toBe(42)
    expect(counted).toBe(1)
  })
})
