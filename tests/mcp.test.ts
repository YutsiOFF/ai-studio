import { createServer, type IncomingMessage, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sent: { channel: string; payload: any }[] = []
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }] },
  shell: { trashItem: async () => undefined },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
}))

const { openDatabase } = await import('../src/main/db')
const { ChatService } = await import('../src/main/chat')
const { LocalModels } = await import('../src/main/models')
const { CloudProviders } = await import('../src/main/cloud')
const { McpManager } = await import('../src/main/mcp')

const body = (req: IncomingMessage): Promise<any> =>
  new Promise((r) => {
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', () => r(d ? JSON.parse(d) : {}))
  })

let dir: string
let server: Server
let url: string
let chatCalls: any[] = []

beforeEach(async () => {
  sent.length = 0
  chatCalls = []
  dir = mkdtempSync(join(tmpdir(), 'aistudio-mcp-'))
  server = createServer(async (req, res) => {
    const b = await body(req)
    if (req.url === '/api/show') return void res.end(JSON.stringify({ capabilities: ['completion', 'tools'] }))
    chatCalls.push(b)
    const tools = (b.messages as any[]).filter((m) => m.role === 'tool').length
    const line = (o: unknown) => res.write(JSON.stringify(o) + '\n')
    const luau = b.tools?.find((t: any) => t.function.name.endsWith('__execute_luau'))?.function.name
    const list = b.tools?.find((t: any) => t.function.name.endsWith('__list_roblox_studios'))?.function.name
    if (tools === 0) line({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: list, arguments: {} } }] }, done: false })
    else if (tools === 1) line({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: luau, arguments: { studio_id: 'abc', code: 'print("salut")' } } }] }, done: false })
    else line({ message: { role: 'assistant', content: 'Script exécuté dans Studio.' }, done: false })
    line({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', eval_count: 5, eval_duration: 1e9 })
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterEach(() => {
  server.close()
  rmSync(dir, { recursive: true, force: true })
})

async function waitFor(fn: () => boolean, ms = 20000) {
  const t = Date.now()
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('délai dépassé')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('applications connectées par MCP', () => {
  it('se connecte à un vrai serveur MCP stdio et l’assistant utilise ses outils avec validation', async () => {
    const db = openDatabase(join(dir, 'db.sqlite'))
    const mcp = new McpManager(db, join(dir, 'mcp.json'))
    // Le préréglage Roblox Studio est toujours proposé.
    expect(mcp.list().find((s) => s.preset === 'roblox')).toBeTruthy()
    mcp.add({ label: 'Faux Roblox', command: process.execPath, args: [resolve('tests/fixtures/fake-mcp.mjs')] })
    const id = mcp.list().find((s) => s.label === 'Faux Roblox')!.id
    await mcp.setEnabled(id, true)
    const st = mcp.list().find((s) => s.id === id)!
    expect(st.status).toBe('connected')
    expect(st.tools.find((t) => t.name === 'list_roblox_studios')?.readOnly).toBe(true)
    expect(st.tools.find((t) => t.name === 'execute_luau')?.readOnly).toBe(false)

    const fakeEngine = { ensureRunning: async () => url, status: async () => ({ running: true, baseUrl: url }) } as any
    const chat = new ChatService(db, new LocalModels(db, fakeEngine), new CloudProviders(db), async () => url)
    chat.setMcp(mcp)
    // Mode Discussion, sans projet : les outils MCP sont quand même proposés.
    const conv = chat.create({ modelRef: 'local|ollama|qwen3:8b' })
    const runId = chat.send(conv.id, 'Affiche salut dans Studio')
    await waitFor(() => sent.some((e) => e.payload?.type === 'approval'))
    const approval = sent.find((e) => e.payload?.type === 'approval')!.payload
    // La lecture (list_roblox_studios) n'a pas demandé de validation ; l'exécution de code oui, avec le code affiché.
    expect(approval.preview).toMatchObject({ kind: 'mcp', tool: 'execute_luau', args: 'print("salut")' })
    chat.approve(runId, approval.callId, 'allow')
    await waitFor(() => sent.some((e) => e.payload?.type === 'run-end'))
    expect(sent.find((e) => e.payload?.type === 'run-end')!.payload.status).toBe('done')
    expect(chatCalls[1].messages.some((m: any) => m.role === 'tool' && m.content.includes('studio_id'))).toBe(true)
    expect(chatCalls[2].messages.some((m: any) => m.role === 'tool' && m.content.includes('exécuté (14 caractères)'))).toBe(true)
    expect(chat.get(conv.id).messages.at(-1)?.content).toBe('Script exécuté dans Studio.')
    await mcp.closeAll()
    db.close()
  })
})
