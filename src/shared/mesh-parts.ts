/**
 * Segmentation géométrique réelle (sans IA) d'un maillage triangulé :
 * - composantes connexes (pièces physiquement séparées) ;
 * - sélection de région par croissance tant que l'angle entre faces voisines
 *   reste sous un seuil (ex. lame / garde d'une épée séparées par une arête vive).
 * Fonctions pures sur des tableaux, testées sans moteur 3D.
 */

export interface TriMesh {
  /** Positions x,y,z à plat. */
  positions: ArrayLike<number>
  /** Indices des sommets (3 par triangle). Si absent : triangles non indexés. */
  index?: ArrayLike<number> | null
}

export function triangleCount(m: TriMesh): number {
  return Math.floor((m.index ? m.index.length : m.positions.length / 3) / 3)
}

function vertexOf(m: TriMesh, tri: number, corner: number): number {
  return m.index ? m.index[tri * 3 + corner]! : tri * 3 + corner
}

/** Identifiant de sommet fusionné par position (les maillages ont souvent des sommets dupliqués aux coutures UV). */
export function weldedIds(m: TriMesh, precision = 1e-5): Int32Array {
  const n = m.positions.length / 3
  const ids = new Int32Array(n)
  const map = new Map<string, number>()
  const q = (v: number) => Math.round(v / precision)
  let next = 0
  for (let i = 0; i < n; i++) {
    const key = `${q(m.positions[i * 3]!)},${q(m.positions[i * 3 + 1]!)},${q(m.positions[i * 3 + 2]!)}`
    let id = map.get(key)
    if (id === undefined) {
      id = next++
      map.set(key, id)
    }
    ids[i] = id
  }
  return ids
}

/** Regroupe les triangles en pièces connexes. Renvoie une liste de listes d'indices de triangles, la plus grande en premier. */
export function connectedComponents(m: TriMesh, tris?: number[]): number[][] {
  const weld = weldedIds(m)
  const all = tris ?? Array.from({ length: triangleCount(m) }, (_, i) => i)
  const parent = new Int32Array(weld.length).map((_, i) => i)
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!
      x = parent[x]!
    }
    return x
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  for (const t of all) {
    const a = weld[vertexOf(m, t, 0)]!
    union(a, weld[vertexOf(m, t, 1)]!)
    union(a, weld[vertexOf(m, t, 2)]!)
  }
  const groups = new Map<number, number[]>()
  for (const t of all) {
    const r = find(weld[vertexOf(m, t, 0)]!)
    let g = groups.get(r)
    if (!g) groups.set(r, (g = []))
    g.push(t)
  }
  return [...groups.values()].sort((a, b) => b.length - a.length)
}

function normalOf(m: TriMesh, t: number): [number, number, number] {
  const p = (c: number) => {
    const v = vertexOf(m, t, c)
    return [m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!] as const
  }
  const [a, b, c] = [p(0), p(1), p(2)]
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const n: [number, number, number] = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!]
  const len = Math.hypot(n[0], n[1], n[2]) || 1
  return [n[0] / len, n[1] / len, n[2] / len]
}

export interface Adjacency {
  neighbors: Int32Array[]
  normals: Float32Array
}

/** Voisins de chaque triangle par arête partagée (sommets fusionnés). */
export function buildAdjacency(m: TriMesh): Adjacency {
  const weld = weldedIds(m)
  const count = triangleCount(m)
  const edges = new Map<string, number[]>()
  for (let t = 0; t < count; t++) {
    const v = [weld[vertexOf(m, t, 0)]!, weld[vertexOf(m, t, 1)]!, weld[vertexOf(m, t, 2)]!]
    for (let k = 0; k < 3; k++) {
      const a = v[k]!
      const b = v[(k + 1) % 3]!
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      let list = edges.get(key)
      if (!list) edges.set(key, (list = []))
      list.push(t)
    }
  }
  const tmp: number[][] = Array.from({ length: count }, () => [])
  for (const list of edges.values()) {
    for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) if (i !== j) tmp[list[i]!]!.push(list[j]!)
  }
  const normals = new Float32Array(count * 3)
  for (let t = 0; t < count; t++) normals.set(normalOf(m, t), t * 3)
  return { neighbors: tmp.map((l) => Int32Array.from(new Set(l))), normals }
}

/**
 * Croissance de région depuis un triangle : ajoute les voisins dont l'angle avec
 * la face courante est inférieur à `maxAngleDeg`, limité aux triangles `allowed`.
 */
export function growRegion(adj: Adjacency, seed: number, maxAngleDeg: number, allowed?: Set<number>): number[] {
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180)
  const seen = new Uint8Array(adj.neighbors.length)
  const out: number[] = []
  const stack = [seed]
  seen[seed] = 1
  while (stack.length) {
    const t = stack.pop()!
    out.push(t)
    const nt = adj.neighbors[t]!
    for (let i = 0; i < nt.length; i++) {
      const u = nt[i]!
      if (seen[u] || (allowed && !allowed.has(u))) continue
      const dot = adj.normals[t * 3]! * adj.normals[u * 3]! + adj.normals[t * 3 + 1]! * adj.normals[u * 3 + 1]! + adj.normals[t * 3 + 2]! * adj.normals[u * 3 + 2]!
      if (dot >= cosMax) {
        seen[u] = 1
        stack.push(u)
      }
    }
  }
  return out
}
