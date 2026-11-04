/**
 * Moteurs de génération 3D gratuits et sans clé : Spaces Hugging Face publics
 * appelés via leur API Gradio. Le quota GPU gratuit (ZeroGPU) est commun à tous :
 * ~2 min/jour sans compte, 5 min/jour avec un compte Hugging Face gratuit.
 */

export type MeshQuality = 'fast' | 'balanced' | 'high'

export interface MeshEngineInfo {
  id: string
  label: string
  publisher: string
  space: string
  license: string
  description: string
  /** Ce que produit le moteur. */
  output: 'textured' | 'geometry' | 'parts'
  options: { texture?: boolean; parts?: boolean; textureSize?: boolean }
  /** Durée GPU indicative par génération (secondes), d'après le Space. */
  gpuSeconds: string
}

export const MESH_ENGINES: MeshEngineInfo[] = [
  {
    id: 'trellis2',
    label: 'TRELLIS.2',
    publisher: 'Microsoft',
    space: 'microsoft/TRELLIS.2',
    license: 'MIT',
    description: 'La meilleure qualité : géométrie fine et textures PBR (couleur, rugosité, métal).',
    output: 'textured',
    options: { textureSize: true },
    gpuSeconds: '60–240 s'
  },
  {
    id: 'trellis',
    label: 'TRELLIS',
    publisher: 'Microsoft',
    space: 'trellis-community/TRELLIS',
    license: 'MIT',
    description: 'Rapide et fiable, modèle texturé. Bon choix par défaut.',
    output: 'textured',
    options: { textureSize: true },
    gpuSeconds: '30–120 s'
  },
  {
    id: 'partcrafter',
    label: 'PartCrafter',
    publisher: 'Wang et al. (NeurIPS 2025)',
    space: 'alexnasa/PartCrafter',
    license: 'MIT',
    description: 'Génère directement le modèle découpé en parties (2 à 16) : idéal pour la segmentation.',
    output: 'parts',
    options: { parts: true },
    gpuSeconds: '75–120 s'
  },
  {
    id: 'triposg',
    label: 'TripoSG',
    publisher: 'VAST (Tripo)',
    space: 'VAST-AI/TripoSG',
    license: 'MIT',
    description: 'Géométrie très précise par l’équipe de Tripo. Texture en option (plus de quota GPU).',
    output: 'geometry',
    options: { texture: true },
    gpuSeconds: '90–210 s'
  },
  {
    id: 'step1x',
    label: 'Step1X-3D',
    publisher: 'StepFun',
    space: 'stepfun-ai/Step1X-3D',
    license: 'Apache 2.0',
    description: 'Formes nettes et symétriques, arêtes vives. Texture en option.',
    output: 'geometry',
    options: { texture: true },
    gpuSeconds: '120–300 s'
  }
]
