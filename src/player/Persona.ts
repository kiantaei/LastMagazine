import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../core/Assets';
import { normalizeCharacter } from '../core/Assets';

export interface Persona {
  id: string;
  label: string;
  /** tint overrides applied to the named materials of the man model */
  tints: Partial<Record<'Shirt' | 'Pants' | 'Hair' | 'Skin', number>>;
  /** viewmodel glove tint */
  glove: number;
}

export const PERSONAS: Persona[] = [
  { id: 'civ', label: 'CIVILIAN · N. PRICE', tints: {}, glove: 0x2a2d33 },
  { id: 'gang', label: 'GANGSTER · M. KOVAC', tints: { Shirt: 0x15161a, Pants: 0x232428, Hair: 0x0d0d10 }, glove: 0x101114 },
  { id: 'cop', label: 'OFFICER · K. HALE', tints: { Shirt: 0x2b3a5c, Pants: 0x1e2740, Hair: 0x1a1a1a }, glove: 0x1c2536 },
];

/**
 * F5 character switching. Each persona is a recolored copy of the man
 * model (visible in the driver seat while driving) plus a viewmodel glove
 * tint so the change is felt on foot too.
 */
export class Personas {
  readonly variants: THREE.Group[] = [];
  index = 0;

  constructor(assets: Assets) {
    for (const p of PERSONAS) {
      const model = skeletonClone(assets.man.template);
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const std = m as THREE.MeshStandardMaterial;
            const tints = p.tints as Record<string, number | undefined>;
            if (std?.name && tints[std.name] !== undefined) std.color.setHex(tints[std.name]!);
          }
        }
      });
      // sized for the car seat (slightly tucked)
      const norm = normalizeCharacter(model, 1.5);
      norm.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.frustumCulled = false;
      });
      // sit pose: legs bent — rotate whole body slightly forward
      norm.group.rotation.x = 0.12;
      this.variants.push(norm.group);
    }
  }

  get current(): Persona {
    return PERSONAS[this.index];
  }

  get currentModel(): THREE.Group {
    return this.variants[this.index];
  }

  /** cycle → returns the new persona */
  next(): Persona {
    this.index = (this.index + 1) % PERSONAS.length;
    return this.current;
  }
}
