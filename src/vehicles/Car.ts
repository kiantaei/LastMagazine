import * as THREE from 'three';
import { normalizeVehicle, type Assets, type CarKind, type CarAsset } from '../core/Assets';
import type { Collider } from '../world/City';

const CAR_LENGTH: Record<CarKind, number> = { sedan: 4.3, suv: 4.35, taxi: 4.3, cop: 4.45 };
const CAR_MAX_SPEED: Record<CarKind, number> = { sedan: 15, suv: 13.5, taxi: 15, cop: 17.5 };
const CAR_ACCEL: Record<CarKind, number> = { sedan: 8.5, suv: 7.5, taxi: 8.5, cop: 10 };

export interface CarHooks {
  onCrash: (impact: number, pos: THREE.Vector3) => void;
  onCivilianHit: (civ: unknown, pos: THREE.Vector3) => void;
}

const TMP_V = new THREE.Vector3();

/**
 * One drivable car. Arcade physics: forward speed + yaw steering, AABB
 * probes for building collisions, a driver seat anchor for persona models,
 * headlight spots (driven car only) and a flashing lightbar for cop cars.
 * Model space: nose +z, wheels on y=0 (normalizeVehicle).
 */
export class Car {
  readonly group = new THREE.Group();
  readonly kind: CarKind;
  readonly maxSpeed: number;
  readonly accel: number;
  speed = 0;
  yaw = 0;
  /** world-space AABB half-extents for car-vs-car separation */
  readonly half = new THREE.Vector2(1.05, 2.3);

  private readonly bodyMeshes: THREE.Mesh[] = [];
  private readonly asset: CarAsset;
  private readonly seat = new THREE.Object3D();
  private barPhase = 0;
  driver: THREE.Object3D | null = null;
  driven = false;
  hp = 130;
  wrecked = false;
  wreckT = 0;
  /** set for police units — used by bullets to find the unit */
  policeUnit: unknown = null;
  private readonly colliders: Collider[];
  private readonly hooks: CarHooks;

  constructor(kind: CarKind, assets: Assets, colliders: Collider[], hooks: CarHooks, tint?: number) {
    this.kind = kind;
    this.colliders = colliders;
    this.hooks = hooks;
    this.maxSpeed = CAR_MAX_SPEED[kind];
    this.accel = CAR_ACCEL[kind];
    this.asset = assets.cars[kind];

    const norm = normalizeVehicle(this.asset.scene, CAR_LENGTH[kind]);
    if (tint !== undefined && this.asset.bodyMat) this.asset.bodyMat.color.setHex(tint);
    norm.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.bodyMeshes.push(mesh);
      }
    });
    this.group.add(norm.group);

    // driver seat: left side, slightly behind the windshield line
    this.seat.position.set(-0.38, 0.62, 0.15);
    this.group.add(this.seat);

    // cop lightbar flash bars (in addition to the baked bar)
    if (kind === 'cop') {
      const barRed = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.09, 0.34),
        new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: 0 }),
      );
      barRed.position.set(-0.18, 1.28, 0.2);
      const barBlue = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.09, 0.34),
        new THREE.MeshStandardMaterial({ color: 0x000022, emissive: 0x2255ff, emissiveIntensity: 0 }),
      );
      barBlue.position.set(0.18, 1.28, 0.2);
      this.group.add(barRed, barBlue);
      this.barRed = barRed.material as THREE.MeshStandardMaterial;
      this.barBlue = barBlue.material as THREE.MeshStandardMaterial;
    }
  }

  private barRed: THREE.MeshStandardMaterial | null = null;
  private barBlue: THREE.MeshStandardMaterial | null = null;

  /** meshes that bullets can hit (body only, not windows) */
  get hittableMeshes(): THREE.Mesh[] {
    return this.bodyMeshes;
  }

  get pos(): THREE.Vector3 {
    return this.group.position;
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** driver seat anchor for the persona model */
  get seatAnchor(): THREE.Object3D {
    return this.seat;
  }

  /** muzzle-ish world position for tracers/flash when firing from the car */
  windowPos(out: THREE.Vector3): THREE.Vector3 {
    this.forward(TMP_V);
    out.copy(this.group.position);
    out.y += 1.15;
    out.x += Math.cos(this.yaw) * 0.5;
    out.z += -Math.sin(this.yaw) * 0.5;
    out.addScaledVector(TMP_V, 0.6);
    return out;
  }

  /**
   * Arcade driving step. throttle 0..1, brake 0..1, steer -1..1,
   * handbrake=true for slidey stops.
   */
  update(dt: number, throttle: number, brake: number, steer: number, handbrake: boolean): void {
    if (this.wrecked) {
      this.speed *= Math.max(0, 1 - 2.5 * dt);
      this.integrate(dt);
      return;
    }

    // longitudinal
    if (throttle > 0) this.speed += this.accel * throttle * dt * (this.speed < 0 ? 2.2 : 1);
    if (brake > 0) {
      if (this.speed > 0.4) this.speed -= 16 * brake * dt;
      else this.speed = Math.max(-5.5, this.speed - 5.5 * brake * dt); // reverse
    }
    if (throttle <= 0 && brake <= 0) this.speed *= Math.max(0, 1 - 0.7 * dt);
    if (handbrake) this.speed *= Math.max(0, 1 - 1.9 * dt);
    this.speed = Math.min(this.maxSpeed, this.speed);

    // steering scales in with speed, fades out near top speed
    const spd = Math.abs(this.speed);
    const grip = Math.min(1, spd / 4.5) * (1 - Math.min(0.55, spd / 42));
    const yawRate = steer * 2.1 * grip * (this.speed < 0 ? -1 : 1) * (handbrake ? 1.5 : 1);
    this.yaw += yawRate * dt;

    this.integrate(dt);
  }

  private integrate(dt: number): void {
    const fwd = this.forward(TMP_V);
    this.group.position.x += fwd.x * this.speed * dt;
    this.group.position.z += fwd.z * this.speed * dt;
    this.group.rotation.y = this.yaw;
    this.resolveWorldCollisions(fwd);
  }

  /** push the car out of building AABBs using front/rear probe points */
  private resolveWorldCollisions(fwd: THREE.Vector3): void {
    const p = this.group.position;
    for (const sign of [1, -1]) {
      const probeX = p.x + fwd.x * sign * 2.1;
      const probeZ = p.z + fwd.z * sign * 2.1;
      for (const col of this.colliders) {
        if (col.max.y < 0.6) continue;
        if (probeX <= col.min.x - 0.85 || probeX >= col.max.x + 0.85) continue;
        if (probeZ <= col.min.z - 0.85 || probeZ >= col.max.z + 0.85) continue;
        // penetration on each axis
        const pxl = probeX + 0.85 - col.min.x;
        const pxr = col.max.x + 0.85 - probeX;
        const pzl = probeZ + 0.85 - col.min.z;
        const pzr = col.max.z + 0.85 - probeZ;
        const m = Math.min(pxl, pxr, pzl, pzr);
        const impact = Math.abs(this.speed);
        if (m === pxl) p.x -= pxl;
        else if (m === pxr) p.x += pxr;
        else if (m === pzl) p.z -= pzl;
        else p.z += pzr;
        if (impact > 3) {
          this.hooks.onCrash(Math.min(1, impact / 16), p);
          this.speed *= -0.28;
        } else {
          this.speed *= 0.5;
        }
        break;
      }
    }
  }

  /** park at a spot */
  placeAt(pos: THREE.Vector3, yaw: number): void {
    this.group.position.copy(pos);
    this.yaw = yaw;
    this.speed = 0;
    this.group.rotation.y = yaw;
    this.wrecked = false;
    this.hp = 130;
  }

  setDriven(on: boolean): void {
    this.driven = on;
  }

  /** run-over check against one civilian (speed + distance gate inside) */
  checkCivilianImpact(civ: { group: THREE.Group }): void {
    if (this.wrecked || Math.abs(this.speed) < 3.5) return;
    if (civ.group.position.distanceTo(this.group.position) < 2.0) {
      this.hooks.onCivilianHit(civ, this.group.position);
    }
  }

  /** police lightbar animation; t in seconds */
  updateLights(t: number, active: boolean): void {
    if (this.kind !== 'cop') return;
    this.barPhase += t;
    if (!active) {
      if (this.barRed) this.barRed.emissiveIntensity = 0;
      if (this.barBlue) this.barBlue.emissiveIntensity = 0;
      return;
    }
    const phase = Math.floor(this.barPhase / 0.32) % 2;
    if (this.barRed) this.barRed.emissiveIntensity = phase === 0 ? 5 : 0.4;
    if (this.barBlue) this.barBlue.emissiveIntensity = phase === 1 ? 5 : 0.4;
  }

  /** sit a model in the driver seat (persona/cop) */
  setDriver(model: THREE.Object3D | null): void {
    if (this.driver) {
      this.seat.remove(this.driver);
      this.driver = null;
    }
    if (model) {
      this.seat.add(model);
      this.driver = model;
    }
  }

  damage(amount: number): boolean {
    if (this.wrecked) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.wrecked = true;
      this.wreckT = 0;
      // scorch the body
      for (const m of this.bodyMeshes) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mm of mats) {
          const std = mm as THREE.MeshStandardMaterial;
          if (std?.color) {
            std.color.multiplyScalar(0.25);
            std.roughness = 0.95;
          }
        }
      }
      return true;
    }
    return false;
  }
}
