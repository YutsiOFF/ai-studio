# AI Studio

Plateforme Windows tout-en-un pour utiliser des **IA gratuites**, en **local** (sur ton PC, sans clé API, sans compte, hors ligne) et dans le **Cloud** (fournisseurs réellement gratuits) : discussion, agents sur tes projets, génération d'images et génération 3D.

> **Version 0.2** — toutes les sections sont fonctionnelles. Les limites connues sont indiquées dans l'application et ci-dessous.

## Installer

Site : **https://yutsioff.github.io/ai-studio/**


1. Ouvre la page [Releases](https://github.com/YutsiOFF/ai-studio/releases).
2. Télécharge `AI-Studio-Setup-x.y.z.exe` et lance-le (aucun droit administrateur requis).
3. Windows SmartScreen peut afficher « Windows a protégé votre ordinateur » car l'installateur n'est pas signé (une signature de code est payante). Clique sur **Informations complémentaires** puis **Exécuter quand même**.

Les mises à jour suivantes s'installent ensuite automatiquement.

**Configuration minimale :** Windows 10 (22H2) ou 11, 64 bits, 8 Go de RAM. Aucune carte graphique obligatoire.

## Fonctionnalités

| Module | Ce qui fonctionne |
|---|---|
| **Analyse du PC** | GPU NVIDIA / AMD / Intel, VRAM réelle, RAM, CPU (AVX), disque ; choix automatique CUDA / Vulkan / CPU |
| **Bibliothèque de modèles** | 35 modèles de discussion / code / vision + 3 modèles d'images, classés *Rapide / Hybride / Lent / Trop lourd* pour ce PC, vitesse estimée puis mesurée, **pack recommandé** en un clic, licence affichée |
| **IA locales** | Moteur Ollama installé et piloté par l'application (ou Ollama existant réutilisé) : **aucune clé, aucun compte, hors ligne** après téléchargement. Téléchargements avec progression réelle, capacités (outils, vision) vérifiées auprès du moteur, mémoire utilisée en direct |
| **IA Cloud gratuites** | 17 fournisseurs gratuits, dont 3 **sans clé ni compte** (OVHcloud, Kilo Gateway `:free`, LLM7), puis Gemini, Groq, Cerebras, OpenRouter `:free`, Mistral, NVIDIA NIM, GitHub Models, Cloudflare, Z.ai, Ollama Cloud…) + offres d'essai/payantes séparées. Clés chiffrées par Windows, test de connexion, compteur de requêtes, limites lues dans les réponses |
| **Assistant** | Discussion en direct (Markdown, raisonnement, images jointes), modèles locaux et Cloud dans un même sélecteur |
| **Agents sur projets** | Exploration, lecture, recherche, écriture, modification, déplacement, suppression (Corbeille), commandes. **Chaque modification et chaque commande est montrée (diff avant/après) et attend ta validation**. Timeline réelle en 9 étapes, annulation des modifications, arrêt immédiat, confinement au dossier du projet |
| **Images** | stable-diffusion.cpp (CUDA / Vulkan / CPU) installé automatiquement ; Z-Image Turbo, SDXL, SD 1.5 ; texte → image, image de référence, variantes, formats, graine, historique |
| **3D** | Image → 3D avec **TripoSR 100 % local** (installation en un clic, sans quota, NVIDIA ou processeur) + **10 moteurs Cloud gratuits sans clé** (TRELLIS, TRELLIS.2, TRELLIS.2 Texte, Shap-E texte→3D, PartCrafter en parties, TripoSG, Step1X-3D, InstantMesh, Hi3DGen, et Hunyuan3D-2.1 sur activation : licence excluant l'UE) via Hugging Face, sur tous les PC ; animation de particules qui prennent la forme du modèle ; texte → image → 3D ; visualiseur (rotation, zoom, lumière, filaire, textures) ; **segmentation** (pièces disjointes, sélection de régions par angle) ; masquer / supprimer / renommer / exporter chaque partie ; export GLB, OBJ, STL ; import GLB/OBJ/STL/PLY |
| **Historique, paramètres, mises à jour** | Journal local, ressources en direct, démarrage avec Windows, mises à jour automatiques |

### Limites connues (affichées dans l'application)

- **3D locale** : TripoSR uniquement pour l'instant (couleurs par sommet, pas de texture UV). Les autres moteurs passent par le Cloud gratuit (quota ~2 min de GPU/jour sans compte, 5 min avec un compte Hugging Face gratuit).
- **Segmentation sémantique automatique** (nommer « lame », « garde »…) : non disponible librement en France (P3-SAM exclut l'UE). Le découpage est géométrique ; les parties se renomment à la main.
- **Export FBX** : nécessite Blender, non intégré.
- **Inpainting** : non intégré (prévu via ComfyUI).
- **Anglais** : interface en français uniquement pour l'instant.

## Développer

Prérequis : Node.js 22.

```bash
npm install
npm run dev        # lance l'application en mode développement
npm test           # tests unitaires
npm run typecheck  # vérification des types
npm run dist       # crée l'installateur Windows dans dist/
```

Chaque `push` sur `main` construit l'installateur sur GitHub Actions et publie la version indiquée dans `package.json` sur la page Releases. Pour sortir une nouvelle version : augmenter `version` dans `package.json` puis pousser sur `main` ; les utilisateurs reçoivent la mise à jour automatiquement.

## Documentation

- [Phase 1 — Recherche technique](docs/PHASE1_RECHERCHE_TECHNIQUE.md) : fournisseurs, modèles, licences, choix retenus.
- [Phase 2 — Architecture](docs/PHASE2_ARCHITECTURE.md) : architecture, contrats, sécurité, compatibilité multi-PC, plan de développement.

## Licence

MIT — voir [LICENSE](LICENSE). Les modèles d'IA téléchargés depuis l'application ont leurs propres licences, affichées dans la bibliothèque.
