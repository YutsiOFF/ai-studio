# AI Studio

Plateforme Windows tout-en-un pour utiliser des **IA gratuites**, en **local** (sur ton PC, sans clé API, sans compte, hors ligne) et dans le **Cloud** (fournisseurs réellement gratuits) : discussion, agents sur tes projets, génération d'images et génération 3D.

> **État : version 0.1 — étape M1 (socle).** Ce qui fonctionne déjà est indiqué dans l'application ; les sections non terminées sont clairement marquées « En développement ».

## Installer

1. Ouvre la page [Releases](https://github.com/YutsiOFF/ai-studio/releases).
2. Télécharge `AI-Studio-Setup-x.y.z.exe` et lance-le (aucun droit administrateur requis).
3. Windows SmartScreen peut afficher « Windows a protégé votre ordinateur » car l'installateur n'est pas signé (une signature de code est payante). Clique sur **Informations complémentaires** puis **Exécuter quand même**.

Les mises à jour suivantes s'installent ensuite automatiquement.

**Configuration minimale :** Windows 10 (22H2) ou 11, 64 bits, 8 Go de RAM. Aucune carte graphique obligatoire.

## Fonctionnalités de la v0.1

| Module | État |
|---|---|
| Interface complète, barre latérale, 9 sections | Disponible |
| Analyse automatique du matériel (GPU NVIDIA / AMD / Intel, VRAM réelle, RAM, CPU, disque) et choix de l'accélération | Disponible |
| Projets reliés à un dossier du PC (création, modification, retrait sans toucher au dossier) | Disponible |
| Historique local des actions | Disponible |
| Paramètres : démarrage avec Windows, notifications, ressources en direct, mises à jour automatiques | Disponible |
| IA locales, bibliothèque de modèles, téléchargements | Étape M2 |
| Fournisseurs Cloud gratuits | Étape M3 |
| Agents dans les projets | Étape M4 |
| Génération d'images | Étape M5 |
| Génération 3D et segmentation | Étapes M6 – M7 |

## Développer

Prérequis : Node.js 22.

```bash
npm install
npm run dev        # lance l'application en mode développement
npm test           # tests unitaires
npm run typecheck  # vérification des types
npm run dist       # crée l'installateur Windows dans dist/
```

Chaque `push` sur `main` construit l'installateur sur GitHub Actions (artefact « AI-Studio-Setup »). Un tag `vX.Y.Z` publie une version sur la page Releases, ce qui déclenche la mise à jour automatique chez les utilisateurs.

## Documentation

- [Phase 1 — Recherche technique](docs/PHASE1_RECHERCHE_TECHNIQUE.md) : fournisseurs, modèles, licences, choix retenus.
- [Phase 2 — Architecture](docs/PHASE2_ARCHITECTURE.md) : architecture, contrats, sécurité, compatibilité multi-PC, plan de développement.

## Licence

MIT — voir [LICENSE](LICENSE). Les modèles d'IA téléchargés depuis l'application ont leurs propres licences, affichées dans la bibliothèque.
