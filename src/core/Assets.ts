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
}

/** Loads all runtime GLTF assets and reports coarse progress for the menu. */
export async function loadAssets(onProgress?: (ratio: number) => void): Promise<Assets> {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress?.(loaded / Math.max(1, total));
  const loader = new GLTFLoader(manager);

  const [soldier, smg, mag, ar] = await Promise.all([
    loader.loadAsync('/models/soldier.glb'),
    loader.loadAsync('/models/smg.glb'),
    loader.loadAsync('/models/smg_magazine.glb'),
    loader.loadAsync('/models/ar.glb'),
  ]);

  return {
    soldier: { scene: soldier.scene, clips: soldier.animations },
    smg: { scene: smg.scene, magNode: smg.scene.getObjectByName('Magazine_SMG') ?? null },
    smgMagazine: { scene: mag.scene },
    ar: { scene: ar.scene },
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
 */
export function normalizeGun(
  model: THREE.Object3D,
  targetLength: number,
  flip = false,
): NormalizedModel {
  const { size, center } = measure(model);
  const longest = Math.max(size.x, size.y, size.z);
  const scale = targetLength / longest;
  const wrapper = new THREE.Group();
  model.position.set(-center.x, -center.y, -center.z);
  model.scale.setScalar(scale);
  model.rotation.y = flip ? Math.PI / 2 : -Math.PI / 2; // longest axis (x) → -z / +z
  wrapper.add(model);
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
