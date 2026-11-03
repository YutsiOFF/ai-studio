import { Planned } from '../components/Planned'

export function AssistantPage() {
  return (
    <Planned
      title="Assistant IA"
      description="Discute avec des modèles locaux ou Cloud gratuits, et fais travailler des agents sur tes projets."
      milestone="M2 · M3 · M4"
      features={[
        { title: 'Modèles locaux sans clé', text: 'Discussion hors ligne avec un modèle installé sur ton PC : aucune API Key, aucun compte.' },
        { title: '17 fournisseurs Cloud gratuits', text: 'Gemini, Groq, Cerebras, OpenRouter, Mistral, NVIDIA, OVHcloud… avec quotas réels affichés.' },
        { title: 'Agents transparents', text: 'Chaque lecture, recherche, commande ou modification apparaît dans une timeline en temps réel.' },
        { title: 'Contrôle total', text: 'Diff avant/après à valider, confirmation des suppressions, arrêt immédiat de l’agent.' }
      ]}
    />
  )
}

export function ImagesPage() {
  return (
    <Planned
      title="Génération d'images"
      description="Crée et modifie des images avec des modèles libres, en local ou via le Cloud gratuit."
      milestone="M5"
      features={[
        { title: 'Texte vers image', text: 'SDXL, FLUX.1 schnell, FLUX.2 klein 4B, Z-Image : choix selon la puissance du PC.' },
        { title: 'Image de référence', text: 'Variantes à partir d’une image existante, réglage de la force de transformation.' },
        { title: 'Paramètres complets', text: 'Résolution, étapes, graine, échantillonneur, prompt négatif, variantes multiples.' },
        { title: 'Licences affichées', text: 'Chaque modèle indique s’il est utilisable commercialement ou non.' }
      ]}
    />
  )
}

export function ThreeDPage() {
  return (
    <Planned
      title="Génération 3D"
      description="Transforme une image ou un texte en modèle 3D, visualise-le, découpe-le en parties et exporte-le."
      milestone="M6 · M7"
      features={[
        { title: 'Image vers 3D', text: 'TripoSR et TripoSG en local (NVIDIA), TRELLIS via le Cloud gratuit pour tous les PC.' },
        { title: 'Visualiseur interactif', text: 'Rotation, zoom, éclairage, mode filaire et inspection des textures.' },
        { title: 'Segmentation', text: 'Découpe en parties, masquage, suppression et export de chaque partie séparément.' },
        { title: 'Exports', text: 'GLB, GLTF, OBJ, PLY, STL ; FBX via Blender s’il est installé.' }
      ]}
    />
  )
}

export function LibraryPage() {
  return (
    <Planned
      title="Bibliothèque de modèles"
      description="Toutes les IA disponibles, classées par usage, avec licence, taille et besoins matériels."
      milestone="M2"
      features={[
        { title: 'Recommandé pour ton PC', text: 'Chaque modèle est classé Rapide, Hybride, Lent ou Trop lourd selon ton matériel.' },
        { title: 'Informations vérifiées', text: 'Licence, taille de téléchargement, mémoire estimée, capacités (outils, vision).' },
        { title: 'Recherche et filtres', text: 'Discussion, code, images, 3D, segmentation, vision.' },
        { title: 'Pack recommandé', text: 'Un modèle par usage, installable en un clic.' }
      ]}
    />
  )
}

export function LocalModelsPage() {
  return (
    <Planned
      title="Modèles locaux"
      description="Les modèles installés sur ton PC : lancement, arrêt, mises à jour et consommation en direct."
      milestone="M2"
      features={[
        { title: 'Téléchargement réel', text: 'Progression exacte, pause, reprise et vérification de l’intégrité des fichiers.' },
        { title: 'Lancer / arrêter', text: 'Le moteur local est installé et configuré automatiquement, sans clé ni compte.' },
        { title: 'Ressources en direct', text: 'Mémoire vidéo et RAM utilisées par chaque modèle chargé.' },
        { title: 'Hors ligne', text: 'Une fois installés, les modèles fonctionnent sans Internet.' }
      ]}
    />
  )
}
