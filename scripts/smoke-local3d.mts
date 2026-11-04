/**
 * Test réel de l'installation et de l'inférence d'un moteur 3D local, sous Windows (CI),
 * sur processeur. Reprend exactement les recettes de src/main/local3d-spec.ts.
 * Usage : node scripts/smoke-local3d.mts <triposr|triposg> <dossier de travail>
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { LOCAL3D_SPECS, type Local3DEngineId } from '../src/main/local3d-spec.ts'

const engine = process.argv[2] as Local3DEngineId
const root = process.argv[3]!
const spec = LOCAL3D_SPECS[engine]
if (!spec || !root) throw new Error('usage: smoke-local3d.mts <engine> <dir>')

const envDir = join(root, engine)
const py = join(envDir, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const weights = join(root, 'weights', engine)
const env = {
  ...process.env,
  UV_CACHE_DIR: join(root, 'cache', 'uv'),
  HF_HOME: join(root, 'cache', 'hf'),
  U2NET_HOME: join(root, 'cache', 'u2net'),
  PYTHONPATH: join(envDir, 'src'),
  PYTHONIOENCODING: 'utf-8',
  PYTHONUTF8: '1'
}
const sh = (cmd: string, args: string[]) => {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { stdio: 'inherit', env })
}
async function download(url: string, dest: string) {
  mkdirSync(dirname(dest), { recursive: true })
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} ${url}`)
  await pipeline(Readable.fromWeb(r.body as never), createWriteStream(dest))
}

mkdirSync(envDir, { recursive: true })
console.log(`::group::uv + torch + deps (${engine})`)
sh('uv', ['venv', '--python', '3.11', '--seed', join(envDir, 'venv')])
sh('uv', ['pip', 'install', '--python', py, ...spec.torch, '--index-url', 'https://download.pytorch.org/whl/cpu'])
sh('uv', ['pip', 'install', '--python', py, ...spec.torch, ...spec.deps])
console.log('::endgroup::')

console.log('::group::source + correctifs')
const zip = join(envDir, '_dl', 'src.zip')
await download(spec.sourceZip, zip)
const tmp = join(envDir, '_dl', 'src')
mkdirSync(tmp, { recursive: true })
// Même méthode que l'application (tar.exe de Windows, chemin explicite).
sh(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', tmp])
const top = readdirSync(tmp).find((d) => existsSync(join(tmp, d, spec.packageDir)))!
const srcDir = join(envDir, 'src')
rmSync(srcDir, { recursive: true, force: true })
mkdirSync(srcDir, { recursive: true })
renameSync(join(tmp, top, spec.packageDir), join(srcDir, spec.packageDir))
for (const [rel, patch] of Object.entries(spec.patches)) {
  const p = join(srcDir, rel)
  writeFileSync(p, patch(existsSync(p) ? readFileSync(p, 'utf8') : ''))
}
writeFileSync(join(envDir, 'worker.py'), spec.worker)
console.log('::endgroup::')

console.log('::group::poids')
const tree = (await (await fetch(`https://huggingface.co/api/models/${spec.weights.repo}/tree/main?recursive=true`)).json()) as { type: string; path: string; size: number }[]
const files = tree.filter((e) => e.type === 'file' && !/^\.|\/\.|\.(md|png|jpe?g|gif|mp4)$/i.test(e.path)).filter((f) => spec.weights.files === 'all' || spec.weights.files.includes(f.path))
console.log(files.map((f) => `${f.path} ${(f.size / 1e6).toFixed(1)} Mo`).join('\n'))
console.log(`Total : ${(files.reduce((s, f) => s + f.size, 0) / 1e9).toFixed(2)} Go`)
for (const f of files) await download(`https://huggingface.co/${spec.weights.repo}/resolve/main/${f.path}?download=true`, join(weights, ...f.path.split('/')))
console.log('::endgroup::')

console.log('::group::détourage + image de test')
sh(py, ['-c', spec.warmup(weights)])
const img = join(root, 'test.png')
sh(py, ['-c', `from PIL import Image, ImageDraw
im = Image.new("RGB", (512, 512), "white")
d = ImageDraw.Draw(im)
d.ellipse((140, 120, 372, 352), fill=(200, 60, 40))
d.rectangle((226, 330, 286, 440), fill=(90, 60, 30))
im.save(r"${img}")`])
console.log('::endgroup::')

const out = join(root, `${engine}.glb`)
const args =
  engine === 'triposr'
    ? ['--mc', '128']
    : ['--steps', '2', '--dense', '6', '--depth', '7', '--faces', '20000', '--seed', '1']
const t = Date.now()
const r = spawnSync(py, [join(envDir, 'worker.py'), '--image', img, '--out', out, '--weights', weights, '--device', 'cpu', ...args], { env: { ...env, HF_HUB_OFFLINE: '1' }, encoding: 'utf8' })
console.log(r.stdout)
console.log(r.stderr?.slice(-4000))
if (r.status !== 0 || !existsSync(out) || statSync(out).size < 1000) throw new Error(`Échec de l'inférence ${engine} (code ${r.status})`)
console.log(`OK : ${out} (${statSync(out).size} octets) en ${((Date.now() - t) / 1000).toFixed(0)} s`)
