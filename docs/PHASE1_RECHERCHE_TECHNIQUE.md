# AI STUDIO — Phase 1 : Recherche technique et choix retenus

*Version 1.1 — 3 novembre 2026 (Cloud étendu à ~20 fournisseurs + système de recommandation selon le PC). Sources consultées listées en fin de document.*

> **Comment lire ce document.** Chaque technologie est classée selon trois statuts :
> - **RETENU** : intégré dans la v1.
> - **OPTIONNEL** : intégré comme module activable par l'utilisateur, avec ses contraintes affichées.
> - **ÉCARTÉ** : non intégré, avec la raison.
>
> Les quotas Cloud changent souvent. Les chiffres ci-dessous sont ceux publiés à la date du document ; l'application ne doit **jamais** les coder en dur comme vérité, mais les afficher comme « limite connue au JJ/MM/AAAA » et lire les vraies limites dans les réponses HTTP (en-têtes, erreurs 429).

---

## 0. Les 6 constats qui changent le plan

1. **Hunyuan3D (2.0, 2.1, 3D-Part / P3-SAM / X-Part) est juridiquement inutilisable en France.** Les licences Tencent excluent explicitement l'Union européenne, le Royaume-Uni et la Corée du Sud (« DOES NOT APPLY IN THE EUROPEAN UNION… »). Toute utilisation dans ces territoires est « unlicensed ». → **ÉCARTÉ**, alors que c'était le meilleur candidat technique pour la 3D et la segmentation.
2. **Toute la génération 3D locale de qualité exige un GPU NVIDIA (CUDA).** Aucun des générateurs étudiés (TripoSR, TripoSG, TRELLIS, TRELLIS.2) n'a de chemin AMD supporté sous Windows. Un PC AMD aura la génération d'images et les LLM locaux, mais **pas de 3D locale**. L'interface doit le dire, pas le cacher.
3. **TRELLIS et TRELLIS.2 ne sont testés officiellement que sous Linux.** TRELLIS : 16 Go VRAM minimum, Windows « not fully tested ». TRELLIS.2 : 24 Go VRAM, Linux uniquement. Ils restent intégrables mais en module « expérimental » sous Windows.
4. **Hugging Face Inference Providers n'est pas gratuit pour un compte gratuit** : la documentation officielle indique que les utilisateurs gratuits n'ont pas de crédits mensuels ; seuls les comptes PRO (payants) reçoivent 2 $/mois. → Ne pas le présenter comme fournisseur gratuit. En revanche **le Hub Hugging Face reste la meilleure source de téléchargement de modèles locaux**, sans compte pour les dépôts non restreints.
5. **Les modèles 3D Stability (Stable Fast 3D, SPAR3D) sont « gated »** : il faut un compte Hugging Face, accepter les conditions et partager ses coordonnées pour télécharger. Cela viole la règle « aucun compte externe ». → OPTIONNEL uniquement, signalé comme tel.
6. **Une segmentation sémantique 3D (lame / garde / poignée) n'existe pas aujourd'hui en version à la fois gratuite, utilisable commercialement, autorisée en France et native Windows.** Le meilleur outil (P3-SAM) est exclu UE ; PartField (NVIDIA) est non commercial ; SAMPart3D (MIT) nécessite un entraînement par objet. La section 6 propose une approche réelle en plusieurs niveaux, sans simuler quoi que ce soit.

---

## 1. IA Cloud gratuites (version étendue)

### 1.1 Trois catégories, jamais mélangées dans l'interface

| Badge AI STUDIO | Définition | Activé par défaut |
|---|---|---|
| **GRATUIT** | Offre gratuite permanente, sans carte bancaire | Oui (proposé à l'onboarding) |
| **GRATUIT SANS CLÉ** | Utilisable sans compte ni clé, avec des limites très basses | Oui (fonctionne dès l'installation) |
| **ESSAI** | Crédits offerts une seule fois, puis payant | Non — section séparée « Crédits d'essai » |
| **PAYANT** | Clé de l'utilisateur, facturation | Non — ajout manuel uniquement |

### 1.2 Fournisseurs de texte / code / agents — gratuits permanents

| # | Fournisseur | Inscription | Limites connues* | Modèles gratuits notables | Compatible OpenAI | Tool calling | Remarques |
|---|---|---|---|---|---|---|---|
| 1 | **Google AI Studio (Gemini)** | Compte Google | Par modèle (ex. Gemini 2.5 Flash : ~10 req/min, ~250 req/jour) ; vraies valeurs visibles dans AI Studio | Gemini Flash / Flash-Lite, Gemma | Oui (point d'accès compatible) | Oui | Contexte jusqu'à 1 M tokens. Free tier : les données peuvent servir à améliorer les produits Google → avertissement |
| 2 | **Groq** | Compte | ~30 req/min ; jusqu'à ~14 400 req/jour sur les petits modèles, moins sur les gros | Llama 3.3 70B, Qwen3, Kimi K2, gpt-oss | Oui | Oui | Le plus rapide ; idéal pour l'agent |
| 3 | **Cerebras** | Compte | ~30 req/min, ~1 M tokens/jour | Llama, Qwen, gpt-oss | Oui | Selon modèle | Très rapide |
| 4 | **OpenRouter** (`:free`) | Compte | 20 req/min ; 50 req/jour (200/jour par modèle selon une source d'avril 2026 — à vérifier au runtime) | 20+ modèles qui changent souvent (Qwen3-Coder, gpt-oss-120b, Llama 3.3 70B, Nemotron…) | Oui | Selon modèle (`supported_parameters`) | Le plus grand choix ; catalogue lu dynamiquement |
| 5 | **Mistral (offre Experiment)** | Compte + vérification téléphone | Quotas mensuels élevés | Mistral Small, Codestral, Mistral Large | Oui | Oui | Européen. Données pouvant servir à l'entraînement sur cette offre |
| 6 | **NVIDIA NIM (build.nvidia.com)** | Compte développeur NVIDIA | ~40 req/min tous modèles confondus, pas de plafond journalier annoncé | Nemotron, Llama 3.1 70B, Qwen3.5, DeepSeek | Oui | Selon modèle | Certains modèles du catalogue ne sont pas appelables avec la clé standard → test automatique |
| 7 | **GitHub Models** | Compte GitHub | Faible (15 req/min, 150–1 000 req/jour selon modèle) | GPT-4.1, modèles Llama, Phi, Mistral… | Oui | Oui | Destiné au prototypage |
| 8 | **Cloudflare Workers AI** | Compte Cloudflare | ~10 000 « neurons »/jour | Llama 4 Scout, Mistral, Qwen… + **images** | Oui (endpoint compatible) | Partiel | Couvre aussi la génération d'images |
| 9 | **Z.ai (Zhipu)** | Compte | Non publiées (console) | GLM-4.7-Flash, GLM-4.5-Flash, **GLM-4.6V-Flash (vision)** | Oui | Oui | Les variantes « FlashX » et GLM-5.3-Flash sont payantes → exclues |
| 10 | **OVHcloud AI Endpoints** | **Aucune** (anonyme) ou clé | Anonyme : **2 req/min par IP et par modèle** ; avec clé : 400 req/min | Qwen3-Coder-30B-A3B, Llama, Mistral, DeepSeek-R1-Distill | Oui | Oui | **Européen (France)**. Seul fournisseur Cloud utilisable **dès l'installation, sans aucun compte** |
| 11 | **Ollama Cloud** | Compte Ollama | Offre gratuite limitée (à vérifier) | Modèles `:cloud` (gros modèles open source) | API Ollama | Oui | Même API que le local, mais **CLOUD** : jamais affiché comme local |
| 12 | **SiliconFlow** | Compte | Modèles gratuits limités en débit | Qwen, DeepSeek, GLM (petites tailles), OCR | Oui | Selon modèle | Hébergeur chinois → avertissement confidentialité |
| 13 | **ModelScope (Alibaba)** | Compte Alibaba | Quota journalier gratuit (à vérifier) | Qwen3.5 et autres | Oui | Selon modèle | Hébergeur chinois |
| 14 | **LLM7.io** | Aucune pour l'usage de base | Faible, non garanti | DeepSeek R1, divers | Oui | Selon modèle | Service communautaire : fiabilité incertaine → OPTIONNEL |
| 15 | **Pollinations.ai** | Clé gratuite (l'accès anonyme semble supprimé — à vérifier) | ~1 req/15 s anonyme historiquement ; quotas « Pollen » | gpt-oss-20b, GLM, DeepSeek… + **images** | Oui | Partiel | Communautaire → OPTIONNEL |
| 16 | **Cohere** | Compte (clé d'essai gratuite) | Clé d'essai limitée, usage non commercial | Command A, Command R+ | Partiel | Oui | Badge « usage non commercial » |
| 17 | **Hugging Face Spaces (ZeroGPU)** | Aucune / compte gratuit | **2 min GPU/jour anonyme, 5 min/jour avec compte gratuit** | Démos publiques de modèles | Non (client Gradio) | Non | Surtout utile pour **images et 3D** (voir 1.4) |

\* Limites publiées à la date du document par le fournisseur ou des sources tierces. AI STUDIO affiche « limite connue au JJ/MM/AAAA » et lit les vraies limites à l'exécution.

### 1.3 Crédits d'essai (affichés à part, jamais présentés comme gratuits)

SambaNova, Nebius AI Studio, Novita, Hyperbolic, Together AI, Fireworks, xAI (carte requise), DeepSeek (payant à bas coût), Hugging Face Inference Providers (0 crédit pour compte gratuit, 2 $/mois en PRO payant). Tous passent par le même adaptateur compatible OpenAI ; l'utilisateur les ajoute s'il le souhaite, avec le badge **ESSAI** ou **PAYANT**.

### 1.4 Cloud gratuit pour les images et la 3D (solution pour les PC sans NVIDIA)

| Usage | Fournisseur | Gratuité | Modèles | Statut |
|---|---|---|---|---|
| Images | **Cloudflare Workers AI** | Quota quotidien gratuit | FLUX.1 schnell, SDXL… | **RETENU** |
| Images | **Pollinations.ai** | Gratuit (clé gratuite) | FLUX et autres | OPTIONNEL |
| Images | **HF Spaces (ZeroGPU)** | 2 min/jour anonyme, 5 min/jour avec compte | FLUX.1 schnell, SDXL, Z-Image… | OPTIONNEL |
| **3D** | **HF Spaces (ZeroGPU)** via client Gradio | 2 min/jour anonyme, 5 min/jour avec compte gratuit | Démos publiques **TRELLIS / TRELLIS.2 / TripoSG / TripoSR** (licences MIT) | **RETENU — mode « 3D Cloud gratuit »** |

Pour la 3D Cloud, une génération TRELLIS prend en général moins d'une minute de GPU : **quelques modèles 3D par jour, sans carte NVIDIA et sans payer**. Limites assumées : ces Spaces sont des démos communautaires qui peuvent changer d'API ou être hors ligne → AI STUDIO vérifie leur état avant de proposer le bouton et prévoit un Space de remplacement. Les Spaces Hunyuan3D sont **exclus** (licence interdite dans l'UE).

### 1.5 Règles d'intégration Cloud retenues

- **Un seul adaptateur « compatible OpenAI »** couvre les fournisseurs 1 à 16 (URL de base + clé facultative). Ajouter un fournisseur = ajouter une entrée dans `providers.json`, sans modifier le code.
- **Catalogue dynamique** : la liste des modèles est lue sur l'endpoint `/models` de chaque fournisseur, filtrée sur la gratuité (prix 0, suffixe `:free`, liste blanche), puis un **test réel** vérifie que le modèle répond et s'il gère les outils.
- **Compteur de quota** par fournisseur et par modèle + lecture des en-têtes `x-ratelimit-*` et des erreurs 429 : « 37 / 50 requêtes aujourd'hui ».
- **Bascule automatique (optionnelle)** : quand un quota est épuisé, l'assistant peut passer au fournisseur gratuit suivant **uniquement parmi ceux que l'utilisateur a autorisés**, car chaque bascule envoie les données à une autre entreprise. Chaque message indique le fournisseur réellement utilisé.
- **Fiche de confidentialité** par fournisseur : pays d'hébergement, usage possible des données pour l'entraînement, conditions commerciales.
- **Assistant d'inscription** : pour chaque fournisseur, un bouton ouvre la page officielle de création de clé, et l'utilisateur colle la clé. AI STUDIO la teste immédiatement. Clés chiffrées avec le coffre de Windows (`safeStorage`).
- **Les clés Cloud ne sont jamais demandées pour utiliser un modèle local.**

---

## 2. IA locales (LLM) — sans API Key, sans compte, sans abonnement

### 2.1 Moteurs

| Moteur | Licence | Redistribuable dans AI STUDIO | Téléchargement sans compte | Points forts | Statut |
|---|---|---|---|---|---|
| **Ollama** | MIT | Oui : archive autonome `ollama-windows-amd64.zip` officiellement prévue « pour l'intégration dans d'autres applications » (+ archives ROCm pour AMD) | Oui (bibliothèque ollama.com) | API locale `localhost:11434` ; `pull` avec progression réelle en flux ; `/api/ps` (modèles chargés, VRAM) ; `/api/show` expose les capacités du modèle (dont `tools`) ; support NVIDIA (pilote ≥ 551.61) et AMD (ROCm v7 ou Vulkan) | **RETENU — moteur principal** |
| **llama.cpp (`llama-server`)** | MIT | Oui (binaires Windows CUDA / Vulkan / CPU) | Oui pour les dépôts GGUF publics de Hugging Face | Contrôle total, n'importe quel GGUF du Hub, API compatible OpenAI, tool calling via les templates de chat | **RETENU — moteur secondaire** (GGUF arbitraires, cas avancés) |
| **LM Studio** | Propriétaire (gratuit) | Non (pas d'embarquement prévu) | Oui | Excellente UI, serveur compatible OpenAI | **OPTIONNEL** — détecté s'il est déjà installé, connexion à son serveur local |
| **HF Transformers** | Apache 2.0 | Oui mais lourd (Python + PyTorch, plusieurs Go) | Oui (hors modèles gated) | Accès à tout | **ÉCARTÉ pour le chat** (trop lourd), utilisé seulement dans le module Python 3D/vision |

**Piège important à gérer :** la bibliothèque Ollama contient aussi des modèles **exécutés dans le cloud** (suffixe `:cloud`). AI STUDIO doit les filtrer ou les marquer CLOUD, sinon on présenterait une IA Cloud comme locale — ce que le cahier des charges interdit.

### 2.2 Fonctionnement « zéro configuration » retenu

1. Au premier lancement, AI STUDIO vérifie si Ollama est déjà installé (port 11434 qui répond, ou exécutable présent).
2. Sinon, il propose de télécharger l'archive officielle Ollama (≈ quelques centaines de Mo + bibliothèques GPU) dans son propre dossier `engines/ollama/`, **sans droits administrateur**, et la lance en processus enfant (`ollama serve`) avec `OLLAMA_MODELS` pointant vers le dossier de données d'AI STUDIO.
3. Le serveur n'écoute que sur `127.0.0.1`. Aucune clé, aucun compte.
4. Arrêt propre du moteur à la fermeture (ou laissé actif si l'utilisateur l'a choisi).
5. Mode hors ligne : une fois les modèles téléchargés, aucune requête externe n'est faite ; l'interface signale explicitement les actions qui nécessitent Internet (téléchargement, mise à jour, Cloud).

### 2.3 Catalogue de départ (à confirmer au moment de figer le catalogue — les sorties évoluent vite)

Le catalogue est un fichier JSON versionné (mis à jour en ligne si disponible, sinon version embarquée). Chaque entrée : nom, moteur, tag/URL, taille de téléchargement, RAM/VRAM estimée par quantification, contexte, licence, capacités **vérifiées** (`tools`, `vision`).

| Usage | Modèles candidats (licence) | Tool calling |
|---|---|---|
| Petit PC (8 Go RAM, pas de GPU) | Qwen3 4B (Apache 2.0), Llama 3.2 3B (Llama Community License), Gemma 3 4B (Gemma Terms) | Qwen3 oui ; vérifier les autres via `/api/show` |
| PC moyen (8–12 Go VRAM) | Qwen3 8B/14B, gpt-oss-20b (Apache 2.0, MoE), Mistral Small (Apache 2.0) | Oui |
| Code / agent | Qwen3-Coder 30B-A3B (Apache 2.0), Devstral Small (Apache 2.0) | Oui |
| Vision | Gemma 3, Qwen2.5-VL / Qwen3-VL | Selon modèle |

**Règle :** la capacité « Agent » n'est affichée que si (a) le moteur rapporte `tools` dans les capacités du modèle **et** (b) un test automatique d'appel d'outil réussit au premier chargement. Sinon : « Chat uniquement ».

### 2.4 Système de recommandation selon le PC (« Analyse de mon PC »)

Objectif : au premier lancement, chaque utilisateur voit **les meilleurs modèles que son PC peut réellement faire tourner**, par usage, installables en un clic. Les recommandations sont recalculées si le matériel change.

#### a) Détection du matériel (réelle, sans estimation inventée)

| Élément | Méthode sous Windows | Pourquoi |
|---|---|---|
| CPU : modèle, cœurs, AVX2/AVX-512 | `systeminformation` + drapeaux CPU | Choix du binaire llama.cpp / sd.cpp et vitesse CPU |
| RAM totale / libre, type DDR4/DDR5 | `systeminformation` | Modèles en CPU ou en mode hybride |
| GPU NVIDIA : modèle, VRAM, pilote, compute capability | `nvidia-smi --query-gpu=...` | CUDA, 3D locale |
| GPU AMD / Intel : modèle, VRAM dédiée | API **DXGI** (`DedicatedVideoMemory`) ou clé registre `HardwareInformation.qwMemorySize` | **Ne pas utiliser `Win32_VideoController.AdapterRAM`, plafonné à 4 Go** (bug connu) |
| GPU intégré ou dédié, portable (batterie) | DXGI + état de la batterie | Éviter de recommander un modèle trop gourmand sur batterie |
| Disque libre sur le dossier des modèles | `fs.statfs` | Bloquer un téléchargement qui ne rentrerait pas |

Choix du moteur d'accélération : NVIDIA → CUDA ; AMD → ROCm si la carte est supportée, sinon Vulkan ; Intel Arc → Vulkan ; aucun GPU → CPU.

#### b) Budget mémoire utilisable

- **VRAM utilisable** = VRAM dédiée − 1,2 Go (affichage Windows, navigateur) − VRAM déjà occupée mesurée.
- **RAM utilisable** = RAM totale − 4 Go (système) − marge de 10 %.

#### c) Estimation de la mémoire d'un modèle (calculée, pas devinée)

Pour un modèle GGUF, les métadonnées sont lues directement dans l'en-tête du fichier (accessible sur Hugging Face sans compte, ou fournies par Ollama) :

```
mémoire ≈ taille des poids (taille exacte du fichier)
        + cache KV = 2 × nb_couches × contexte × nb_têtes_KV × dim_tête × octets
        + surcoût moteur (~0,5 Go)
```

Le contexte par défaut est adapté à la mémoire (8k, 16k, 32k…) : AI STUDIO réduit le contexte avant de déclasser un modèle.

#### d) Classement de faisabilité de chaque modèle

| Badge | Condition | Vitesse attendue |
|---|---|---|
| **Recommandé** | Meilleur score de qualité parmi les modèles « Rapide » pour cet usage | — |
| **Rapide** | Tout tient en VRAM | Élevée |
| **Hybride** | Une partie en VRAM, le reste en RAM (llama.cpp / Ollama gèrent le délestage, y compris les experts MoE en CPU) | Moyenne |
| **Lent (CPU)** | Tient en RAM uniquement | Faible |
| **Trop lourd** | Ne tient ni en VRAM ni en RAM | — (installation déconseillée, avec explication) |

Chaque badge affiche sa justification en clair : *« Nécessite 9,8 Go ; vous avez 7,0 Go de VRAM utilisable → mode hybride. »*

**Vitesse estimée** (tokens/s) ≈ bande passante mémoire ÷ octets lus par token (paramètres **actifs** × bits / 8). Les modèles MoE (gpt-oss, Qwen3-30B-A3B…) sont donc favorisés sur les PC avec beaucoup de RAM et peu de VRAM. La bande passante vient d'une table des GPU courants (fallback : estimation selon DDR4/DDR5). Après installation, **un micro-test réel** mesure la vraie vitesse, qui remplace l'estimation dans l'interface.

#### e) Choix automatique de la quantification

Pour chaque modèle, AI STUDIO choisit la meilleure quantification qui rentre : Q8_0 → Q6_K → Q5_K_M → **Q4_K_M (minimum recommandé)** → Q3_K_M (uniquement pour ≥ 14B, avec avertissement de qualité). Si un modèle plus petit en Q6 est meilleur qu'un gros en Q3, c'est le petit qui est recommandé.

#### f) Score final et « Pack recommandé »

Pour chaque usage (Discussion, Code / Agent, Vision, Documents longs, Images, 3D) :

`score = qualité du modèle (catalogue, issue de benchmarks publics) × facteur de faisabilité (Rapide 1,0 / Hybride 0,7 / Lent 0,3) × bonus capacités vérifiées (outils pour Agent)`

L'onboarding affiche une carte « Ton PC » puis un **Pack recommandé** : un modèle par usage, taille totale du téléchargement, bouton « Tout installer ». L'utilisateur peut tout changer.

#### g) Exemples de recommandations par profil (catalogue indicatif, à figer lors du développement)

| Profil | Discussion | Code / Agent | Images | 3D |
|---|---|---|---|---|
| **0 — PC bureautique** : 8 Go RAM, pas de GPU dédié | Qwen3 4B Q4 (lent mais utilisable) | Qwen3 4B (outils) + **Cloud gratuit conseillé** | SD 1.5 / SD-Turbo CPU (lent) ou **Cloud** | **Cloud gratuit (HF Spaces)** |
| **1 — 16 Go RAM, GPU 4–6 Go** | Qwen3 8B Q4 | Qwen3 8B | SDXL Turbo / FLUX.2 klein 4B quantifié | TripoSR (NVIDIA) ou Cloud |
| **2 — 16–32 Go RAM, GPU 8 Go** | Qwen3 8B Q6 / gpt-oss-20b hybride | Qwen3-Coder 30B-A3B hybride | FLUX.1 schnell GGUF Q4, SDXL | TripoSR, TripoSG (NVIDIA) |
| **3 — 32 Go RAM, GPU 12 Go** | Qwen3 14B Q4–Q5 | Qwen3-Coder 30B-A3B / Devstral Small hybride | FLUX.1 schnell Q8, Z-Image Turbo | TripoSG ; TRELLIS en Cloud |
| **4 — 32–64 Go RAM, GPU 16 Go** | Mistral Small / Qwen3 14B Q8 | Devstral Small, Qwen3-Coder 30B-A3B | FLUX complet | **TRELLIS** local |
| **5 — 64 Go+ RAM, GPU 24 Go+** | gpt-oss-120b hybride, Qwen3 32B | Qwen3-Coder 30B-A3B Q8 | Tout | **TRELLIS.2** (WSL2) |

AMD : même logique pour le texte et les images (Vulkan) ; pour la 3D, **toujours le mode Cloud gratuit**, puisque les générateurs 3D locaux exigent CUDA.

#### h) Catalogue

- Fichier `catalog.json` versionné et signé, hébergé gratuitement (GitHub Releases), mis à jour au démarrage si Internet est disponible ; une copie est embarquée pour le mode hors ligne.
- Chaque entrée : moteur, source (tag Ollama ou dépôt GGUF Hugging Face public), tailles par quantification, nombre de paramètres totaux / actifs, contexte, licence, capacités **vérifiées**, score de qualité par usage.
- Les nouveaux modèles sortent chaque mois : le catalogue peut être mis à jour sans republier l'application.


---

## 3. Génération d'images

| Solution | Licence | Python requis | AMD | Points forts | Statut |
|---|---|---|---|---|---|
| **stable-diffusion.cpp** | MIT | **Non** (binaire C++) | Oui (Vulkan) | SD1.5, SDXL, SD3.5, FLUX.1, FLUX.2, Z-Image, Qwen-Image ; formats GGUF quantifiés (VRAM réduite) ; img2img ; mode serveur ; binaires précompilés | **RETENU — moteur principal** |
| **ComfyUI** | GPL-3.0 | Oui | Partiel | Le plus puissant (workflows, ControlNet, inpainting avancé), API locale | **OPTIONNEL** — connecteur vers une installation ComfyUI existante ou installée à la demande |
| **Diffusers (HF)** | Apache 2.0 | Oui | Faible sous Windows | Référence Python | **ÉCARTÉ en v1** (redondant avec les deux autres) |

### Modèles d'image : licences (point crucial)

| Modèle | Licence | Usage commercial | Remarque |
|---|---|---|---|
| **FLUX.1 schnell** | Apache 2.0 | Oui | Rapide (peu d'étapes) — **par défaut « qualité »** |
| **FLUX.2 klein 4B** | Apache 2.0 | Oui | Seule variante FLUX.2 en Apache 2.0 ; léger |
| **Z-Image Turbo** | Apache 2.0 (à reconfirmer sur la fiche du modèle) | Oui | Très bon rapport qualité/VRAM |
| **SDXL 1.0** | CreativeML Open RAIL++-M | Oui (avec règles d'usage) | Énorme écosystème (LoRA, styles) ; tourne sur 6–8 Go |
| FLUX.1 dev, FLUX.2 dev, FLUX.2 klein 9B | FLUX Non-Commercial | **Non** | Proposés avec badge « Non commercial » |
| SD 3.5 | Stability Community License | Oui sous 1 M$ de CA | Téléchargement gated (compte HF) → OPTIONNEL |

Les fonctions demandées (prompt, image de référence/img2img, variantes via seeds, résolution, paramètres, historique) sont toutes couvertes par stable-diffusion.cpp. L'**inpainting** et l'édition fine passent par ComfyUI (optionnel) — à afficher comme tel tant que non disponible dans le moteur principal.

---

## 4. Génération 3D

### 4.1 Comparatif des générateurs

| Modèle | Licence | VRAM min. | Windows | Entrée | Sortie / textures | Qualité | Statut |
|---|---|---|---|---|---|---|---|
| **TripoSR** (VAST / Stability) | MIT | ~6 Go | Oui (Python) | 1 image | Maillage + couleurs de sommets | Basique, très rapide | **RETENU — niveau « Rapide »** |
| **TripoSG** (VAST) | MIT | 8 Go | Non documenté (Python/conda) | 1 image (+ variante croquis + texte) | GLB géométrie seule (pas de texture) | Géométrie haute qualité | **RETENU — niveau « Géométrie précise »** |
| **TRELLIS** (Microsoft) | MIT (sous-modules à licences propres) | 16 Go | « Not fully tested » | Image (recommandé) ou **texte** | GLB texturé, Gaussians (PLY) | Très bonne | **RETENU — niveau « Qualité », marqué expérimental sous Windows** |
| **TRELLIS.2** (Microsoft) | MIT | **24 Go** | **Linux uniquement** | Image | GLB PBR complet | Excellente, proche commercial | **OPTIONNEL** (cartes 24 Go, via WSL2) |
| Stable Fast 3D / SPAR3D | Stability Community License | ~6–8 Go | Oui | Image | GLB texturé UV | Bonne, rapide | **OPTIONNEL** — compte HF obligatoire (gated) |
| InstantMesh | (à vérifier) | élevé | Non documenté | Image (multi-vues) | Maillage texturé | Bonne | **ÉCARTÉ v1** — dépassé par TRELLIS |
| **Hunyuan3D 2.x** | Tencent Community License | 6–16 Go | Oui | Image | GLB texturé | Excellente | **ÉCARTÉ — interdit dans l'UE/France** |
| Tripo AI | Propriétaire, payant | — | — | — | — | Référence | **ÉCARTÉ** (référence UX uniquement) |

### 4.2 Texte → 3D

Retenu : **pipeline en deux étapes**, comme le font les services commerciaux : prompt → image (stable-diffusion.cpp, vue de face sur fond neutre) → image → 3D. TRELLIS-text existe mais la documentation officielle recommande elle-même l'image-vers-3D pour de meilleurs résultats. L'utilisateur voit et peut régénérer l'image intermédiaire avant de lancer la 3D.

### 4.3 Multi-images

TRELLIS accepte plusieurs vues d'un même objet (mode multi-image, expérimental). C'est le seul générateur retenu à le permettre ; le bouton n'apparaît que pour lui.

### 4.4 Progression réelle

Les générateurs Python ne publient pas de pourcentage natif. Le module 3D émettra les **étapes réelles** du pipeline (suppression de fond → encodage → échantillonnage avec numéro de pas → extraction du maillage → texture → export), via un flux d'événements (WebSocket/SSE). Pas de barre inventée.

### 4.5 Visualiseur 3D

**Three.js + React Three Fiber + drei** (retenu) : orbite/zoom/pan, environnements HDR et lumières réglables, mode filaire, inspection des textures (affichage des cartes base color / roughness / metallic), sélection de faces via **three-mesh-bvh** (indispensable pour la segmentation et les gros maillages). Rendu dans un composant isolé pour qu'un modèle lourd ne bloque pas l'interface ; chargement GLB dans un Web Worker quand possible.

### 4.6 Export

| Format | Outil | Statut |
|---|---|---|
| GLB / GLTF | Natif (générateurs + `trimesh`) | Oui |
| OBJ (+ MTL) | `trimesh` | Oui |
| PLY / STL | `trimesh` | Oui (bonus impression 3D) |
| **FBX** | Pas d'exporteur FBX libre fiable en Python ; option : **Blender en ligne de commande** (GPL, gratuit) si présent ou téléchargé à la demande, ou SDK Autodesk FBX (gratuit mais propriétaire) | **OPTIONNEL** — « nécessite Blender » affiché clairement |

---

## 5. Exigences matérielles résumées

| Fonction | Minimum | Confortable |
|---|---|---|
| Chat local | 8 Go RAM, CPU seul (modèles 3–4B) | GPU 8–12 Go VRAM |
| Images (SDXL / FLUX quantifié) | GPU 6–8 Go (NVIDIA ou AMD via Vulkan) | 12 Go+ |
| 3D Rapide (TripoSR) | NVIDIA 6 Go | 8 Go |
| 3D Qualité (TRELLIS) | NVIDIA 16 Go | 24 Go |
| 3D Premium (TRELLIS.2) | NVIDIA 24 Go + WSL2 | — |
| Disque | 20 Go | 100 Go+ (modèles) |

---

## 6. Segmentation 3D — l'approche honnête

### 6.1 État de l'art vérifié

| Outil | Ce qu'il fait | Licence | Utilisable ici ? |
|---|---|---|---|
| **P3-SAM + X-Part** (Tencent, Hunyuan3D-Part) | Segmentation sémantique native + reconstruction de pièces complètes | Tencent, **exclut l'UE** | **Non** (France) |
| **PartField** (NVIDIA) | Champ de caractéristiques par partie, arbre hiérarchique de parties sur maillage (OBJ/GLB) | NVIDIA License, **non commercial (recherche/éducation)** | **OPTIONNEL** — usage personnel/éducatif seulement, badge explicite |
| **SAMPart3D** | Segmentation sémantique multi-granularité | MIT | Techniquement oui, mais **entraînement par objet** + Blender → minutes à heures. Mode « Analyse approfondie » possible plus tard |
| **SAM 2 / SAM (Meta) multi-vues** | Segmentation 2D sur des rendus du modèle, projetée sur les faces 3D | Apache 2.0 | **Oui** — approche libre et commercialement utilisable |
| **Géométrie classique** | Composantes connexes, découpe par courbure/angles dièdres, segmentation spectrale | Libre (trimesh, etc.) | **Oui** |

### 6.2 Ce que AI STUDIO fera, par niveaux

1. **Niveau 1 — Composantes connexes (v1, fiable).** Découpe un maillage en pièces physiquement séparées. Fonctionne bien sur des modèles importés composés de plusieurs objets ; **ne fonctionne pas** sur la plupart des maillages générés par IA, qui sont un bloc fusionné unique. L'interface l'indiquera.
2. **Niveau 2 — Sélection assistée manuelle (v1).** Pinceau / lasso / remplissage par angle sur les faces (three-mesh-bvh) → l'utilisateur crée « Lame », « Garde »… lui-même. Chaque partie : masquer, supprimer, renommer, exporter seule.
3. **Niveau 3 — Segmentation IA libre (v1.x).** Rendu multi-vues du modèle → SAM 2 sur chaque vue → vote et projection sur les faces → nettoyage par graphe d'adjacence. Donne des parties, **sans étiquettes sémantiques** (« Partie 1, 2, 3 ») ; l'utilisateur nomme, ou un modèle vision local propose des noms.
4. **Niveau 4 — PartField (optionnel, non commercial).** Meilleure qualité hiérarchique, activable avec avertissement de licence.

Le résultat attendu pour l'épée (lame / garde / poignée / pommeau) est **atteignable au niveau 3 ou 4**, mais pas garanti sur tous les modèles — ce sera affiché comme tel, sans simulation.

---

## 7. Application Windows : Electron ou Tauri ?

| Critère | Electron | Tauri 2 |
|---|---|---|
| Langage backend | TypeScript (Node.js) | Rust |
| Moteur de rendu | Chromium embarqué (WebGL identique partout) | WebView2 (Chromium aussi sous Windows) |
| Taille de l'installateur | ~100–150 Mo | ~10 Mo |
| Terminal intégré | `node-pty` + xterm.js (référence, utilisé par VS Code) | Possible, moins mature |
| Écosystème agents / MCP | SDK officiels TypeScript | Moins fourni |
| Installateur + mises à jour | electron-builder (NSIS) + electron-updater via GitHub Releases (gratuit) | Bundler NSIS/MSI + plugin updater |
| Maintenabilité pour un développeur solo | Une seule langue (TS) partout | Deux langages (Rust + TS) |

**Choix retenu : Electron + TypeScript.** Le gain de taille de Tauri est négligeable face à des modèles de plusieurs Go, alors que l'agent, les outils, le terminal et les SDK MCP sont nettement plus simples et robustes en TypeScript. Ce n'est pas « un site emballé » : le processus principal gère réellement les moteurs, fichiers, terminaux, téléchargements et le stockage local.

---

## 8. Architecture pressentie (détaillée en Phase 2)

```
AI STUDIO (Electron)
├── Interface (React + TypeScript + Vite, R3F pour la 3D)
├── Processus principal (Node.js)
│   ├── Gestionnaire de projets ........ SQLite (better-sqlite3) + dossiers utilisateur
│   ├── Moteur d'agents ................ boucle outil-appel, événements réels → timeline
│   ├── Système d'outils ............... registre de plugins (fichiers, recherche, terminal, git, web, image, 3D) + MCP
│   ├── Sécurité ....................... permissions par projet, confirmations, journal, arrêt immédiat
│   ├── Fournisseurs LLM ............... adaptateurs : Ollama, llama.cpp, LM Studio, OpenAI-compatible (Cloud)
│   ├── Gestionnaire de modèles ........ catalogue, téléchargements reprenables, vérification SHA256
│   ├── Gestionnaire de moteurs ........ installe/lance/arrête Ollama, llama-server, sd.cpp, worker Python
│   └── Ressources ..................... CPU/RAM/GPU/VRAM/disque
└── Workers externes (processus séparés, remplaçables)
    ├── ollama serve / llama-server .... LLM locaux (127.0.0.1)
    ├── sd-server (stable-diffusion.cpp)  images
    └── worker Python (FastAPI) ........ 3D + segmentation, environnement isolé géré par `uv`, installé à la demande
```

Principes : chaque moteur implémente une interface commune (`EngineAdapter` : install / start / stop / health / capabilities / run) ; aucun moteur n'est chargé dans le processus de l'interface ; le worker Python (PyTorch CUDA ≈ 3–5 Go) n'est téléchargé que si l'utilisateur active la 3D.

---

## 9. Limites assumées (à afficher dans l'application)

- 3D locale : NVIDIA uniquement.
- Hunyuan3D et P3-SAM : non disponibles en raison de leur licence (UE).
- FBX : nécessite Blender.
- Segmentation sémantique nommée automatiquement : non garantie ; parties détectées puis nommées par l'utilisateur ou proposées par un modèle vision.
- Cloud gratuit : quotas faibles et variables selon les fournisseurs ; le local reste la voie « illimitée ».
- 3D sans GPU NVIDIA : uniquement via le Cloud gratuit (HF Spaces, quelques minutes de GPU par jour).
- Qualité 3D « comparable à Tripo » : approchée avec TRELLIS/TRELLIS.2 sur GPU haut de gamme ; inférieure sur GPU modestes.

---

## 10. Sources consultées

- OpenRouter — Free LLM APIs compared (juin 2026, mis à jour sept. 2026) : https://openrouter.ai/blog/tutorials/free-llm-apis-compared/
- Google — Gemini API rate limits : https://ai.google.dev/gemini-api/docs/rate-limits
- Hugging Face — Inference Providers pricing : https://huggingface.co/docs/inference-providers/pricing
- Ollama — Windows : https://docs.ollama.com/windows
- OVHcloud AI Endpoints — capacités et limites : https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-capabilities
- Hugging Face — ZeroGPU (quotas) : https://huggingface.co/docs/hub/spaces-zerogpu
- Comparatif de 20 fournisseurs gratuits (2026) : https://fremodel.pages.dev/providers/
- NVIDIA NIM gratuit : https://fremodel.pages.dev/providers/nvidia-nim
- Z.ai modèles gratuits (vérifié oct. 2026) : https://www.developersdigest.tech/models/free-api/zai
- Pollinations.ai : https://free-llm.com/provider/pollinations-ai
- Limites testées en avril 2026 : https://dev.to/tokenmixai/12-free-llm-apis-you-can-use-right-now-no-credit-card-real-limits-tested-13f8
- llama.cpp : https://github.com/ggml-org/llama.cpp
- stable-diffusion.cpp : https://github.com/leejet/stable-diffusion.cpp
- FLUX — variantes et licences (août 2026) : https://invideo.io/blog/flux-ai-image-generator/
- Licence Hunyuan3D 2.1 : https://gitserver.onethingai.com/ai-models/Hunyuan3D-2.1/raw/branch/main/LICENSE
- Hunyuan3D-Part (P3-SAM, X-Part) : https://github.com/Tencent-Hunyuan/Hunyuan3D-Part
- TRELLIS : https://github.com/microsoft/TRELLIS
- TRELLIS.2 : https://github.com/microsoft/TRELLIS.2
- TripoSG : https://github.com/VAST-AI-Research/TripoSG
- TripoSR : https://github.com/VAST-AI-Research/TripoSR
- Stable Fast 3D (gated) : https://huggingface.co/stabilityai/stable-fast-3d
- PartField + licence : https://github.com/nv-tlabs/PartField
- SAMPart3D : https://github.com/Pointcept/SAMPart3D
- P3-SAM (article) : https://arxiv.org/html/2509.06784v4
