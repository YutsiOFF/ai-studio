/**
 * Modèle 3D chargé dans le visualiseur : normalisation, parties (segmentation
 * réelle), visibilité, couleurs, filaire, textures et exports.
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { buildAdjacency, connectedComponents, growRegion, triangleCount, type Adjacency, type TriMesh } from '@shared/mesh-parts'

export interface Part {
  id: number
  name: string
  src: number
  tris: number[]
  visible: boolean
  color: THREE.Color
  object: THREE.Mesh
}

interface Source {
  mesh: THREE.Mesh
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  tri: TriMesh
  adj?: Adjacency
}

const PALETTE = ['#3ddc97', '#5cb8ff', '#f5b84c', '#f87171', '#c084fc', '#2dd4bf', '#fb923c', '#a3e635', '#f472b6', '#818cf8']

export interface TextureInfo {
  material: string
  slot: string
  url: string
  width: number
  height: number
}

export class SceneModel {
  root = new THREE.Group()
  parts: Part[] = []
  private sources: Source[] = []
  private nextId = 1
  private colorMode = false
  private wire = false
  stats = { triangles: 0, vertices: 0, meshes: 0 }

  static async load(url: string, ext: string): Promise<SceneModel> {
    const e = ext.toLowerCase()
    let obj: THREE.Object3D
    if (e === '.glb' || e === '.gltf') obj = (await new GLTFLoader().loadAsync(url)).scene
    else if (e === '.obj') obj = await new OBJLoader().loadAsync(url)
    else if (e === '.stl') obj = new THREE.Mesh(await new STLLoader().loadAsync(url), new THREE.MeshStandardMaterial({ color: '#c8ccd4', roughness: 0.6 }))
    else if (e === '.ply') {
      const g = await new PLYLoader().loadAsync(url)
      g.computeVertexNormals()
      obj = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: g.hasAttribute('color'), color: g.hasAttribute('color') ? '#ffffff' : '#c8ccd4', roughness: 0.6 }))
    } else throw new Error('Format non pris en charge.')
    const m = new SceneModel()
    m.init(obj)
    return m
  }

  private init(obj: THREE.Object3D): void {
    obj.updateMatrixWorld(true)
    const meshes: THREE.Mesh[] = []
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
    })
    // Chaque maillage est « cuit » dans l'espace monde puis normalisé (centré, taille 2).
    const box = new THREE.Box3()
    for (const mesh of meshes) {
      const g = mesh.geometry.clone()
      g.applyMatrix4(mesh.matrixWorld)
      if (!g.attributes.normal) g.computeVertexNormals()
      const src: Source = {
        mesh,
        geometry: g,
        material: mesh.material,
        tri: { positions: g.attributes.position!.array as ArrayLike<number>, index: g.index ? (g.index.array as ArrayLike<number>) : null }
      }
      this.sources.push(src)
      g.computeBoundingBox()
      box.union(g.boundingBox!)
    }
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const scale = 2 / Math.max(size.x, size.y, size.z, 1e-6)
    const norm = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
    this.sources.forEach((s, i) => {
      s.geometry.applyMatrix4(norm)
      s.tri = { positions: s.geometry.attributes.position!.array as ArrayLike<number>, index: s.geometry.index ? (s.geometry.index.array as ArrayLike<number>) : null }
      const all = Array.from({ length: triangleCount(s.tri) }, (_, k) => k)
      this.addPart(i, all, s.mesh.name || (this.sources.length > 1 ? `Maillage ${i + 1}` : 'Modèle'))
      this.stats.triangles += all.length
      this.stats.vertices += s.geometry.attributes.position!.count
    })
    this.stats.meshes = this.sources.length
  }

  private makeGeometry(src: Source, tris: number[]): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    for (const [name, attr] of Object.entries(src.geometry.attributes)) g.setAttribute(name, attr)
    const idx = new Uint32Array(tris.length * 3)
    const srcIdx = src.geometry.index?.array
    tris.forEach((t, k) => {
      for (let c = 0; c < 3; c++) idx[k * 3 + c] = srcIdx ? srcIdx[t * 3 + c]! : t * 3 + c
    })
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }

  private addPart(srcIdx: number, tris: number[], name: string): Part {
    const src = this.sources[srcIdx]!
    const color = new THREE.Color(PALETTE[(this.nextId - 1) % PALETTE.length]!)
    const object = new THREE.Mesh(this.makeGeometry(src, tris), src.material)
    object.userData.partId = this.nextId
    const part: Part = { id: this.nextId++, name, src: srcIdx, tris, visible: true, color, object }
    this.root.add(object)
    this.parts.push(part)
    this.applyMaterial(part)
    return part
  }

  private setTris(part: Part, tris: number[]): void {
    part.tris = tris
    part.object.geometry.dispose()
    part.object.geometry = this.makeGeometry(this.sources[part.src]!, tris)
  }

  private applyMaterial(p: Part): void {
    if (this.colorMode) {
      p.object.material = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.55, metalness: 0.05, wireframe: this.wire, side: THREE.DoubleSide })
    } else {
      const base = this.sources[p.src]!.material
      p.object.material = base
      for (const m of Array.isArray(base) ? base : [base]) (m as THREE.MeshStandardMaterial).wireframe = this.wire
    }
    p.object.visible = p.visible
  }

  setColorMode(on: boolean): void {
    this.colorMode = on
    this.parts.forEach((p) => this.applyMaterial(p))
  }

  setWireframe(on: boolean): void {
    this.wire = on
    this.parts.forEach((p) => this.applyMaterial(p))
  }

  setVisible(id: number, v: boolean): void {
    const p = this.parts.find((x) => x.id === id)
    if (!p) return
    p.visible = v
    p.object.visible = v
  }

  rename(id: number, name: string): void {
    const p = this.parts.find((x) => x.id === id)
    if (p) p.name = name.slice(0, 60) || p.name
  }

  remove(id: number): void {
    const i = this.parts.findIndex((x) => x.id === id)
    if (i < 0) return
    const p = this.parts[i]!
    this.root.remove(p.object)
    p.object.geometry.dispose()
    this.parts.splice(i, 1)
  }

  /** Sépare chaque partie en pièces physiquement disjointes. Renvoie le nombre de nouvelles parties. */
  splitComponents(): number {
    let created = 0
    for (const p of [...this.parts]) {
      const comps = connectedComponents(this.sources[p.src]!.tri, p.tris)
      if (comps.length <= 1) continue
      this.setTris(p, comps[0]!)
      comps.slice(1).forEach((c, k) => {
        this.addPart(p.src, c, `${p.name} · pièce ${k + 2}`)
        created++
      })
    }
    return created
  }

  /** Extrait une région à partir d'un triangle cliqué (croissance par angle). */
  extractRegion(object: THREE.Object3D, faceIndex: number, angleDeg: number): Part | null {
    const p = this.parts.find((x) => x.object === object)
    if (!p) return null
    const src = this.sources[p.src]!
    src.adj ??= buildAdjacency(src.tri)
    const seed = p.tris[faceIndex]
    if (seed === undefined) return null
    const region = growRegion(src.adj, seed, angleDeg, new Set(p.tris))
    if (region.length === p.tris.length) return null
    const inRegion = new Set(region)
    this.setTris(
      p,
      p.tris.filter((t) => !inRegion.has(t))
    )
    return this.addPart(p.src, region, `Région ${this.nextId}`)
  }

  partOf(object: THREE.Object3D): Part | undefined {
    return this.parts.find((x) => x.object === object)
  }

  /** Copie autonome (sommets compactés) d'une sélection de parties, pour l'export. */
  private exportGroup(ids: number[] | 'visible'): THREE.Group {
    const g = new THREE.Group()
    const parts = this.parts.filter((p) => (ids === 'visible' ? p.visible : ids.includes(p.id)))
    for (const p of parts) {
      const compact = p.object.geometry.toNonIndexed()
      const mesh = new THREE.Mesh(compact, this.sources[p.src]!.material)
      mesh.name = p.name
      g.add(mesh)
    }
    return g
  }

  async export(format: 'glb' | 'obj' | 'stl', ids: number[] | 'visible'): Promise<ArrayBuffer> {
    const group = this.exportGroup(ids)
    if (format === 'glb') {
      const res = await new GLTFExporter().parseAsync(group, { binary: true })
      return res as ArrayBuffer
    }
    if (format === 'obj') return new TextEncoder().encode(new OBJExporter().parse(group)).buffer as ArrayBuffer
    const stl = new STLExporter().parse(group, { binary: true }) as DataView
    return stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength) as ArrayBuffer
  }

  textures(): TextureInfo[] {
    const out: TextureInfo[] = []
    const seen = new Set<THREE.Texture>()
    const slots: [keyof THREE.MeshStandardMaterial, string][] = [
      ['map', 'Couleur'],
      ['normalMap', 'Normales'],
      ['roughnessMap', 'Rugosité'],
      ['metalnessMap', 'Métallique'],
      ['aoMap', 'Occlusion'],
      ['emissiveMap', 'Émissive']
    ]
    for (const s of this.sources) {
      for (const m of Array.isArray(s.material) ? s.material : [s.material]) {
        for (const [key, label] of slots) {
          const tex = (m as THREE.MeshStandardMaterial)[key] as THREE.Texture | null | undefined
          if (!tex || seen.has(tex) || !tex.image) continue
          seen.add(tex)
          const img = tex.image as CanvasImageSource & { width: number; height: number }
          const c = document.createElement('canvas')
          const scale = Math.min(1, 1024 / Math.max(img.width, img.height))
          c.width = Math.max(1, Math.round(img.width * scale))
          c.height = Math.max(1, Math.round(img.height * scale))
          c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
          out.push({ material: m.name || 'Matériau', slot: label, url: c.toDataURL('image/png'), width: img.width, height: img.height })
        }
      }
    }
    return out
  }

  dispose(): void {
    for (const p of this.parts) p.object.geometry.dispose()
    for (const s of this.sources) s.geometry.dispose()
  }
}
