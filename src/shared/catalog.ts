/**
 * Catalogue embarqué des modèles. Il est versionné avec l'application et peut être
 * remplacé par une version plus récente publiée sur GitHub (catalog/catalog.json),
 * sans republier l'application.
 *
 * Les tailles sont celles annoncées par les dépôts au moment de l'écriture ; la taille
 * exacte est relue sur le registre avant chaque téléchargement. Les capacités
 * (outils, vision) sont « annoncées » ici et VÉRIFIÉES auprès du moteur après installation.
 */

export type LlmUse = 'chat' | 'code' | 'vision' | 'docs'

export interface LlmEntry {
  id: string // tag Ollama
  name: string
  publisher: string
  description: string
  license: string
  commercial: boolean
  paramsB: number
  /** Paramètres actifs par token (modèles MoE). Égal à paramsB pour un modèle dense. */
  activeParamsB: number
  sizeMB: number
  contextK: number
  capabilities: ('tools' | 'vision' | 'thinking')[]
  /** Qualité relative par usage (0–10), issue de benchmarks publics ; sert au classement. */
  quality: Partial<Record<LlmUse, number>>
}

export interface ImageModelFile {
  role: 'model' | 'diffusion' | 'vae' | 'llm'
  repo: string
  path: string
  sizeMB: number
}

export interface ImageEntry {
  id: string
  name: string
  publisher: string
  description: string
  license: string
  commercial: boolean
  files: ImageModelFile[]
  /** VRAM conseillée pour une génération confortable (Mo). */
  recommendedVramMB: number
  /** VRAM minimale avec délestage (Mo). */
  minVramMB: number
  quality: number
  defaults: { width: number; height: number; steps: number; cfg: number; sampler: string }
  extraArgs: string[]
  img2img: boolean
}

export interface Catalog {
  version: number
  updatedAt: string
  llm: LlmEntry[]
  image: ImageEntry[]
}

export const EMBEDDED_CATALOG: Catalog = {
  version: 2,
  updatedAt: '2026-11-04',
  llm: [
    {
      id: 'qwen3:0.6b', name: 'Qwen3 0.6B', publisher: 'Alibaba Qwen',
      description: 'Le plus petit modèle utilisable : idéal pour les PC très modestes, réponses simples.',
      license: 'Apache 2.0', commercial: true, paramsB: 0.6, activeParamsB: 0.6, sizeMB: 523, contextK: 40,
      capabilities: ['tools', 'thinking'], quality: { chat: 2.5, code: 2 }
    },
    {
      id: 'qwen3:1.7b', name: 'Qwen3 1.7B', publisher: 'Alibaba Qwen',
      description: 'Très léger, rapide même sur processeur. Bon pour les questions courtes.',
      license: 'Apache 2.0', commercial: true, paramsB: 1.7, activeParamsB: 1.7, sizeMB: 1400, contextK: 40,
      capabilities: ['tools', 'thinking'], quality: { chat: 4, code: 3.5, docs: 3.5 }
    },
    {
      id: 'qwen3:4b', name: 'Qwen3 4B', publisher: 'Alibaba Qwen',
      description: 'Excellent compromis pour les petites configurations, sait utiliser des outils.',
      license: 'Apache 2.0', commercial: true, paramsB: 4, activeParamsB: 4, sizeMB: 2500, contextK: 40,
      capabilities: ['tools', 'thinking'], quality: { chat: 6, code: 5.5, docs: 5.5 }
    },
    {
      id: 'qwen3:8b', name: 'Qwen3 8B', publisher: 'Alibaba Qwen',
      description: 'Polyvalent et rapide sur une carte de 8 Go. Discussion, code et outils.',
      license: 'Apache 2.0', commercial: true, paramsB: 8.2, activeParamsB: 8.2, sizeMB: 5200, contextK: 40,
      capabilities: ['tools', 'thinking'], quality: { chat: 7, code: 6.5, docs: 6.5 }
    },
    {
      id: 'qwen3:14b', name: 'Qwen3 14B', publisher: 'Alibaba Qwen',
      description: 'Plus fin en raisonnement et en rédaction ; idéal avec 12 Go de mémoire vidéo.',
      license: 'Apache 2.0', commercial: true, paramsB: 14.8, activeParamsB: 14.8, sizeMB: 9300, contextK: 40,
      capabilities: ['tools', 'thinking'], quality: { chat: 8, code: 7.5, docs: 7.5 }
    },
    {
      id: 'qwen3:30b', name: 'Qwen3 30B-A3B', publisher: 'Alibaba Qwen',
      description: 'Modèle « mixture of experts » : qualité d’un gros modèle, vitesse d’un petit. Fonctionne en mode hybride carte graphique + RAM.',
      license: 'Apache 2.0', commercial: true, paramsB: 30.5, activeParamsB: 3.3, sizeMB: 19000, contextK: 256,
      capabilities: ['tools', 'thinking'], quality: { chat: 8.5, code: 8, docs: 8.5 }
    },
    {
      id: 'qwen3-coder:30b', name: 'Qwen3-Coder 30B-A3B', publisher: 'Alibaba Qwen',
      description: 'Spécialisé en programmation et en travail d’agent sur des projets. Mode hybride possible.',
      license: 'Apache 2.0', commercial: true, paramsB: 30.5, activeParamsB: 3.3, sizeMB: 19000, contextK: 256,
      capabilities: ['tools'], quality: { code: 9, chat: 6.5, docs: 7 }
    },
    {
      id: 'gpt-oss:20b', name: 'gpt-oss 20B', publisher: 'OpenAI',
      description: 'Modèle ouvert d’OpenAI, raisonnement et outils, très efficace grâce à son architecture MoE.',
      license: 'Apache 2.0', commercial: true, paramsB: 21, activeParamsB: 3.6, sizeMB: 14000, contextK: 128,
      capabilities: ['tools', 'thinking'], quality: { chat: 8, code: 7.5, docs: 7.5 }
    },
    {
      id: 'gpt-oss:120b', name: 'gpt-oss 120B', publisher: 'OpenAI',
      description: 'Très haut niveau, réservé aux PC avec beaucoup de RAM (64 Go et plus).',
      license: 'Apache 2.0', commercial: true, paramsB: 117, activeParamsB: 5.1, sizeMB: 65000, contextK: 128,
      capabilities: ['tools', 'thinking'], quality: { chat: 9.5, code: 9, docs: 9 }
    },
    {
      id: 'devstral:24b', name: 'Devstral Small 24B', publisher: 'Mistral AI',
      description: 'Modèle européen spécialisé dans les agents de programmation.',
      license: 'Apache 2.0', commercial: true, paramsB: 24, activeParamsB: 24, sizeMB: 14000, contextK: 128,
      capabilities: ['tools'], quality: { code: 8.5, chat: 6.5 }
    },
    {
      id: 'mistral-small3.2:24b', name: 'Mistral Small 3.2 24B', publisher: 'Mistral AI',
      description: 'Modèle européen polyvalent, très bon en français, comprend les images.',
      license: 'Apache 2.0', commercial: true, paramsB: 24, activeParamsB: 24, sizeMB: 15000, contextK: 128,
      capabilities: ['tools', 'vision'], quality: { chat: 8.5, docs: 8, vision: 7, code: 7 }
    },
    {
      id: 'gemma3:4b', name: 'Gemma 3 4B', publisher: 'Google',
      description: 'Léger et capable d’analyser des images.',
      license: 'Gemma Terms of Use', commercial: true, paramsB: 4.3, activeParamsB: 4.3, sizeMB: 3300, contextK: 128,
      capabilities: ['vision'], quality: { chat: 6, vision: 6, docs: 5.5 }
    },
    {
      id: 'gemma3:12b', name: 'Gemma 3 12B', publisher: 'Google',
      description: 'Bonne qualité de rédaction et analyse d’images.',
      license: 'Gemma Terms of Use', commercial: true, paramsB: 12.2, activeParamsB: 12.2, sizeMB: 8100, contextK: 128,
      capabilities: ['vision'], quality: { chat: 7.5, vision: 7.5, docs: 7 }
    },
    {
      id: 'gemma3:27b', name: 'Gemma 3 27B', publisher: 'Google',
      description: 'Le plus capable de la famille Gemma 3, vision incluse.',
      license: 'Gemma Terms of Use', commercial: true, paramsB: 27.4, activeParamsB: 27.4, sizeMB: 17000, contextK: 128,
      capabilities: ['vision'], quality: { chat: 8.5, vision: 8, docs: 8 }
    },
    {
      id: 'qwen3-vl:8b', name: 'Qwen3-VL 8B', publisher: 'Alibaba Qwen',
      description: 'Vision avancée : lecture de documents, captures d’écran, photos.',
      license: 'Apache 2.0', commercial: true, paramsB: 8.8, activeParamsB: 8.8, sizeMB: 6100, contextK: 256,
      capabilities: ['vision', 'tools'], quality: { vision: 8, chat: 7, docs: 7 }
    },
    {
      id: 'llama3.2:3b', name: 'Llama 3.2 3B', publisher: 'Meta',
      description: 'Petit modèle généraliste rapide.',
      license: 'Llama 3.2 Community License', commercial: true, paramsB: 3.2, activeParamsB: 3.2, sizeMB: 2000, contextK: 128,
      capabilities: ['tools'], quality: { chat: 5, code: 4, docs: 5 }
    },
    {
      id: 'deepseek-r1:8b', name: 'DeepSeek-R1 8B', publisher: 'DeepSeek',
      description: 'Raisonnement pas à pas (mathématiques, logique).',
      license: 'MIT', commercial: true, paramsB: 8.2, activeParamsB: 8.2, sizeMB: 5200, contextK: 128,
      capabilities: ['thinking'], quality: { chat: 6.5, code: 6 }
    },
    {
      id: 'gemma3:1b', name: 'Gemma 3 1B', publisher: 'Google',
      description: 'Minuscule et rapide, pour les PC très modestes.',
      license: 'Gemma Terms of Use', commercial: true, paramsB: 1, activeParamsB: 1, sizeMB: 815, contextK: 32,
      capabilities: [], quality: { chat: 3.5 }
    },
    {
      id: 'smollm2:1.7b', name: 'SmolLM2 1.7B', publisher: 'Hugging Face',
      description: 'Très léger, entièrement ouvert, bon pour les tâches simples.',
      license: 'Apache 2.0', commercial: true, paramsB: 1.7, activeParamsB: 1.7, sizeMB: 1800, contextK: 8,
      capabilities: ['tools'], quality: { chat: 3.5 }
    },
    {
      id: 'phi4-mini', name: 'Phi-4 mini 3.8B', publisher: 'Microsoft',
      description: 'Petit modèle très bon en raisonnement et en mathématiques.',
      license: 'MIT', commercial: true, paramsB: 3.8, activeParamsB: 3.8, sizeMB: 2500, contextK: 128,
      capabilities: ['tools'], quality: { chat: 5.5, code: 5, docs: 5.5 }
    },
    {
      id: 'phi4:14b', name: 'Phi-4 14B', publisher: 'Microsoft',
      description: 'Raisonnement solide, rédaction structurée.',
      license: 'MIT', commercial: true, paramsB: 14.7, activeParamsB: 14.7, sizeMB: 9100, contextK: 16,
      capabilities: [], quality: { chat: 7.5, code: 7 }
    },
    {
      id: 'granite3.3:8b', name: 'Granite 3.3 8B', publisher: 'IBM',
      description: 'Fiable pour les documents, les résumés et les outils, licence entreprise permissive.',
      license: 'Apache 2.0', commercial: true, paramsB: 8.2, activeParamsB: 8.2, sizeMB: 4900, contextK: 128,
      capabilities: ['tools'], quality: { chat: 6.5, docs: 7, code: 6 }
    },
    {
      id: 'llama3.1:8b', name: 'Llama 3.1 8B', publisher: 'Meta',
      description: 'Généraliste éprouvé, très bien pris en charge par les outils.',
      license: 'Llama 3.1 Community License', commercial: true, paramsB: 8, activeParamsB: 8, sizeMB: 4900, contextK: 128,
      capabilities: ['tools'], quality: { chat: 6.5, code: 5.5, docs: 6.5 }
    },
    {
      id: 'mistral-nemo:12b', name: 'Mistral NeMo 12B', publisher: 'Mistral AI / NVIDIA',
      description: 'Très bon en français, long contexte, sait utiliser des outils.',
      license: 'Apache 2.0', commercial: true, paramsB: 12.2, activeParamsB: 12.2, sizeMB: 7100, contextK: 128,
      capabilities: ['tools'], quality: { chat: 7, docs: 7, code: 6 }
    },
    {
      id: 'qwen2.5-coder:7b', name: 'Qwen2.5-Coder 7B', publisher: 'Alibaba Qwen',
      description: 'Spécialisé en code, rapide sur une carte de 8 Go.',
      license: 'Apache 2.0', commercial: true, paramsB: 7.6, activeParamsB: 7.6, sizeMB: 4700, contextK: 32,
      capabilities: ['tools'], quality: { code: 7, chat: 5 }
    },
    {
      id: 'qwen2.5-coder:14b', name: 'Qwen2.5-Coder 14B', publisher: 'Alibaba Qwen',
      description: 'Code de bonne qualité, idéal avec 12 Go de mémoire vidéo.',
      license: 'Apache 2.0', commercial: true, paramsB: 14.8, activeParamsB: 14.8, sizeMB: 9000, contextK: 32,
      capabilities: ['tools'], quality: { code: 8, chat: 6 }
    },
    {
      id: 'qwen2.5-coder:32b', name: 'Qwen2.5-Coder 32B', publisher: 'Alibaba Qwen',
      description: 'Le plus fort de sa famille en code, pour les grosses configurations.',
      license: 'Apache 2.0', commercial: true, paramsB: 32.8, activeParamsB: 32.8, sizeMB: 20000, contextK: 32,
      capabilities: ['tools'], quality: { code: 8.7, chat: 7 }
    },
    {
      id: 'qwen3:32b', name: 'Qwen3 32B', publisher: 'Alibaba Qwen',
      description: 'Modèle dense de haut niveau, pour 24 Go de mémoire vidéo.',
      license: 'Apache 2.0', commercial: true, paramsB: 32.8, activeParamsB: 32.8, sizeMB: 20000, contextK: 40,
      capabilities: ['tools', 'thinking'], quality: { chat: 9, code: 8.5, docs: 8.5 }
    },
    {
      id: 'deepseek-r1:14b', name: 'DeepSeek-R1 14B', publisher: 'DeepSeek',
      description: 'Raisonnement pas à pas plus poussé que la version 8B.',
      license: 'MIT', commercial: true, paramsB: 14.8, activeParamsB: 14.8, sizeMB: 9000, contextK: 128,
      capabilities: ['thinking'], quality: { chat: 7.5, code: 7 }
    },
    {
      id: 'qwen2.5vl:7b', name: 'Qwen2.5-VL 7B', publisher: 'Alibaba Qwen',
      description: 'Lecture d’images, de captures d’écran et de documents scannés.',
      license: 'Apache 2.0', commercial: true, paramsB: 8.3, activeParamsB: 8.3, sizeMB: 6000, contextK: 128,
      capabilities: ['vision'], quality: { vision: 7.5, chat: 6 }
    },
    {
      id: 'qwen3-vl:4b', name: 'Qwen3-VL 4B', publisher: 'Alibaba Qwen',
      description: 'Vision compacte pour les cartes de 4 à 6 Go.',
      license: 'Apache 2.0', commercial: true, paramsB: 4.4, activeParamsB: 4.4, sizeMB: 3300, contextK: 256,
      capabilities: ['vision', 'tools'], quality: { vision: 7, chat: 6 }
    }
  ],
  image: [
    {
      id: 'z-image-turbo',
      name: 'Z-Image Turbo',
      publisher: 'Tongyi-MAI (Alibaba)',
      description: 'Très bonne qualité photo en 8 étapes seulement. Fonctionne dès 4 Go de mémoire vidéo grâce au délestage.',
      license: 'Apache 2.0',
      commercial: true,
      files: [
        { role: 'diffusion', repo: 'leejet/Z-Image-Turbo-GGUF', path: 'z_image_turbo-Q4_K.gguf', sizeMB: 3860 },
        { role: 'vae', repo: 'Comfy-Org/z_image_turbo', path: 'split_files/vae/ae.safetensors', sizeMB: 335 },
        { role: 'llm', repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF', path: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf', sizeMB: 2500 }
      ],
      recommendedVramMB: 8192,
      minVramMB: 4096,
      quality: 8.5,
      defaults: { width: 1024, height: 1024, steps: 8, cfg: 1, sampler: 'euler' },
      extraArgs: ['--offload-to-cpu', '--diffusion-fa'],
      img2img: true
    },
    {
      id: 'sdxl-base',
      name: 'Stable Diffusion XL 1.0',
      publisher: 'Stability AI',
      description: 'Référence polyvalente, énorme écosystème de styles. Résolution 1024 × 1024.',
      license: 'CreativeML Open RAIL++-M',
      commercial: true,
      files: [
        { role: 'model', repo: 'stabilityai/stable-diffusion-xl-base-1.0', path: 'sd_xl_base_1.0.safetensors', sizeMB: 6940 },
        { role: 'vae', repo: 'madebyollin/sdxl-vae-fp16-fix', path: 'sdxl_vae.safetensors', sizeMB: 335 }
      ],
      recommendedVramMB: 8192,
      minVramMB: 6144,
      quality: 7,
      defaults: { width: 1024, height: 1024, steps: 25, cfg: 7, sampler: 'euler_a' },
      extraArgs: ['--vae-tiling'],
      img2img: true
    },
    {
      id: 'sd15',
      name: 'Stable Diffusion 1.5',
      publisher: 'Runway / Stability AI',
      description: 'Ancien mais très léger : le seul utilisable confortablement sur petites cartes ou processeur.',
      license: 'CreativeML Open RAIL-M',
      commercial: true,
      files: [{ role: 'model', repo: 'stable-diffusion-v1-5/stable-diffusion-v1-5', path: 'v1-5-pruned-emaonly.safetensors', sizeMB: 4270 }],
      recommendedVramMB: 4096,
      minVramMB: 0,
      quality: 4.5,
      defaults: { width: 512, height: 512, steps: 25, cfg: 7, sampler: 'euler_a' },
      extraArgs: [],
      img2img: true
    }
  ]
}
