/**
 * Effet de génération façon « forge de particules » :
 * 1. analyse : l'image de départ est décomposée en particules colorées, balayées par une ligne de scan ;
 * 2. génération : les particules quittent l'image et tourbillonnent en nuage ;
 * 3. formation : dès que le vrai modèle est reçu, chaque particule rejoint un point de sa surface
 *    (couleur lue dans sa texture), de bas en haut, puis le modèle apparaît.
 * Purement visuel : l'avancement réel est affiché à part, à partir des étapes du moteur.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js'

export type ForgePhase = 'analyzing' | 'generating' | 'forming' | 'fading'

const N = 18000

const vertex = /* glsl */ `
  attribute vec3 color;
  attribute float aSeed;
  uniform float uSize;
  uniform float uTime;
  varying vec3 vColor;
  varying float vSeed;
  void main() {
    vColor = color;
    vSeed = aSeed;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float twinkle = 0.75 + 0.25 * sin(uTime * 3.0 + aSeed * 40.0);
    gl_PointSize = uSize * twinkle * (1.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`
const fragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    vec3 c2 = mix(vColor, vec3(1.0), 0.1) * (0.9 + 0.35 * a);
    gl_FragColor = vec4(c2, a * uOpacity * 0.95);
  }
`

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Points colorés extraits de l'image (fond clair ou transparent ignoré). */
async function samplesFromImage(url: string): Promise<{ pos: Float32Array; col: Float32Array }> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  const S = 160
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  const scale = Math.min(S / img.width, S / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h)
  const data = ctx.getImageData(0, 0, S, S).data
  // Couleur du fond estimée sur le bord de l'image (fond uni clair, sombre ou transparent).
  let br = 0, bg = 0, bb = 0, bn = 0
  const edge = (x: number, y: number) => {
    const o = (y * S + x) * 4
    if (data[o + 3]! < 100) return
    br += data[o]!
    bg += data[o + 1]!
    bb += data[o + 2]!
    bn++
  }
  for (let k = 0; k < S; k++) {
    edge(k, 0)
    edge(k, S - 1)
    edge(0, k)
    edge(S - 1, k)
  }
  const bgc = bn ? [br / bn, bg / bn, bb / bn] : null
  const keep: number[] = []
  for (let i = 0; i < S * S; i++) {
    const r = data[i * 4]!, g = data[i * 4 + 1]!, b = data[i * 4 + 2]!, a = data[i * 4 + 3]!
    if (a < 100) continue
    if (bgc && Math.hypot(r - bgc[0]!, g - bgc[1]!, b - bgc[2]!) < 34) continue
    keep.push(i)
  }
  const pool = keep.length > 200 ? keep : Array.from({ length: S * S }, (_, i) => i)
  const pos = new Float32Array(N * 3)
  const col = new Float32Array(N * 3)
  for (let k = 0; k < N; k++) {
    const i = pool[Math.floor(Math.random() * pool.length)]!
    const x = i % S
    const y = Math.floor(i / S)
    pos[k * 3] = (x / S - 0.5) * 2.2 + (Math.random() - 0.5) * 0.012
    pos[k * 3 + 1] = (0.5 - y / S) * 2.2 + (Math.random() - 0.5) * 0.012
    pos[k * 3 + 2] = (Math.random() - 0.5) * 0.04
    col[k * 3] = data[i * 4]! / 255
    col[k * 3 + 1] = data[i * 4 + 1]! / 255
    col[k * 3 + 2] = data[i * 4 + 2]! / 255
  }
  return { pos, col }
}

/** Sans image (moteur texte → 3D) : un disque lumineux de particules qui servira de matière première. */
function samplesFromText(): { pos: Float32Array; col: Float32Array } {
  const pos = new Float32Array(N * 3)
  const col = new Float32Array(N * 3)
  for (let k = 0; k < N; k++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random()) * 1.1
    pos[k * 3] = Math.cos(a) * r
    pos[k * 3 + 1] = Math.sin(a) * r
    pos[k * 3 + 2] = (Math.random() - 0.5) * 0.05
    const t = Math.random()
    col[k * 3] = 0.24 + t * 0.12
    col[k * 3 + 1] = 0.72 + t * 0.2
    col[k * 3 + 2] = 0.6 + t * 0.4
  }
  return { pos, col }
}

/** Points répartis sur la surface du modèle (proportionnellement à l'aire), couleur lue dans la texture. */
function samplesFromModel(root: THREE.Object3D): { pos: Float32Array; col: Float32Array } {
  const meshes: THREE.Mesh[] = []
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh && m.visible !== false && m.geometry?.attributes.position) meshes.push(m)
  })
  const areas = meshes.map((m) => {
    const g = m.geometry
    const p = g.attributes.position!
    const idx = g.index
    const tri = idx ? idx.count / 3 : p.count / 3
    let area = 0
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
    const step = Math.max(1, Math.floor(tri / 4000))
    for (let t = 0; t < tri; t += step) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
      a.fromBufferAttribute(p, i0)
      b.fromBufferAttribute(p, i1)
      c.fromBufferAttribute(p, i2)
      area += b.sub(a).cross(c.sub(a)).length() * 0.5 * step
    }
    return area
  })
  const total = areas.reduce((s, x) => s + x, 0) || 1
  const pos = new Float32Array(N * 3)
  const col = new Float32Array(N * 3)
  const v = new THREE.Vector3(), n = new THREE.Vector3(), clr = new THREE.Color(), uv = new THREE.Vector2()
  let k = 0
  meshes.forEach((m, mi) => {
    const count = mi === meshes.length - 1 ? N - k : Math.round((areas[mi]! / total) * N)
    if (count <= 0) return
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial
    const base = mat?.color ? mat.color.clone() : new THREE.Color('#c8ccd4')
    let pixels: { data: Uint8ClampedArray; w: number; h: number } | null = null
    const tex = mat?.map
    if (tex?.image && m.geometry.attributes.uv) {
      try {
        const im = tex.image as CanvasImageSource & { width: number; height: number }
        const cw = Math.min(512, im.width), ch = Math.min(512, im.height)
        const cv = document.createElement('canvas')
        cv.width = cw
        cv.height = ch
        const cx = cv.getContext('2d', { willReadFrequently: true })!
        cx.drawImage(im, 0, 0, cw, ch)
        pixels = { data: cx.getImageData(0, 0, cw, ch).data, w: cw, h: ch }
      } catch {
        pixels = null
      }
    }
    const hasVertexColor = Boolean(m.geometry.attributes.color)
    const sampler = new MeshSurfaceSampler(m).build()
    for (let j = 0; j < count && k < N; j++, k++) {
      sampler.sample(v, n, hasVertexColor ? clr : undefined, pixels ? uv : undefined)
      v.applyMatrix4(m.matrixWorld)
      pos.set([v.x, v.y, v.z], k * 3)
      let r = base.r, g = base.g, b = base.b
      if (hasVertexColor) {
        r *= clr.r
        g *= clr.g
        b *= clr.b
      }
      if (pixels) {
        const px = Math.min(pixels.w - 1, Math.max(0, Math.floor((((uv.x % 1) + 1) % 1) * pixels.w)))
        const py = Math.min(pixels.h - 1, Math.max(0, Math.floor((1 - (((uv.y % 1) + 1) % 1)) * pixels.h)))
        const o = (py * pixels.w + px) * 4
        r *= pixels.data[o]! / 255
        g *= pixels.data[o + 1]! / 255
        b *= pixels.data[o + 2]! / 255
      }
      col.set([r, g, b], k * 3)
    }
  })
  return { pos, col }
}

const ACCENT = new THREE.Color('#3ddc97')

export function ParticleForge({ imageUrl, phase, target, onFormed, onFaded }: { imageUrl: string | null; phase: ForgePhase; target: THREE.Object3D | null; onFormed: () => void; onFaded: () => void }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3).fill(0.5), 3).setUsage(THREE.DynamicDrawUsage))
    const seeds = new Float32Array(N)
    for (let i = 0; i < N; i++) seeds[i] = Math.random()
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    return g
  }, [])
  // Coordonnées sphériques indépendantes pour un nuage homogène.
  const sphere = useMemo(() => {
    const a = new Float32Array(N * 2)
    for (let i = 0; i < N; i++) {
      a[i * 2] = Math.random() * Math.PI * 2
      a[i * 2 + 1] = Math.acos(2 * Math.random() - 1)
    }
    return a
  }, [])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uSize: { value: 22 }, uOpacity: { value: 0 }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending
      }),
    []
  )
  const st = useRef({
    img: null as null | { pos: Float32Array; col: Float32Array },
    from: new Float32Array(N * 3),
    fromCol: new Float32Array(N * 3),
    dest: null as null | { pos: Float32Array; col: Float32Array },
    phaseStart: 0,
    lastPhase: '' as string,
    formedSent: false,
    fadedSent: false,
    minY: -1,
    maxY: 1
  })

  useEffect(() => {
    let alive = true
    void (imageUrl ? samplesFromImage(imageUrl) : Promise.resolve(samplesFromText()))
      .then((s) => {
        if (!alive) return
        st.current.img = s
        ;(geom.attributes.position!.array as Float32Array).set(s.pos)
        ;(geom.attributes.color!.array as Float32Array).set(s.col)
        geom.attributes.position!.needsUpdate = true
        geom.attributes.color!.needsUpdate = true
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [imageUrl, geom])

  useEffect(() => {
    if (phase === 'forming' && target) {
      const d = samplesFromModel(target)
      let minY = Infinity, maxY = -Infinity
      for (let i = 0; i < N; i++) {
        const y = d.pos[i * 3 + 1]!
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
      st.current.dest = d
      st.current.minY = minY
      st.current.maxY = maxY
    }
  }, [phase, target])

  useEffect(() => () => {
    geom.dispose()
    mat.dispose()
  }, [geom, mat])

  useFrame((state, dt) => {
    const s = st.current
    const t = state.clock.elapsedTime
    mat.uniforms.uTime!.value = t
    const pos = geom.attributes.position!.array as Float32Array
    const col = geom.attributes.color!.array as Float32Array
    const seeds = geom.attributes.aSeed!.array as Float32Array
    if (s.lastPhase !== phase) {
      s.from.set(pos)
      s.fromCol.set(col)
      s.phaseStart = t
      s.lastPhase = phase
    }
    const e = t - s.phaseStart
    const op = mat.uniforms.uOpacity!
    if (phase === 'fading') {
      op.value = Math.max(0, op.value - dt * 1.4)
      if (op.value <= 0 && !s.fadedSent) {
        s.fadedSent = true
        onFaded()
      }
      return
    }
    op.value = Math.min(1, op.value + dt * 1.5)
    const img = s.img
    if (!img) return

    if (phase === 'analyzing') {
      // Ligne de scan qui parcourt l'image de haut en bas.
      const scan = 1.15 - ((e * 0.55) % 1) * 2.3
      for (let i = 0; i < N; i++) {
        const ix = i * 3
        const y = img.pos[ix + 1]!
        const near = Math.exp(-Math.pow((y - scan) * 16, 2))
        const sd = seeds[i]!
        pos[ix] = img.pos[ix]! + Math.sin(t * 1.3 + sd * 50) * 0.004
        pos[ix + 1] = y + Math.cos(t * 1.1 + sd * 30) * 0.004
        pos[ix + 2] = img.pos[ix + 2]! + near * (0.05 + sd * 0.08)
        col[ix] = img.col[ix]! + (ACCENT.r - img.col[ix]!) * near * 0.6
        col[ix + 1] = img.col[ix + 1]! + (ACCENT.g - img.col[ix + 1]!) * near * 0.6
        col[ix + 2] = img.col[ix + 2]! + (ACCENT.b - img.col[ix + 2]!) * near * 0.6
      }
    } else if (phase === 'generating') {
      // Les particules quittent l'image et s'enroulent en nuage tourbillonnant.
      const m = easeInOut(Math.min(1, e / 2.6))
      for (let i = 0; i < N; i++) {
        const ix = i * 3
        const sd = seeds[i]!
        const theta = sphere[i * 2]! + t * (0.35 + sd * 0.25)
        const phi = sphere[i * 2 + 1]!
        const r = 0.75 + 0.22 * Math.sin(t * 0.9 + sd * 20) + 0.08 * Math.sin(theta * 3 + t)
        const tx = r * Math.sin(phi) * Math.cos(theta)
        const ty = r * Math.cos(phi) * 0.9 + Math.sin(t * 0.6 + sd * 10) * 0.05
        const tz = r * Math.sin(phi) * Math.sin(theta)
        pos[ix] = s.from[ix]! + (tx - s.from[ix]!) * m
        pos[ix + 1] = s.from[ix + 1]! + (ty - s.from[ix + 1]!) * m
        pos[ix + 2] = s.from[ix + 2]! + (tz - s.from[ix + 2]!) * m
        const glow = 0.35 + 0.35 * Math.sin(t * 2 + sd * 12)
        col[ix] = img.col[ix]! * (1 - glow * m) + ACCENT.r * glow * m
        col[ix + 1] = img.col[ix + 1]! * (1 - glow * m) + ACCENT.g * glow * m
        col[ix + 2] = img.col[ix + 2]! * (1 - glow * m) + ACCENT.b * glow * m
      }
    } else if (phase === 'forming' && s.dest) {
      // Construction de bas en haut : chaque particule rejoint son point de surface.
      const span = Math.max(1e-3, s.maxY - s.minY)
      let allDone = true
      for (let i = 0; i < N; i++) {
        const ix = i * 3
        const h = (s.dest.pos[ix + 1]! - s.minY) / span
        const delay = h * 1.1 + seeds[i]! * 0.25
        const p = Math.min(1, Math.max(0, (e - delay) / 1.1))
        if (p < 1) allDone = false
        const k = easeInOut(p)
        const lift = Math.sin(k * Math.PI) * 0.15
        pos[ix] = s.from[ix]! + (s.dest.pos[ix]! - s.from[ix]!) * k
        pos[ix + 1] = s.from[ix + 1]! + (s.dest.pos[ix + 1]! - s.from[ix + 1]!) * k + lift
        pos[ix + 2] = s.from[ix + 2]! + (s.dest.pos[ix + 2]! - s.from[ix + 2]!) * k
        col[ix] = s.fromCol[ix]! + (s.dest.col[ix]! - s.fromCol[ix]!) * k
        col[ix + 1] = s.fromCol[ix + 1]! + (s.dest.col[ix + 1]! - s.fromCol[ix + 1]!) * k
        col[ix + 2] = s.fromCol[ix + 2]! + (s.dest.col[ix + 2]! - s.fromCol[ix + 2]!) * k
      }
      if (allDone && !s.formedSent) {
        s.formedSent = true
        onFormed()
      }
    }
    geom.attributes.position!.needsUpdate = true
    geom.attributes.color!.needsUpdate = true
  })

  return <points geometry={geom} material={mat} frustumCulled={false} />
}
