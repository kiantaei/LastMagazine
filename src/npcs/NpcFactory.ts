import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { normalizeCharacter, type Assets } from '../core/Assets';

export type BodyType = 'average' | 'fat' | 'thin' | 'muscular';
export type NpcStyle = 'full' | 'summer' | 'beach';

/**
 * Procedural NPC variety: every pedestrian is the same cheap base model,
 * diversified at spawn with (1) per-instance material clones recolored by
 * palette (outfit style, skin tone, hair) and (2) non-uniform XYZ scaling
 * for body types. No extra model downloads, no extra skeletons.
 */

const BODY_SCALES: Record<BodyType, [number, number, number]> = {
  average: [1.0, 1.0, 1.0],
  fat: [1.32, 0.99, 1.3],
  thin: [0.8, 1.03, 0.85],
  muscular: [1.16, 1.0, 1.08],
};
const BODY_WEIGHTS: Array<[BodyType, number]> = [
  ['average', 0.4],
  ['fat', 0.2],
  ['thin', 0.2],
  ['muscular', 0.2],
];

const SKIN_TONES = [0xf2c9a0, 0xe0b189, 0xc98e63, 0xa96f48, 0x8a5533, 0x6b4226];
const HAIR_COLORS = [0x181410, 0x33251a, 0x5a3f24, 0x8a6a3a, 0xb9b9bd, 0x54545a, 0x703a20];
const FULL_SHIRTS = [0x5a6a4a, 0x6a4a3a, 0x3a4a5c, 0x50403a, 0x2e3238, 0x5c2e2e, 0x37543c, 0x54424e];
const SUMMER_SHIRTS = [0xe8e2d4, 0xe06a4a, 0x4a9ad4, 0xd8c04a, 0x4ac0a0, 0xd87aa0];
const BEACH_TEES = [0xe86a8a, 0x3ac0d4, 0xe8c83a, 0x8a5ad4];
const FULL_PANTS = [0x3a4258, 0x2a2d33, 0x4a3a2c, 0x33393f, 0x1e2430, 0x46394a];
const SHORTS = [0xc43a3a, 0xd8b432, 0x2aa198, 0xe8e2d4, 0xe07a2a, 0x3a6ac4];

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function pickBodyType(): BodyType {
  const r = Math.random();
  let acc = 0;
  for (const [type, w] of BODY_WEIGHTS) {
    acc += w;
    if (r <= acc) return type;
  }
  return 'average';
}

export interface NpcVariantOptions {
  style?: NpcStyle;
  bodyType?: BodyType;
  /** override outfit colors (used for the police uniform) */
  shirt?: number;
  pants?: number;
  skin?: number;
  hair?: number;
  /** final model height in meters (civilians 1.75, seated drivers ~1.5) */
  height?: number;
  bald?: boolean;
}

export interface NpcVariant {
  group: THREE.Group;
  bodyType: BodyType;
  style: NpcStyle;
}

/** pick a random civilian look: mostly full outfits, some summer, some beach */
export function randomCivilianStyle(): NpcStyle {
  const r = Math.random();
  if (r < 0.58) return 'full';
  if (r < 0.82) return 'summer';
  return 'beach';
}

/**
 * Build one varied NPC from the shared base model. Feet stay on y=0 (the
 * body scale pivots at the group origin, so walk/run cycles keep contact).
 */
export function makeNpcVariant(assets: Assets, opts: NpcVariantOptions = {}): NpcVariant {
  const style = opts.style ?? randomCivilianStyle();
  const bodyType = opts.bodyType ?? pickBodyType();

  const skin = opts.skin ?? pick(SKIN_TONES);
  const hair = opts.hair ?? pick(HAIR_COLORS);
  let shirt: number;
  let pants: number;
  if (opts.shirt !== undefined && opts.pants !== undefined) {
    shirt = opts.shirt;
    pants = opts.pants;
  } else if (style === 'full') {
    shirt = pick(FULL_SHIRTS);
    pants = pick(FULL_PANTS);
  } else if (style === 'summer') {
    shirt = pick(SUMMER_SHIRTS);
    pants = pick(SHORTS);
  } else {
    // beach: bare chest (skin-tone shirt) or a loud beach tee, always shorts
    shirt = Math.random() < 0.62 ? skin : pick(BEACH_TEES);
    pants = pick(SHORTS);
  }

  const model = skeletonClone(assets.man.template) as THREE.Group;
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.material = mats.map((m) => {
      const std = (m as THREE.MeshStandardMaterial).clone();
      switch (std.name) {
        case 'Shirt':
          std.color.setHex(shirt);
          std.roughness = 0.85;
          break;
        case 'Pants':
          std.color.setHex(pants);
          std.roughness = 0.9;
          break;
        case 'Skin':
          std.color.setHex(skin);
          std.roughness = 0.72;
          break;
        case 'Hair':
          std.color.setHex(hair);
          break;
      }
      return std;
    });
    if (opts.bald && mats.some((m) => (m as THREE.MeshStandardMaterial).name === 'Hair')) {
      mesh.visible = false;
    }
  });

  const norm = normalizeCharacter(model, opts.height ?? 1.75);
  const [sx, sy, sz] = BODY_SCALES[bodyType];
  const heightJitter = 0.94 + Math.random() * 0.12;
  norm.group.scale.set(sx, sy * heightJitter, sz);
  norm.group.traverse((o) => {
    (o as THREE.Mesh).frustumCulled = false; // skinned bbox culling glitches
  });

  return { group: norm.group, bodyType, style };
}
