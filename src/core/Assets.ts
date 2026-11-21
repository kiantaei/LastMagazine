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

export type CarKind = 'sedan' | 'suv' | 'taxi' | 'cop';

export interface CarAsset {
  scene: THREE.Group;
  /** body material (tintable) */
  bodyMat: THREE.MeshStandardMaterial | null;
  /** lightbar flash materials (cop only) */
  barRed: THREE.MeshStandardMaterial | null;
  barBlue: THREE.MeshStandardMaterial | null;
}

export interface ManAsset {
  template: THREE.Group;
  clips: THREE.AnimationClip[];
  /** named materials for persona recolors (cloned per variant) */
  mats: Record<string, THREE.MeshStandardMaterial>;
}

export interface Assets {
  man: ManAsset;
  smgMagazine: { scene: THREE.Group };
  pistol: { scene: THREE.Group };
  cars: Record<CarKind, CarAsset>;
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
          std.color.setHex(0x2b2f36); // tactical glove — dark but readable
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

/** collect the named standard materials of a model (first match wins) */
function namedMaterials(root: THREE.Object3D): Record<string, THREE.MeshStandardMaterial> {
  const out: Record<string, THREE.MeshStandardMaterial> = {};
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std?.name && !out[std.name]) out[std.name] = std;
      }
    }
  });
  return out;
}

/** Loads all runtime GLTF assets and reports coarse progress for the menu. */
export async function loadAssets(onProgress?: (ratio: number) => void): Promise<Assets> {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress?.(loaded / Math.max(1, total));
  const loader = new GLTFLoader(manager);

  const [man, mag, pistol, sedan, suv, taxi, cop, handL, handR] = await Promise.all([
    loader.loadAsync('/models/man.glb'),
    loader.loadAsync('/models/smg_magazine.glb'),
    loader.loadAsync('/models/pistol.glb'),
    loader.loadAsync('/models/car_sedan.glb'),
    loader.loadAsync('/models/car_suv.glb'),
    loader.loadAsync('/models/car_taxi.glb'),
    loader.loadAsync('/models/car_cop.glb'),
    loader.loadAsync('/models/hand_left.glb'),
    loader.loadAsync('/models/hand_right.glb'),
  ]);

  const carAsset = (gltf: { scene: THREE.Group }, tint: number): CarAsset => {
    const mats = namedMaterials(gltf.scene);
    const body = mats['Blue'] ?? mats['White'] ?? mats['Yellow'] ?? null;
    if (body) {
      body.color.setHex(tint);
      body.roughness = 0.42;
      body.metalness = 0.55;
      // faint self-visibility so cars never fully vanish in the night
      body.emissive = new THREE.Color(0x0a0d12);
      body.emissiveIntensity = 1;
    }
    return {
      scene: gltf.scene,
      bodyMat: body,
      barRed: mats['WhiteLights'] ?? null,
      barBlue: mats['BlueLights'] ?? null,
    };
  };

  // lift the new pistol's flat FBX materials so the spill light can read them
  pistol.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std?.color) {
          std.color.multiplyScalar(1.7);
          std.metalness = 0.25;
          std.roughness = 0.5;
        }
      }
    }
  });

  return {
    man: {
      template: man.scene,
      clips: man.animations,
      mats: namedMaterials(man.scene),
    },
    smgMagazine: { scene: mag.scene },
    pistol: { scene: pistol.scene },
    cars: {
      sedan: carAsset(sedan, 0x8fa8c8),
      suv: carAsset(suv, 0xb9bec4),
      taxi: carAsset(taxi, 0xd8b418),
      cop: carAsset(cop, 0x14161a),
    },
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

/**
 * Normalizes a vehicle model that already faces +z (Quaternius vehicles):
 * scaled to targetLength, centered on x/z, wheels resting on y=0.
 */
export function normalizeVehicle(
  model: THREE.Object3D,
  targetLength: number,
): NormalizedModel {
  const { size, center, min } = measure(model);
  const scale = targetLength / Math.max(size.z, 0.001);
  const wrapper = new THREE.Group();
  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -min.y * scale, -center.z * scale);
  wrapper.add(model);
  wrapper.updateMatrixWorld(true);
  const dims = measure(wrapper).size;
  return { group: wrapper, length: dims.z, height: dims.y, width: dims.x };
}
