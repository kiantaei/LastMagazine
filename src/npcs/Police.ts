import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../core/Assets';
import type { Collider } from '../world/City';
import { Car } from '../vehicles/Car';
import type { WorldFx } from '../weapons/Fx';

export interface PoliceHooks {
  onPlayerHit: (damage: number, fromPos: THREE.Vector3) => void;
  onNearMiss: (pos: THREE.Vector3) => void;
  onCopKilled: () => void;
}

export interface PoliceCtx {
  dt: number;
  playerPos: THREE.Vector3;
  playerEye: THREE.Vector3;
  playerDriving: boolean;
  playerCarSpeed: number;
  /** the car the player is driving (null on foot) */
  playerCar: Car | null;
  hittables: THREE.Object3D[];
}

const TMP_V1 = new THREE.Vector3();
const TMP_V2 = new THREE.Vector3();

/**
 * One police pursuit unit: a cop car with a uniformed driver, pure-pursuit
 * chase AI, wall-aware steering, window firefights and a physical wreck
 * state when shot to destruction.
 */
export class PoliceUnit {
  readonly car: Car;
  private driverScene: THREE.Group;
  private fx: WorldFx;
  private hooks: PoliceHooks;
  private ray = new THREE.Raycaster();
  private burstLeft = 0;
  private burstCd = 2;
  private shotCd = 0;
  active = false;
  private dead = false;
  private despawnT = -1;
  private stuckT = 0;
  private lastPos = new THREE.Vector3();

  constructor(
    car: Car,
    assets: Assets,
    fx: WorldFx,
    hooks: PoliceHooks,
  ) {
    this.car = car;
    this.fx = fx;
    this.hooks = hooks;
    // uniformed driver: navy shirt, dark pants, dark hair
    this.driverScene = skeletonClone(assets.man.template) as THREE.Group;
    const seats: Record<string, number> = { Shirt: 0x2b3a5c, Pants: 0x1e2740, Hair: 0x181820 };
    this.driverScene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial;
          if (std?.name && seats[std.name] !== undefined) std.color.setHex(seats[std.name]);
          mesh.frustumCulled = false;
        }
      }
    });
    this.driverScene.scale.setScalar(0.94);
    this.driverScene.position.set(0, -0.12, 0);
    this.driverScene.rotation.set(0, 0, 0);
    car.setDriver(this.driverScene);
    car.policeUnit = this;
  }

  get activeState(): boolean {
    return this.active && !this.dead;
  }

  deploy(pos: THREE.Vector3, yaw: number): void {
    this.car.placeAt(pos, yaw);
    this.car.group.visible = true;
    this.active = true;
    this.dead = false;
    this.despawnT = -1;
    this.burstLeft = 0;
    this.burstCd = 1.5 + Math.random();
    this.stuckT = 0;
    this.lastPos.copy(pos);
    this.car.hp = 130;
  }

  /** wrecked by gunfire or dismissed at zero wanted — clean up */
  dismiss(): void {
    this.active = false;
    this.car.group.visible = false;
    this.car.speed = 0;
  }

  update(c: PoliceCtx): void {
    if (!this.active) return;
    const dt = c.dt;

    if (this.car.wrecked) {
      this.car.update(dt, 0, 1, 0, false);
      if (this.despawnT < 0) {
        this.despawnT = 9;
        this.hooks.onCopKilled();
        this.fx.flash.spawn(TMP_V1.copy(this.car.pos).setY(1.2), 2.6);
      }
      this.despawnT -= dt;
      return;
    }

    const toPlayer = TMP_V1.subVectors(c.playerPos, this.car.pos);
    toPlayer.y = 0;
    const dist = toPlayer.length();

    // --- chase steering (pure pursuit + stuck wiggle) ----------------------
    const targetYaw = Math.atan2(toPlayer.x, toPlayer.z);
    let dy = targetYaw - this.car.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    let steer = Math.max(-1, Math.min(1, dy * 1.6));

    this.stuckT += dt;
    if (this.stuckT > 1.1) {
      const moved = this.car.pos.distanceTo(this.lastPos);
      if (moved < 1.2 && dist > 6) {
        // wedged against a wall — back out while turning
        this.car.update(dt, 0, 1, steer >= 0 ? -1 : 1, false);
        this.stuckT = 0.35;
        this.lastPos.copy(this.car.pos);
        return;
      }
      this.stuckT = 0;
      this.lastPos.copy(this.car.pos);
    }

    // stop-and-shoot when close, brake to avoid ramming through the player
    const wantStop = dist < 13;
    const throttle = wantStop ? (this.car.speed > 4 ? 0 : 0.35) : 1;
    const brake = wantStop && this.car.speed > 6 ? 0.5 : 0;
    this.car.update(dt, throttle, brake, steer, false);
    void steer;

    // --- window fire ---------------------------------------------------------
    this.burstCd -= dt;
    if (this.burstLeft > 0) {
      this.shotCd -= dt;
      if (this.shotCd <= 0 && dist < 30) {
        this.shotCd = 0.14 + Math.random() * 0.04;
        this.burstLeft--;
        this.fireShot(c, dist);
      }
    } else if (this.burstCd <= 0 && dist < 26) {
      this.burstLeft = 2 + Math.floor(Math.random() * 3);
      this.burstCd = 1.1 + Math.random() * 1.4;
    }
  }

  private fireShot(c: PoliceCtx, dist: number): void {
    this.car.windowPos(TMP_V2);
    this.fx.flash.spawn(TMP_V2, 0.6);
    this.fx.sfx.distantShot(TMP_V2);

    const eye = c.playerEye;
    let chance = 0.34 * Math.max(0.3, 1 - (dist - 6) / 34);
    if (c.playerDriving) chance *= 0.75;
    if (c.playerCarSpeed > 9) chance *= 0.7;

    const hit = Math.random() < chance;
    const end = TMP_V1.copy(eye);
    if (hit) {
      end.x += (Math.random() - 0.5) * 0.2;
      end.y += (Math.random() - 0.5) * 0.2;
      this.hooks.onPlayerHit(5 + Math.random() * 5, TMP_V2);
    } else {
      end.x += (Math.random() - 0.5) * 2.6;
      end.y += (Math.random() - 0.5) * 1.8 + 0.4;
      end.z += (Math.random() - 0.5) * 2.6;
      this.hooks.onNearMiss(end);
    }

    const dir = new THREE.Vector3().subVectors(end, TMP_V2);
    const maxDist = dir.length();
    dir.divideScalar(maxDist);
    this.ray.set(TMP_V2, dir);
    this.ray.far = maxDist;
    const hits = this.ray.intersectObjects(c.hittables, false);
    let tracerEnd = end;
    if (hits.length > 0) {
      tracerEnd = hits[0].point;
      const n = hits[0].face
        ? hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld)
        : dir.clone().negate();
      this.fx.impacts.spawn(tracerEnd, n, 'world');
    }
    this.fx.tracers.spawn(TMP_V2, tracerEnd);
  }

  /** bullets from the player */
  damage(amount: number, point: THREE.Vector3, dir: THREE.Vector3): boolean {
    if (!this.active || this.car.wrecked) return false;
    this.fx.impacts.spawn(point, TMP_V2.copy(dir).negate(), 'world');
    const wrecked = this.car.damage(amount);
    return wrecked;
  }
}

/**
 * Police response director: keeps the right number of pursuit units on the
 * road for the current wanted level, spawns them on the outer roads and
 * retires them when the heat dies down.
 */
export class Police {
  readonly units: PoliceUnit[] = [];
  /** cop car meshes for the shared shootables list */
  readonly hittables: THREE.Mesh[] = [];

  constructor(
    scene: THREE.Scene,
    assets: Assets,
    fx: WorldFx,
    colliders: Collider[],
    private hooks: PoliceHooks,
    carHooks: { onCrash: (impact: number, pos: THREE.Vector3) => void; onCivilianHit: (civ: unknown, pos: THREE.Vector3) => void },
  ) {
    for (let i = 0; i < 5; i++) {
      const car = new Car('cop', assets, colliders, carHooks);
      car.group.visible = false;
      scene.add(car.group);
      const unit = new PoliceUnit(car, assets, fx, hooks);
      this.units.push(unit);
      this.hittables.push(...car.hittableMeshes);
    }
  }

  /** desired active units from the wanted stars */
  updateCount(stars: number, spawnPoints: THREE.Vector3[], playerPos: THREE.Vector3): void {
    const want = Math.min(stars, this.units.length);
    let active = this.units.filter((u) => u.activeState).length;
    // retire extra units (heat died down)
    for (const u of this.units) {
      if (active <= want) break;
      if (u.activeState) {
        u.dismiss();
        active--;
      }
    }
    // deploy new ones far from the player
    while (active < want) {
      const slot = this.units.find((u) => !u.active);
      if (!slot) break;
      let best = spawnPoints[0];
      let bestD = -1;
      for (const p of spawnPoints) {
        const d = p.distanceTo(playerPos);
        if (d > bestD) {
          bestD = d;
          best = p;
        }
      }
      const yaw = Math.atan2(playerPos.x - best.x, playerPos.z - best.z);
      slot.deploy(best, yaw);
      active++;
    }
  }

  update(dt: number, ctx: Omit<PoliceCtx, 'dt'>): void {
    for (const u of this.units) {
      if (u.active) u.update({ ...ctx, dt });
    }
  }

  get aliveCount(): number {
    return this.units.filter((u) => u.activeState).length;
  }

  /** nearest active unit distance — drives the siren volume */
  nearestDist(pos: THREE.Vector3): number {
    let d = Infinity;
    for (const u of this.units) {
      if (!u.activeState) continue;
      d = Math.min(d, u.car.pos.distanceTo(pos));
    }
    return d;
  }

  reset(): void {
    for (const u of this.units) u.dismiss();
  }
}
