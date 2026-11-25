import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Verified per-asset orientation & scale normalization table.
 * All assets are normalized so:
 *   - Forward nose/barrel points along -Z
 *   - Up is +Y
 *   - Grounded props/vehicles/tanks have min.y = 0
 *   - Aircraft/helicopters are centered at (0, 0, 0)
 */
export const MODEL_PRESETS = {
  '/assets/models/aircraft/f16.glb': { yaw: 0, length: 15.0, centerY: true },
  '/assets/models/aircraft/f16_cockpit.glb': { yaw: 0, length: 2.2, centerY: false },
  '/assets/models/aircraft/f22.glb': { yaw: -Math.PI / 2, length: 18.9, centerY: true },
  '/assets/models/aircraft/su27.glb': { yaw: 0, length: 21.9, centerY: true },
  '/assets/models/aircraft/j11b.glb': { yaw: Math.PI, length: 21.9, centerY: true },
  '/assets/models/aircraft/su57.glb': { yaw: -Math.PI / 2, length: 20.1, centerY: true },
  '/assets/models/aircraft/fa18.glb': { yaw: Math.PI / 2, length: 18.3, centerY: true },
  '/assets/models/aircraft/f14.glb': { yaw: Math.PI / 2, length: 19.1, centerY: true },
  '/assets/models/aircraft/ya10b.glb': { yaw: Math.PI / 2, length: 16.3, centerY: true },
  '/assets/models/aircraft/ah64d.glb': { yaw: Math.PI / 2, length: 15.2, centerY: true },
  '/assets/models/aircraft/ah1w.glb': { yaw: Math.PI, length: 14.7, centerY: true },
  '/assets/models/aircraft/uh60m.glb': { yaw: Math.PI, length: 15.8, centerY: true },

  '/assets/models/vehicles/abrams.glb': { yaw: Math.PI / 2, length: 9.7, ground: true, hideFar: true },
  '/assets/models/vehicles/tank_heavy.glb': { yaw: -Math.PI / 2, length: 9.9, ground: true },
  '/assets/models/vehicles/tank_ifv.glb': { yaw: -Math.PI / 2, length: 7.4, ground: true },
  '/assets/models/vehicles/tank_aa.glb': { yaw: -Math.PI / 2, length: 7.8, ground: true },
  '/assets/models/vehicles/fuel_truck.glb': { yaw: 0, length: 8.5, ground: true },

  '/assets/models/weapons/aim9l.glb': { yaw: 0, length: 2.9, centerY: true },
  '/assets/models/weapons/aim120b.glb': { yaw: 0, length: 3.65, centerY: true },

  '/assets/models/units/soldier_animated.glb': { yaw: Math.PI, height: 1.85, ground: true, skinned: true },
  '/assets/models/units/swat.glb': { yaw: Math.PI, height: 1.85, ground: true, skinned: true },

  '/assets/models/world/harbor_crane.glb': { yaw: 0, height: 22.0, ground: true },
  '/assets/models/world/industrial_b.glb': { yaw: 0, height: 14.0, ground: true },
  '/assets/models/world/industrial_d.glb': { yaw: 0, height: 16.0, ground: true },
  '/assets/models/world/city_tower_1.glb': { yaw: 0, height: 34.0, ground: true },
  '/assets/models/world/city_tower_2.glb': { yaw: 0, height: 42.0, ground: true },
  '/assets/models/world/city_block_3.glb': { yaw: 0, height: 28.0, ground: true },
  '/assets/models/world/city_4story.glb': { yaw: 0, height: 20.0, ground: true },
  '/assets/models/world/city_6story.glb': { yaw: 0, height: 30.0, ground: true },
  '/assets/models/world/pine_tree.glb': { yaw: 0, height: 11.5, ground: true },
  '/assets/models/world/common_tree.glb': { yaw: 0, height: 9.5, ground: true },
  '/assets/models/world/rock_1.glb': { yaw: 0, height: 4.5, ground: true },
  '/assets/models/world/ph_flood_lights/flood_lights_1k.gltf': { yaw: 0, height: 6.2, ground: true },
  '/assets/models/world/ph_concrete_road_barrier/concrete_road_barrier_1k.gltf': { yaw: 0, height: 1.15, ground: true },
  '/assets/models/world/ph_ammo_box/ammo_box_1k.gltf': { yaw: 0, height: 0.45, ground: true },
  '/assets/models/world/ph_old_military_crate/old_military_crate_1k.gltf': { yaw: 0, height: 0.85, ground: true },
  '/assets/models/world/ph_Barrel_01/Barrel_01_1k.gltf': { yaw: 0, height: 1.05, ground: true },
  '/assets/models/world/ph_portable_generator/portable_generator_1k.gltf': { yaw: 0, height: 1.25, ground: true },
  '/assets/models/world/ph_boulder_01/boulder_01_1k.gltf': { yaw: 0, height: 4.2, ground: true },
};

export class AssetManager {
  constructor() {
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    this.hdrLoader = new HDRLoader();
    this.texLoader = new THREE.TextureLoader();

    this.modelCache = new Map();
    this.texCache = new Map();
    this.hdrCache = new Map();
  }

  async init() {
    await MeshoptDecoder.ready;
  }

  loadTexture(url, srgb = true) {
    if (this.texCache.has(url)) return Promise.resolve(this.texCache.get(url));
    return new Promise((resolve, reject) => {
      this.texLoader.load(
        url,
        (tex) => {
          tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          this.texCache.set(url, tex);
          resolve(tex);
        },
        undefined,
        reject
      );
    });
  }

  loadHDRI(url) {
    if (this.hdrCache.has(url)) return Promise.resolve(this.hdrCache.get(url));
    return new Promise((resolve, reject) => {
      this.hdrLoader.load(
        url,
        (tex) => {
          tex.mapping = THREE.EquirectangularReflectionMapping;
          this.hdrCache.set(url, tex);
          resolve(tex);
        },
        undefined,
        reject
      );
    });
  }

  async loadRawGLTF(url) {
    if (this.modelCache.has(url)) return this.modelCache.get(url);
    const gltf = await new Promise((resolve, reject) => {
      this.gltfLoader.load(url, resolve, undefined, reject);
    });
    this.modelCache.set(url, gltf);
    return gltf;
  }

  /**
   * Instantiates a normalized, shadow-ready Three.js Group for any asset URL.
   * Returns { root, animations, turretPivot, gunPivot, rotorMain, rotorTail }
   */
  async instantiate(url, livery = null) {
    const gltf = await this.loadRawGLTF(url);
    const preset = MODEL_PRESETS[url] || { yaw: 0, height: 4.0, ground: true };

    const clone = preset.skinned ? SkeletonUtils.clone(gltf.scene) : gltf.scene.clone(true);

    // Clone materials if we apply a custom livery tint so we don't mutate cached originals
    clone.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (preset.hideFar && obj.name.endsWith('_far')) {
          obj.visible = false;
        }
        if (livery && obj.material) {
          obj.material = obj.material.clone();
          const m = obj.material;
          // Preserve glass canopies & emissives
          const isGlass = m.transparent || (m.name && /glass|canopy|visor/i.test(m.name));
          if (!isGlass && m.color) {
            m.color.lerp(new THREE.Color(livery.tint), 0.35);
            if (typeof m.roughness === 'number') m.roughness = THREE.MathUtils.lerp(m.roughness, livery.roughness, 0.45);
            if (typeof m.metalness === 'number') m.metalness = THREE.MathUtils.lerp(m.metalness, livery.metalness, 0.35);
          }
        }
      }
    });

    // Apply initial orientation pivot
    const oriented = new THREE.Group();
    clone.rotation.y = preset.yaw || 0;
    oriented.add(clone);
    oriented.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(oriented);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    let scaleFactor = 1.0;
    if (preset.length) {
      const horizMax = Math.max(size.x, size.z) || 1;
      scaleFactor = preset.length / horizMax;
    } else if (preset.height) {
      const h = size.y || 1;
      scaleFactor = preset.height / h;
    }

    oriented.scale.setScalar(scaleFactor);
    oriented.position.set(
      -center.x * scaleFactor,
      preset.ground ? -box.min.y * scaleFactor : preset.centerY ? -center.y * scaleFactor : 0,
      -center.z * scaleFactor
    );

    const root = new THREE.Group();
    root.add(oriented);
    root.updateMatrixWorld(true);

    // Locate articulated turret / gun / helicopter rotor pivots if present
    let turretPivot = null;
    let gunPivot = null;
    let rotorMain = null;
    let rotorTail = null;

    if (url.includes('abrams.glb')) {
      const wNear = clone.getObjectByName('weapon_near');
      const bNear = clone.getObjectByName('barrel_near');
      if (wNear) {
        turretPivot = new THREE.Group();
        clone.add(turretPivot);
        turretPivot.attach(wNear);
        if (bNear) {
          gunPivot = new THREE.Group();
          turretPivot.add(gunPivot);
          gunPivot.attach(bNear);
        }
      }
    } else if (url.includes('tank_heavy.glb') || url.includes('tank_ifv.glb') || url.includes('tank_aa.glb')) {
      const turret = clone.getObjectByName('Tank_Turret');
      const gun = clone.getObjectByName('Tank_Gun');
      if (turret) {
        turretPivot = new THREE.Group();
        turret.parent.add(turretPivot);
        turretPivot.attach(turret);
        if (gun) {
          gunPivot = new THREE.Group();
          turretPivot.add(gunPivot);
          gunPivot.attach(gun);
        }
      }
    } else if (url.includes('uh60m.glb')) {
      rotorMain = clone.getObjectByName('main_rotor_prop_7') || clone.getObjectByName('main rotor prop_7');
      rotorTail = clone.getObjectByName('Object_4');
    }

    return {
      root,
      oriented,
      clone,
      animations: gltf.animations || [],
      turretPivot,
      gunPivot,
      rotorMain,
      rotorTail,
    };
  }
}
