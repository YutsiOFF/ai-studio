/**
 * Connexion OpenRouter en un clic (OAuth PKCE officiel) : le navigateur s'ouvre,
 * l'utilisateur se connecte (Google, GitHub ou e-mail), et la clé arrive directement
 * dans AI Studio, chiffrée par Windows. Aucune clé à copier-coller.
 * https://openrouter.ai/docs/use-cases/oauth-pkce
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { shell } from 'electron'
import { USER_AGENT } from './net'

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const PAGE = (title: string, text: string) => `<!doctype html><meta charset="utf-8"><title>AI Studio</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0c0d10;color:#e8eaf0;font:15px system-ui,sans-serif">
<div style="text-align:center;max-width:420px"><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#9aa0ad;margin:0">${text}</p></div></body>`

export async function openRouterLogin(signal?: AbortSignal): Promise<string> {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  let finish!: (code: string) => void
  let fail!: (e: Error) => void
  const codePromise = new Promise<string>((res, rej) => {
    finish = res
    fail = rej
  })
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    const code = url.searchParams.get('code')
    if (!code || url.searchParams.get('state') !== state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE('Connexion annulée', 'Tu peux fermer cet onglet et réessayer depuis AI Studio.'))
      fail(new Error('Connexion OpenRouter annulée.'))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE('Connecté à OpenRouter', 'Tu peux fermer cet onglet et revenir dans AI Studio.'))
    finish(code)
  })
  // Écoute uniquement sur la boucle locale : aucun autre appareil du réseau ne peut y accéder.
  await new Promise<void>((res, rej) => server.once('error', rej).listen(0, '127.0.0.1', () => res()))
  const port = (server.address() as AddressInfo).port
  const timer = setTimeout(() => fail(new Error('Délai dépassé : la connexion OpenRouter n’a pas été terminée dans le navigateur.')), 5 * 60_000)
  signal?.addEventListener('abort', () => fail(new Error('Connexion annulée.')), { once: true })
  try {
    const callback = `http://localhost:${port}/callback`
    const auth = new URL('https://openrouter.ai/auth')
    auth.searchParams.set('callback_url', callback)
    auth.searchParams.set('code_challenge', challenge)
    auth.searchParams.set('code_challenge_method', 'S256')
    auth.searchParams.set('state', state)
    auth.searchParams.set('key_label', 'AI Studio')
    await shell.openExternal(auth.toString())
    const code = await codePromise
    const r = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' })
    })
    if (!r.ok) throw new Error(`OpenRouter a refusé la connexion (HTTP ${r.status}). ${(await r.text().catch(() => '')).slice(0, 200)}`)
    const { key } = (await r.json()) as { key?: string }
    if (!key) throw new Error('OpenRouter n’a renvoyé aucune clé.')
    return key
  } finally {
    clearTimeout(timer)
    server.close()
  }
}
