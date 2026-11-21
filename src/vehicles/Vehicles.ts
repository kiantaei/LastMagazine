import * as THREE from 'three';
import type { Assets } from '../core/Assets';
import type { Collider, ParkingSpot } from '../world/City';
import { Car } from './Car';

export interface VehiclesHooks {
  onCrash: (impact: number, pos: THREE.Vector3) => void;
  onCivilianHit: (civ: unknown, pos: THREE.Vector3) => void;
}

const TMP_V = new THREE.Vector3();

const PARKED_TINTS = [0x7d2f2a, 0x2f4d3a, 0x8a8f96, 0x3a3f47, 0x6b5a2f, 0x274a6b, 0x8f867a];

/**
 * World vehicle pool: parked civilian cars on roadside spots (stealable with
 * E) plus runtime management for the car the player is driving.
 */
export class Vehicles {
  readonly cars: Car[] = [];
  /** all car body meshes, registered into the shared shootables list */
  readonly hittables: THREE.Mesh[] = [];

  constructor(
    scene: THREE.Scene,
    assets: Assets,
    colliders: Collider[],
    parking: ParkingSpot[],
    hooks: VehiclesHooks,
  ) {
    const rnd = (n: number) => Math.floor(Math.random() * n);
    // fill ~two thirds of the parking spots with parked cars
    const spots = [...parking].sort(() => Math.random() - 0.5);
    const count = Math.min(spots.length, 14);
    for (let i = 0; i < count; i++) {
      const spot = spots[i];
      const kind = (['sedan', 'suv', 'taxi'] as const)[rnd(3)];
      const car = new Car(kind, assets, colliders, hooks, PARKED_TINTS[i % PARKED_TINTS.length]);
      car.placeAt(spot.pos, spot.yaw);
      scene.add(car.group);
      this.cars.push(car);
      this.hittables.push(...car.hittableMeshes);
    }
  }

  /** nearest enterable car within maxDist of pos (wrecks excluded) */
  nearest(pos: THREE.Vector3, maxDist = 3.6): Car | null {
    let best: Car | null = null;
    let bestD = maxDist;
    for (const car of this.cars) {
      if (car.wrecked) continue;
      const d = car.pos.distanceTo(pos);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  /** crude car-vs-car separation so cars don't overlap (parked vs driven) */
  separate(exclude: Car | null): void {
    for (const a of this.cars) {
      if (a === exclude) continue;
      for (const b of this.cars) {
        if (a === b || b === exclude) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        const minD = 3.4;
        if (d2 < minD * minD && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = ((minD - d) / d) * 0.5;
          a.pos.x -= dx * push;
          a.pos.z -= dz * push;
          b.pos.x += dx * push;
          b.pos.z += dz * push;
        }
      }
    }
  }

  /** point the player at the closest car ahead for the interact hint */
  aheadOf(pos: THREE.Vector3, fwd: THREE.Vector3, maxDist = 4.4): Car | null {
    let best: Car | null = null;
    let bestScore = 0.55;
    for (const car of this.cars) {
      if (car.wrecked || car.driven) continue;
      TMP_V.subVectors(car.pos, pos);
      TMP_V.y = 0;
      const d = TMP_V.length();
      if (d > maxDist) continue;
      TMP_V.divideScalar(d);
      const dot = TMP_V.dot(fwd);
      if (dot > bestScore) {
        bestScore = dot;
        best = car;
      }
    }
    return best;
  }
}
