/**
 * Fournisseurs Cloud, décrits par configuration (aucun code spécifique).
 * Ajouter un fournisseur compatible OpenAI = ajouter une entrée ici.
 * Les limites sont « connues au » `asOf` et affichées comme telles ; les vraies
 * limites sont lues dans les réponses du fournisseur.
 */

export type ProviderBadge = 'free' | 'free-nokey' | 'trial' | 'paid'

export interface CloudProvider {
  id: string
  label: string
  badge: ProviderBadge
  baseUrl: string
  /** Faux si le fournisseur accepte des appels anonymes. */
  keyRequired: boolean
  signupUrl: string
  /** Paramètre supplémentaire (ex. identifiant de compte Cloudflare) inséré dans l'URL. */
  extraField?: { key: string; label: string; placeholder: string }
  modelsUrl?: string
  /** Filtre des modèles gratuits dans la liste du fournisseur. */
  freeFilter: 'all' | 'openrouter-free' | 'allowlist'
  allowlist?: string[]
  extraHeaders?: Record<string, string>
  /** Valeur envoyée comme clé quand le fournisseur accepte l'accès anonyme mais attend un en-tête Authorization. */
  anonymousKey?: string
  /** Connexion en un clic (OAuth) proposée à la place de la clé à copier. */
  oauth?: 'openrouter'
  knownLimits: string
  asOf: string
  hosting: string
  trainsOnFreeData: 'non' | 'oui' | 'possible' | 'inconnu'
  notes?: string
}

export const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    id: 'ovhcloud', label: 'OVHcloud AI Endpoints', badge: 'free-nokey',
    baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', keyRequired: false,
    signupUrl: 'https://endpoints.ai.cloud.ovh.net/', freeFilter: 'all',
    knownLimits: 'Sans clé : 2 requêtes/min par modèle (Qwen3.5 397B, gpt-oss 120B, Llama 3.3 70B…). Avec clé : 400 requêtes/min.', asOf: '2026-11-04',
    hosting: 'France (UE)', trainsOnFreeData: 'non',
    notes: 'Fonctionne immédiatement, sans compte ni clé.'
  },
  {
    id: 'kilo', label: 'Kilo Gateway (modèles :free)', badge: 'free-nokey',
    baseUrl: 'https://ai-gateway.kilo.ai/api/v1', keyRequired: false,
    signupUrl: 'https://kilo.ai/', freeFilter: 'openrouter-free',
    knownLimits: 'Sans clé : 200 requêtes/heure par adresse IP, modèles gratuits (suffixe :free) uniquement.', asOf: '2026-11-04',
    hosting: 'Variable selon le modèle', trainsOnFreeData: 'possible',
    notes: 'Fonctionne immédiatement, sans compte ni clé. Les modèles gratuits changent souvent.'
  },
  {
    id: 'llm7', label: 'LLM7.io', badge: 'free-nokey',
    baseUrl: 'https://api.llm7.io/v1', keyRequired: false, anonymousKey: 'unused',
    signupUrl: 'https://token.llm7.io/', freeFilter: 'all',
    knownLimits: 'Sans clé : environ 60 requêtes/heure, modèles « turbo » uniquement (DeepSeek V4 Flash, GLM 5.3 Flash, MiniMax M2.7…) ; davantage avec un jeton gratuit.', asOf: '2026-11-04',
    hosting: 'Inconnu', trainsOnFreeData: 'inconnu', notes: 'Service communautaire, sans garantie de disponibilité.'
  },
  {
    id: 'pollinations', label: 'Pollinations.ai', badge: 'free',
    baseUrl: 'https://gen.pollinations.ai/v1', keyRequired: true,
    signupUrl: 'https://enter.pollinations.ai/', freeFilter: 'all',
    knownLimits: 'Clé gratuite (sans carte) ; quotas quotidiens gratuits. Modèles : DeepSeek V4 Flash, Kimi, GLM, Mistral, gpt-oss…', asOf: '2026-11-04',
    hosting: 'Variable selon le modèle', trainsOnFreeData: 'inconnu', notes: 'Accès à DeepSeek V4 Flash gratuitement.'
  },
  {
    id: 'gonka', label: 'Gonka Broker', badge: 'free',
    baseUrl: 'https://proxy.gonkabroker.com/v1', keyRequired: true,
    signupUrl: 'https://gonkabroker.com/', freeFilter: 'all',
    knownLimits: '~1 M tokens/mois gratuits (compte + vérification SMS). DeepSeek V4 Flash, MiniMax, GLM.', asOf: '2026-11-04',
    hosting: 'Réseau décentralisé', trainsOnFreeData: 'inconnu', notes: 'Accès gratuit à DeepSeek V4 Flash.'
  },
  {
    id: 'aion', label: 'Aion Labs', badge: 'free',
    baseUrl: 'https://api.aionlabs.ai/v1', keyRequired: true,
    signupUrl: 'https://www.aionlabs.ai/', freeFilter: 'all',
    knownLimits: '15 req/min, 20 000 tokens/jour, sans carte bancaire.', asOf: '2026-11-04',
    hosting: 'Inconnu', trainsOnFreeData: 'inconnu'
  },
  {
    id: 'vercel', label: 'Vercel AI Gateway', badge: 'free',
    baseUrl: 'https://ai-gateway.vercel.sh/v1', keyRequired: true,
    signupUrl: 'https://vercel.com/ai-gateway', freeFilter: 'all',
    knownLimits: '5 $ de crédits offerts tous les 30 jours avec un compte Vercel gratuit ; des centaines de modèles (DeepSeek, Qwen, Llama, Mistral…).', asOf: '2026-11-04',
    hosting: 'Variable selon le modèle', trainsOnFreeData: 'non', notes: 'Crédits mensuels renouvelés : tant qu’ils durent, les modèles payants sont utilisables gratuitement.'
  },
  {
    id: 'gemini', label: 'Google Gemini (AI Studio)', badge: 'free',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyRequired: true,
    signupUrl: 'https://aistudio.google.com/apikey', freeFilter: 'all',
    knownLimits: 'Variable selon le modèle (ex. Gemini Flash : ~10 req/min, ~250 req/jour). Valeurs exactes dans AI Studio.', asOf: '2026-11-03',
    hosting: 'États-Unis', trainsOnFreeData: 'oui', notes: 'Sur l’offre gratuite, Google peut utiliser les échanges pour améliorer ses produits.'
  },
  {
    id: 'groq', label: 'Groq', badge: 'free',
    baseUrl: 'https://api.groq.com/openai/v1', keyRequired: true,
    signupUrl: 'https://console.groq.com/keys', freeFilter: 'all',
    knownLimits: '~30 req/min ; jusqu’à ~14 400 req/jour sur les petits modèles.', asOf: '2026-11-03',
    hosting: 'États-Unis', trainsOnFreeData: 'non', notes: 'Le plus rapide, idéal pour les agents.'
  },
  {
    id: 'cerebras', label: 'Cerebras', badge: 'free',
    baseUrl: 'https://api.cerebras.ai/v1', keyRequired: true,
    signupUrl: 'https://cloud.cerebras.ai/', freeFilter: 'all',
    knownLimits: '~30 req/min, ~1 M tokens/jour.', asOf: '2026-11-03', hosting: 'États-Unis', trainsOnFreeData: 'inconnu'
  },
  {
    id: 'openrouter', label: 'OpenRouter (modèles :free)', badge: 'free',
    baseUrl: 'https://openrouter.ai/api/v1', keyRequired: true,
    signupUrl: 'https://openrouter.ai/keys', freeFilter: 'openrouter-free', oauth: 'openrouter',
    extraHeaders: { 'HTTP-Referer': 'https://github.com/YutsiOFF/ai-studio', 'X-Title': 'AI Studio' },
    knownLimits: '20 req/min ; 50 req/jour sans achat de crédits.', asOf: '2026-11-03',
    hosting: 'Variable selon le modèle', trainsOnFreeData: 'possible', notes: 'Seuls les modèles gratuits (suffixe :free) sont proposés.'
  },
  {
    id: 'mistral', label: 'Mistral AI (Experiment)', badge: 'free',
    baseUrl: 'https://api.mistral.ai/v1', keyRequired: true,
    signupUrl: 'https://console.mistral.ai/api-keys', freeFilter: 'all',
    knownLimits: 'Quotas mensuels élevés sur l’offre Experiment (vérification téléphone).', asOf: '2026-11-03',
    hosting: 'France (UE)', trainsOnFreeData: 'possible'
  },
  {
    id: 'nvidia', label: 'NVIDIA NIM', badge: 'free',
    baseUrl: 'https://integrate.api.nvidia.com/v1', keyRequired: true,
    signupUrl: 'https://build.nvidia.com/', freeFilter: 'all',
    knownLimits: '~40 req/min tous modèles confondus.', asOf: '2026-11-03', hosting: 'États-Unis', trainsOnFreeData: 'inconnu',
    notes: 'Certains modèles du catalogue ne sont pas appelables avec la clé gratuite.'
  },
  {
    id: 'github', label: 'GitHub Models', badge: 'free',
    baseUrl: 'https://models.github.ai/inference', modelsUrl: 'https://models.github.ai/catalog/models', keyRequired: true,
    signupUrl: 'https://github.com/settings/personal-access-tokens', freeFilter: 'all',
    knownLimits: '15 req/min, 150 à 1 000 req/jour selon le modèle. Jeton GitHub avec la permission « Models ».', asOf: '2026-11-03',
    hosting: 'États-Unis (Azure)', trainsOnFreeData: 'non'
  },
  {
    id: 'cloudflare', label: 'Cloudflare Workers AI', badge: 'free',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1', keyRequired: true,
    signupUrl: 'https://dash.cloudflare.com/profile/api-tokens', freeFilter: 'allowlist',
    allowlist: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/qwen/qwen2.5-coder-32b-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/openai/gpt-oss-20b'],
    extraField: { key: 'accountId', label: 'Identifiant de compte Cloudflare', placeholder: 'ex. 0123456789abcdef…' },
    knownLimits: '~10 000 « neurons » par jour.', asOf: '2026-11-03', hosting: 'Mondial', trainsOnFreeData: 'non'
  },
  {
    id: 'zai', label: 'Z.ai (GLM Flash)', badge: 'free',
    baseUrl: 'https://api.z.ai/api/paas/v4', keyRequired: true,
    signupUrl: 'https://z.ai/manage-apikey/apikey-list', freeFilter: 'allowlist',
    allowlist: ['glm-4.7-flash', 'glm-4.5-flash', 'glm-4.6v-flash'],
    knownLimits: 'Non publiées (console Z.ai). Seuls les modèles Flash gratuits sont proposés.', asOf: '2026-11-03',
    hosting: 'Singapour', trainsOnFreeData: 'non'
  },
  {
    id: 'ollama-cloud', label: 'Ollama Cloud', badge: 'paid',
    baseUrl: 'https://ollama.com/v1', keyRequired: true,
    signupUrl: 'https://ollama.com/settings/keys', freeFilter: 'all',
    knownLimits: 'Plus d’offre gratuite : facturé au token (page Tarifs d’ollama.com, consultée le 4 nov. 2026).', asOf: '2026-11-04', hosting: 'États-Unis', trainsOnFreeData: 'non',
    notes: 'Calcul sur les serveurs d’Ollama : c’est du Cloud, pas du local.'
  },
  {
    id: 'siliconflow', label: 'SiliconFlow', badge: 'free',
    baseUrl: 'https://api.siliconflow.com/v1', keyRequired: true,
    signupUrl: 'https://cloud.siliconflow.com/account/ak', freeFilter: 'all',
    knownLimits: 'Certains modèles gratuits, débit limité.', asOf: '2026-11-03', hosting: 'Chine / Singapour', trainsOnFreeData: 'inconnu'
  },
  {
    id: 'modelscope', label: 'ModelScope', badge: 'free',
    baseUrl: 'https://api-inference.modelscope.cn/v1', keyRequired: true,
    signupUrl: 'https://modelscope.cn/my/myaccesstoken', freeFilter: 'all',
    knownLimits: 'Quota quotidien gratuit (compte Alibaba Cloud requis).', asOf: '2026-11-03', hosting: 'Chine', trainsOnFreeData: 'inconnu'
  },
  {
    id: 'cohere', label: 'Cohere (clé d’essai)', badge: 'free',
    baseUrl: 'https://api.cohere.ai/compatibility/v1', keyRequired: true,
    signupUrl: 'https://dashboard.cohere.com/api-keys', freeFilter: 'all',
    knownLimits: 'Clé d’essai gratuite, usage non commercial, ~1 000 appels/mois.', asOf: '2026-11-03', hosting: 'Canada / États-Unis', trainsOnFreeData: 'inconnu'
  },
  // Crédits d'essai : affichés à part, jamais présentés comme gratuits.
  { id: 'sambanova', label: 'SambaNova', badge: 'trial', baseUrl: 'https://api.sambanova.ai/v1', keyRequired: true, signupUrl: 'https://cloud.sambanova.ai/apis', freeFilter: 'all', knownLimits: 'Crédits d’essai uniques.', asOf: '2026-11-03', hosting: 'États-Unis', trainsOnFreeData: 'inconnu' },
  { id: 'together', label: 'Together AI', badge: 'trial', baseUrl: 'https://api.together.xyz/v1', keyRequired: true, signupUrl: 'https://api.together.ai/settings/api-keys', freeFilter: 'all', knownLimits: 'Crédits d’essai, puis payant.', asOf: '2026-11-03', hosting: 'États-Unis', trainsOnFreeData: 'non' },
  { id: 'nebius', label: 'Nebius AI Studio', badge: 'trial', baseUrl: 'https://api.studio.nebius.com/v1', keyRequired: true, signupUrl: 'https://studio.nebius.com/', freeFilter: 'all', knownLimits: 'Crédits d’essai, puis payant.', asOf: '2026-11-03', hosting: 'UE', trainsOnFreeData: 'non' },
  { id: 'deepseek', label: 'DeepSeek', badge: 'paid', baseUrl: 'https://api.deepseek.com/v1', keyRequired: true, signupUrl: 'https://platform.deepseek.com/api_keys', freeFilter: 'all', knownLimits: 'Payant à l’usage (tarifs bas).', asOf: '2026-11-03', hosting: 'Chine', trainsOnFreeData: 'inconnu' },
  { id: 'hf-router', label: 'Hugging Face Inference Providers', badge: 'paid', baseUrl: 'https://router.huggingface.co/v1', keyRequired: true, signupUrl: 'https://huggingface.co/settings/tokens', freeFilter: 'all', knownLimits: 'Aucun crédit gratuit pour un compte gratuit ; 2 $/mois avec PRO (payant).', asOf: '2026-11-03', hosting: 'Variable', trainsOnFreeData: 'inconnu' }
]

/** Référence de modèle utilisée partout : local (Ollama) ou Cloud. */
export interface ModelRef {
  location: 'local' | 'cloud'
  provider: string // 'ollama' ou id de fournisseur Cloud
  model: string
}

export function refToString(r: ModelRef): string {
  return `${r.location}|${r.provider}|${r.model}`
}

export function refFromString(s: string): ModelRef | null {
  const [location, provider, ...rest] = s.split('|')
  const model = rest.join('|')
  if ((location !== 'local' && location !== 'cloud') || !provider || !model) return null
  return { location, provider, model }
}
