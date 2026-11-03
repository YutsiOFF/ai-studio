import { describe, expect, it } from 'vitest'
import { buildAdjacency, connectedComponents, growRegion, triangleCount } from '@shared/mesh-parts'

/** Cube unitaire non indexé (12 triangles), décalé de `dx`. */
function cube(dx: number): number[] {
  const v = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
  ]
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [3, 6, 2], [3, 7, 6],
    [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]
  ]
  return faces.flatMap((f) => f.flatMap((i) => [v[i]![0]! + dx, v[i]![1]!, v[i]![2]!]))
}

describe('segmentation géométrique', () => {
  it('sépare deux pièces disjointes (sommets dupliqués non indexés)', () => {
    const positions = [...cube(0), ...cube(3)]
    const mesh = { positions }
    expect(triangleCount(mesh)).toBe(24)
    const parts = connectedComponents(mesh)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toHaveLength(12)
  })

  it('un seul bloc reste une seule pièce', () => {
    expect(connectedComponents({ positions: cube(0) })).toHaveLength(1)
  })

  it('la croissance de région s’arrête aux arêtes vives', () => {
    const mesh = { positions: cube(0) }
    const adj = buildAdjacency(mesh)
    // Seuil 30° : seule la face plane (2 triangles) est sélectionnée.
    expect(growRegion(adj, 0, 30).sort()).toEqual([0, 1])
    // Seuil 100° : tout le cube (arêtes à 90°).
    expect(growRegion(adj, 0, 100)).toHaveLength(12)
  })

  it('respecte les triangles autorisés', () => {
    const adj = buildAdjacency({ positions: cube(0) })
    expect(growRegion(adj, 0, 180, new Set([0, 1, 4]))).toHaveLength(3)
  })
})
