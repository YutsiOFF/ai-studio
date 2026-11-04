/**
 * Recettes d'installation des moteurs 3D locaux (sans dépendance à Electron :
 * ce fichier est aussi utilisé par le test d'installation réel sous Windows en CI).
 *
 * Chaque moteur a son propre environnement Python (versions incompatibles entre eux),
 * mais partage le Python isolé et le cache de uv : PyTorch n'est téléchargé qu'une fois.
 */

export type Local3DEngineId = 'triposr' | 'triposg'

export interface Local3DSpec {
  id: Local3DEngineId
  label: string
  /** Dossier de l'environnement, relatif à la racine py3d ('' = racine, pour TripoSR historique). */
  dir: string
  /** Archive du code source, épinglée sur un commit vérifié. */
  sourceZip: string
  /** Dossier du paquet Python à extraire de l'archive. */
  packageDir: string
  deps: string[]
  torch: string[]
  /** Correctifs appliqués au code source après extraction : chemin relatif → transformation. */
  patches: Record<string, (src: string) => string>
  /** Fichiers ajoutés au dossier source (modules de remplacement). */
  extraFiles: Record<string, string>
  worker: string
  /** Script Python exécuté une fois à l'installation (en ligne) : met en cache ce que le modèle télécharge au premier chargement. */
  warmup: (weightsDir: string) => string
  weights: { repo: string; files: 'all' | string[] }
  /** Version du montage : changer cette valeur force une réinstallation propre. */
  setupVersion: number
  requiresCuda: boolean
  minVramMB: number
}

const TORCH = ['torch==2.5.1']

/** Remplace torchmcubes (compilation CUDA) par PyMCubes, avec la même interface. */
export const TRIPOSR_ISOSURFACE_PY = `# Réécrit par AI Studio : PyMCubes remplace torchmcubes (aucune compilation nécessaire).
from typing import Callable, Optional, Tuple

import mcubes
import numpy as np
import torch
import torch.nn as nn


class IsosurfaceHelper(nn.Module):
    points_range: Tuple[float, float] = (0, 1)

    @property
    def grid_vertices(self) -> torch.FloatTensor:
        raise NotImplementedError


class MarchingCubeHelper(IsosurfaceHelper):
    def __init__(self, resolution: int) -> None:
        super().__init__()
        self.resolution = resolution
        self._grid_vertices: Optional[torch.FloatTensor] = None

    @property
    def grid_vertices(self) -> torch.FloatTensor:
        if self._grid_vertices is None:
            x, y, z = (torch.linspace(*self.points_range, self.resolution),) * 3
            x, y, z = torch.meshgrid(x, y, z, indexing="ij")
            verts = torch.cat([x.reshape(-1, 1), y.reshape(-1, 1), z.reshape(-1, 1)], dim=-1).reshape(-1, 3)
            self._grid_vertices = verts
        return self._grid_vertices

    def forward(self, level: torch.FloatTensor) -> Tuple[torch.FloatTensor, torch.LongTensor]:
        r = self.resolution
        volume = (-level.view(r, r, r)).detach().float().cpu().numpy()
        vertices, faces = mcubes.marching_cubes(volume, 0.0)
        v_pos = torch.from_numpy(np.ascontiguousarray(vertices, dtype=np.float32)) / (r - 1.0)
        t_pos_idx = torch.from_numpy(np.ascontiguousarray(faces, dtype=np.int64))
        return v_pos.to(level.device), t_pos_idx.to(level.device)
`

const EMIT_PY = `import argparse, json, os, sys, time

def emit(**kw):
    sys.stdout.write(json.dumps(kw, ensure_ascii=False) + "\\n")
    sys.stdout.flush()
`

const RUN_PY = `
if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        emit(error=str(e), trace=traceback.format_exc()[-2000:])
        sys.exit(1)
`

export const TRIPOSR_WORKER_PY = `${EMIT_PY}
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--image", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--weights", required=True)
    p.add_argument("--device", default="cuda")
    p.add_argument("--mc", type=int, default=256)
    p.add_argument("--ratio", type=float, default=0.85)
    a = p.parse_args()
    emit(stage="Chargement de PyTorch")
    import numpy as np
    import torch
    import trimesh
    from PIL import Image
    device = a.device if (a.device == "cpu" or torch.cuda.is_available()) else "cpu"
    if device != a.device:
        emit(stage="CUDA indisponible : calcul sur le processeur")
    from tsr.system import TSR
    from tsr.utils import remove_background, resize_foreground
    import rembg
    emit(stage="Chargement du modèle TripoSR")
    model = TSR.from_pretrained(a.weights, config_name="config.yaml", weight_name="model.ckpt")
    model.renderer.set_chunk_size(8192)
    model.to(device)
    emit(stage="Suppression du fond")
    session = rembg.new_session()
    image = remove_background(Image.open(a.image), session)
    image = resize_foreground(image, a.ratio)
    arr = np.array(image).astype(np.float32) / 255.0
    arr = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
    image = Image.fromarray((arr * 255.0).astype(np.uint8))
    emit(stage="Reconstruction 3D (réseau neuronal)")
    t = time.time()
    with torch.no_grad():
        codes = model([image], device=device)
    emit(stage="Extraction du maillage (résolution %d)" % a.mc)
    meshes = model.extract_mesh(codes, True, resolution=a.mc)
    mesh = meshes[0]
    try:
        trimesh.repair.fix_normals(mesh)
    except Exception:
        pass
    emit(stage="Enregistrement du modèle")
    mesh.export(a.out)
    emit(done=a.out, seconds=round(time.time() - t, 1), device=device, faces=int(len(mesh.faces)))
${RUN_PY}`

/**
 * TripoSG : le décodeur « flash » exige diso (extension CUDA à compiler). On utilise le
 * décodeur hiérarchique (marching cubes de scikit-image), qui ne demande aucune compilation.
 */
export const TRIPOSG_WORKER_PY = `${EMIT_PY}
def prepare(path, rembg_session, pad=0.1):
    import numpy as np
    from PIL import Image
    import rembg
    img = Image.open(path)
    img.thumbnail((2000, 2000))
    rgba = img.convert("RGBA")
    a = np.array(rgba)[:, :, 3]
    has_alpha = (a < 250).mean() > 0.01 and (a > 5).mean() > 0.01
    if not has_alpha:
        rgba = rembg.remove(img.convert("RGB"), session=rembg_session).convert("RGBA")
    arr = np.array(rgba).astype(np.float32) / 255.0
    alpha = arr[:, :, 3]
    ys, xs = np.where(alpha > 0.5)
    if len(xs) == 0:
        raise ValueError("Aucun objet détecté dans l'image (fond uniforme ?).")
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    rgb = arr[:, :, :3] * alpha[:, :, None] + (1.0 - alpha[:, :, None])
    crop = rgb[y0:y1, x0:x1]
    h, w = crop.shape[:2]
    side = int(max(h, w) * (1 + 2 * pad))
    canvas = np.ones((side, side, 3), dtype=np.float32)
    oy, ox = (side - h) // 2, (side - w) // 2
    canvas[oy:oy + h, ox:ox + w] = crop
    return Image.fromarray((canvas * 255).astype(np.uint8))

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--image", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--weights", required=True)
    p.add_argument("--device", default="cuda")
    p.add_argument("--steps", type=int, default=50)
    p.add_argument("--guidance", type=float, default=7.0)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--dense", type=int, default=8)
    p.add_argument("--depth", type=int, default=9)
    p.add_argument("--faces", type=int, default=0)
    a = p.parse_args()
    emit(stage="Chargement de PyTorch")
    import numpy as np
    import torch
    import trimesh
    import rembg
    device = a.device if (a.device == "cpu" or torch.cuda.is_available()) else "cpu"
    if device != a.device:
        emit(stage="CUDA indisponible : calcul sur le processeur (très lent)")
    dtype = torch.float16 if device == "cuda" else torch.float32
    from triposg.pipelines.pipeline_triposg import TripoSGPipeline
    emit(stage="Suppression du fond")
    image = prepare(a.image, rembg.new_session())
    emit(stage="Chargement du modèle TripoSG")
    pipe = TripoSGPipeline.from_pretrained(a.weights).to(device, dtype)
    emit(stage="Génération de la forme (%d étapes)" % a.steps)
    t = time.time()
    def on_step(pipeline, i, ts, kw):
        emit(stage="Génération de la forme : étape %d/%d" % (i + 1, a.steps), step=i + 1, steps=a.steps)
        return kw
    with torch.no_grad():
        out = pipe(
            image=image,
            generator=torch.Generator(device=device).manual_seed(a.seed),
            num_inference_steps=a.steps,
            guidance_scale=a.guidance,
            use_flash_decoder=False,
            dense_octree_depth=a.dense,
            hierarchical_octree_depth=a.depth,
            callback_on_step_end=on_step,
        )
    v, f = out.samples[0]
    if v is None:
        raise RuntimeError("L'extraction du maillage a échoué (forme vide).")
    emit(stage="Extraction du maillage terminée")
    mesh = trimesh.Trimesh(np.asarray(v, dtype=np.float32), np.ascontiguousarray(f))
    if a.faces > 0 and len(mesh.faces) > a.faces:
        emit(stage="Simplification (%d triangles)" % a.faces)
        import pymeshlab
        ms = pymeshlab.MeshSet()
        ms.add_mesh(pymeshlab.Mesh(vertex_matrix=mesh.vertices, face_matrix=mesh.faces))
        ms.meshing_merge_close_vertices()
        ms.meshing_decimation_quadric_edge_collapse(targetfacenum=a.faces)
        m = ms.current_mesh()
        mesh = trimesh.Trimesh(m.vertex_matrix(), m.face_matrix())
    try:
        trimesh.repair.fix_normals(mesh)
    except Exception:
        pass
    emit(stage="Enregistrement du modèle")
    mesh.export(a.out)
    emit(done=a.out, seconds=round(time.time() - t, 1), device=device, faces=int(len(mesh.faces)))
${RUN_PY}`

/** Rend inference_utils.py utilisable sans diso ni CUDA codé en dur. */
export function patchTripoSGInferenceUtils(src: string): string {
  let s = src.replace(/^from diso import DiffDMC\s*$/m, 'try:\n    from diso import DiffDMC\nexcept Exception:  # AI Studio : diso est facultatif (décodeur hiérarchique)\n    DiffDMC = None')
  if (!s.includes('DiffDMC = None')) throw new Error('Correctif TripoSG : import diso introuvable.')
  s = s.replace("device='cuda', dtype=torch.float16", 'device=edge_coords.device, dtype=_HALF')
  s = s.replace(/torch\.float16/g, '_HALF')
  // _HALF : demi-précision sur GPU, précision simple sur processeur (opérations non prises en charge en float16 sur CPU).
  s = s.replace(/^import torch\s*$/m, 'import torch\n_HALF = torch.float16 if torch.cuda.is_available() else torch.float32')
  if (!s.includes('_HALF = torch.float16')) throw new Error('Correctif TripoSG : import torch introuvable.')
  return s
}

export const LOCAL3D_SPECS: Record<Local3DEngineId, Local3DSpec> = {
  triposr: {
    id: 'triposr',
    label: 'TripoSR',
    dir: '',
    sourceZip: 'https://codeload.github.com/VAST-AI-Research/TripoSR/zip/107cefdc244c39106fa830359024f6a2f1c78871',
    packageDir: 'tsr',
    torch: TORCH,
    // Versions vérifiées ensemble (uv pip compile, Windows / Python 3.11, avec torch==2.5.1).
    // transformers 4.35 exige tokenizers 0.14.x, donc huggingface-hub < 0.18.
    deps: [
      'numpy==1.26.4',
      'omegaconf==2.3.0',
      'einops==0.7.0',
      'transformers==4.35.0',
      'tokenizers==0.14.1',
      'huggingface-hub==0.17.3',
      'trimesh==4.0.5',
      'Pillow==10.4.0',
      'PyMCubes==0.1.6',
      'rembg==2.0.59',
      'onnxruntime==1.19.2',
      'opencv-python-headless==4.11.0.86',
      'scikit-image==0.26.0',
      'pymatting==1.1.16',
      'scipy==1.13.1',
      'networkx==3.3',
      'imageio==2.37.0'
    ],
    patches: { 'tsr/models/isosurface.py': () => TRIPOSR_ISOSURFACE_PY },
    extraFiles: {},
    worker: TRIPOSR_WORKER_PY,
    // TSR télécharge la configuration de facebook/dino-vitb16 à la construction du modèle.
    warmup: (w) => `import rembg; rembg.new_session()\nfrom tsr.system import TSR\nTSR.from_pretrained(${JSON.stringify(w)}, config_name="config.yaml", weight_name="model.ckpt")\nprint("ok")`,
    weights: { repo: 'stabilityai/TripoSR', files: ['config.yaml', 'model.ckpt'] },
    setupVersion: 2,
    requiresCuda: false,
    minVramMB: 0
  },
  triposg: {
    id: 'triposg',
    label: 'TripoSG',
    dir: 'triposg',
    sourceZip: 'https://codeload.github.com/VAST-AI-Research/TripoSG/zip/fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c',
    packageDir: 'triposg',
    torch: [...TORCH, 'torchvision==0.20.1'],
    // Versions vérifiées ensemble (uv pip compile, Windows / Python 3.11, avec torch 2.5.1 + torchvision 0.20.1).
    deps: [
      'numpy==1.26.4',
      'diffusers==0.32.2',
      'transformers==4.48.3',
      'huggingface-hub==0.28.1',
      'safetensors==0.5.2',
      'accelerate==1.3.0',
      'einops==0.8.0',
      'omegaconf==2.3.0',
      'jaxtyping==0.2.36',
      'typeguard==4.4.1',
      'trimesh==4.5.3',
      'pymeshlab==2023.12.post2',
      'scikit-image==0.25.0',
      'scipy==1.15.1',
      'opencv-python-headless==4.11.0.86',
      'Pillow==10.4.0',
      'rembg==2.0.61',
      'onnxruntime==1.20.1'
    ],
    patches: { 'triposg/inference_utils.py': patchTripoSGInferenceUtils },
    extraFiles: {},
    worker: TRIPOSG_WORKER_PY,
    warmup: (w) => `import rembg; rembg.new_session()\nimport torch\nfrom triposg.pipelines.pipeline_triposg import TripoSGPipeline\nTripoSGPipeline.from_pretrained(${JSON.stringify(w)})\nprint("ok")`,
    weights: { repo: 'VAST-AI/TripoSG', files: 'all' },
    setupVersion: 1,
    requiresCuda: true,
    minVramMB: 7000
  }
}
