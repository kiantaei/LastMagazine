import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface NormalizedModel {
  /** wrapper group — model inside is rotated/scaled/centered */
  group: THREE.Group;
  /** dims after normalization */
  length: number;
  height: number;
  width: number;
}

export interface Assets {
  soldier: {
    scene: THREE.Group;
    clips: THREE.AnimationClip[];
  };
  smg: {
    scene: THREE.Group;
    magNode: THREE.Object3D | null;
  };
  smgMagazine: { scene: THREE.Group };
  ar: { scene: THREE.Group };
  pistol: { scene: THREE.Group };
  hands: {
    left: { scene: THREE.Group; bones: Map<string, THREE.Object3D> };
    right: { scene: THREE.Group; bones: Map<string, THREE.Object3D> };
  };
}

/** index a model's named nodes (bones + meshes) */
function indexNodes(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const map = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if (o.name) map.set(o.name, o);
  });
  return map;
}

/** dress the WebXR generic hands as dark tactical gloves */
function prepareHand(gltfScene: THREE.Object3D): { scene: THREE.Group; bones: Map<string, THREE.Object3D> } {
  const scene = gltfScene as THREE.Group;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      // hide the alternative trigger-press pose meshes that ship with the left hand
      if (mesh.name.includes('trigger_pressed')) mesh.visible = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.color) {
          std.color.setHex(0x1b1d20); // tactical glove
          std.roughness = 0.88;
          std.metalness = 0.04;
        }
      }
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
  });
  return { scene, bones: indexNodes(scene) };
}

/** Loads all runtime GLTF assets and reports coarse progress for the menu. */
export async function loadAssets(onProgress?: (ratio: number) => void): Promise<Assets> {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress?.(loaded / Math.max(1, total));
  const loader = new GLTFLoader(manager);

  const [soldier, smg, mag, ar, pistol, handL, handR] = await Promise.all([
    loader.loadAsync('/models/soldier.glb'),
    loader.loadAsync('/models/smg.glb'),
    loader.loadAsync('/models/smg_magazine.glb'),
    loader.loadAsync('/models/ar.glb'),
    loader.loadAsync('/models/pistol.glb'),
    loader.loadAsync('/models/hand_left.glb'),
    loader.loadAsync('/models/hand_right.glb'),
  ]);

  return {
    soldier: { scene: soldier.scene, clips: soldier.animations },
    smg: { scene: smg.scene, magNode: smg.scene.getObjectByName('Magazine_SMG') ?? null },
    smgMagazine: { scene: mag.scene },
    ar: { scene: ar.scene },
    pistol: { scene: pistol.scene },
    hands: {
      left: prepareHand(handL.scene),
      right: prepareHand(handR.scene),
    },
  };
}

function measure(obj: THREE.Object3D): { size: THREE.Vector3; center: THREE.Vector3; min: THREE.Vector3 } {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  return {
    size: box.getSize(new THREE.Vector3()),
    center: box.getCenter(new THREE.Vector3()),
    min: box.min.clone(),
  };
}

/**
 * Puts a weapon model into game convention: barrel along -z, bbox centered
 * on the origin, total length = targetLength. The Quaternius packs model
 * guns along +x, so the longest axis is rotated onto the forward axis.
 * Centering is applied last (in wrapper space) so it works for models that
 * are not built around their own origin.
 */
export function normalizeGun(
  model: THREE.Object3D,
  targetLength: number,
  flip = false,
): NormalizedModel {
  const { size } = measure(model);
  const longest = Math.max(size.x, size.y, size.z);
  const scale = targetLength / longest;
  const wrapper = new THREE.Group();
  const inner = new THREE.Group();
  model.scale.setScalar(scale);
  model.rotation.y = flip ? Math.PI / 2 : -Math.PI / 2; // longest axis (x) → -z / +z
  inner.add(model);
  wrapper.add(inner);
  wrapper.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrapper);
  inner.position.sub(box.getCenter(new THREE.Vector3())); // exact recentering
  wrapper.updateMatrixWorld(true);
  const dims = measure(wrapper).size;
  return { group: wrapper, length: dims.z, height: dims.y, width: dims.x };
}

/**
 * Stands a character model upright at the origin: feet at y=0, centered on
 * x/z, total height = targetHeight. Skinned meshes are measured in bind pose.
 */
export function normalizeCharacter(
  model: THREE.Object3D,
  targetHeight: number,
): NormalizedModel {
  const { size, center, min } = measure(model);
  const scale = targetHeight / Math.max(size.y, 0.001);
  const wrapper = new THREE.Group();
  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -min.y * scale, -center.z * scale);
  wrapper.add(model);
  wrapper.updateMatrixWorld(true);
  const dims = measure(wrapper).size;
  return { group: wrapper, length: dims.z, height: dims.y, width: dims.x };
}
