import * as THREE from 'three';
import type { Collider } from '../world/MapBuilder';
import type { SFX } from '../audio/SFX';
import type { FlashPool, TracerPool, ImpactPool } from '../weapons/Fx';

export interface EnemyFx {
  flash: FlashPool;
  tracers: TracerPool;
  impacts: ImpactPool;
  sfx: SFX;
}

export interface EnemyContext {
  dt: number;
  playerFeet: THREE.Vector3;
  playerEye: THREE.Vector3;
  playerSprinting: boolean;
  playerCrouching: boolean;
  colliders: Collider[];
  hittables: THREE.Object3D[];
  fx: EnemyFx;
  onPlayerHit: (damage: number, fromPos: THREE.Vector3) => void;
  onNearMiss: (pos: THREE.Vector3) => void;
}

type Part = 'head' | 'torso' | 'limb';
const PART_MULT: Record<Part, number> = { head: 2.4, torso: 1, limb: 0.6 };

const TMP_V1 = new THREE.Vector3();
const TMP_V2 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Hostile operative: box-built tactical figure with advance/combat AI,
 * line-of-sight checks, burst fire with distance-based accuracy,
 * zone damage (head/torso/limbs) and a physical death fall.
 */
export class Enemy {
  readonly group = new THREE.Group();
  readonly hitMeshes: THREE.Mesh[] = [];
  hp = 100;
  state: 'advance' | 'combat' | 'dead' = 'advance';

  private head!: THREE.Mesh;
  private torso!: THREE.Mesh;
  private legL!: THREE.Mesh;
  private legR!: THREE.Mesh;
  private muzzleRef = new THREE.Object3D();
  private ray = new THREE.Raycaster();

  private walkT = 0;
  private flinchT = 0;
  private losTimer = 0;
  private hasLOS = false;
  private preferredRange = 10;
  private advanceSpeed = 2.7;
  private strafeDir = 1;
  private strafeTimer = 0;
  private burstLeft = 0;
  private burstCd = 1;
  private shotCd = 0;
  private deathT = -1;
  private fallAxis = new THREE.Vector3(1, 0, 0);
  private stuckTimer = 0;
  private detourTimer = 0;
  private detourSign = 1;
  private lastPos = new THREE.Vector3();
  private toPlayerTmp = new THREE.Vector3();

  onKilled: (() => void) | null = null;

  constructor(scene: THREE.Scene) {
    this.build(scene);
    this.deactivate();
  }

  private build(scene: THREE.Scene): void {
    const uniform = new THREE.MeshStandardMaterial({ color: 0x242a26, roughness: 0.82, metalness: 0.12 });
    const gear = new THREE.MeshStandardMaterial({ color: 0x191d20, roughness: 0.7, metalness: 0.25 });
    const visor = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      emissive: 0x8a1616,
      emissiveIntensity: 1.4,
      roughness: 0.4,
    });

    const mk = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      part: Part | null,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.group.add(m);
      if (part) {
        m.userData.enemy = this;
        m.userData.mult = PART_MULT[part];
        this.hitMeshes.push(m);
      }
      return m;
    };

    // legs pivot at the hip: geometry translated down so origin sits on top
    const legGeo = new THREE.BoxGeometry(0.17, 0.88, 0.19);
    legGeo.translate(0, -0.44, 0);
    this.legL = mk(legGeo, gear, -0.11, 0.9, 0, 'limb');
    this.legR = mk(legGeo.clone(), gear, 0.11, 0.9, 0, 'limb');

    this.torso = mk(new THREE.BoxGeometry(0.44, 0.62, 0.28), uniform, 0, 1.22, 0, 'torso');
    mk(new THREE.BoxGeometry(0.48, 0.2, 0.3), gear, 0, 1.4, 0, 'torso'); // vest plate
    this.head = mk(new THREE.BoxGeometry(0.23, 0.25, 0.24), gear, 0, 1.68, 0, 'head');
    mk(new THREE.BoxGeometry(0.25, 0.09, 0.26), gear, 0, 1.79, 0, 'head'); // helmet
    mk(new THREE.BoxGeometry(0.19, 0.05, 0.02), visor, 0, 1.68, -0.13, null); // visor glow (no hit zone)

    // rifle held at the ready
    const rifle = mk(new THREE.BoxGeometry(0.05, 0.09, 0.52), gear, 0.18, 1.28, -0.22, null);
    rifle.rotation.x = 0.06;
    this.muzzleRef.position.set(0.18, 1.3, -0.5);
    this.group.add(this.muzzleRef);

    scene.add(this.group);
  }

  activate(pos: THREE.Vector3): void {
    this.hp = 100;
    this.state = 'advance';
    this.group.position.copy(pos);
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
    this.deathT = -1;
    this.flinchT = 0;
    this.losTimer = 0;
    this.hasLOS = false;
    this.preferredRange = 9 + Math.random() * 6;
    this.advanceSpeed = 2.5 + Math.random() * 0.9;
    this.burstLeft = 0;
    this.burstCd = 0.6 + Math.random() * 0.9;
    this.strafeTimer = 0;
    this.stuckTimer = 0;
    this.detourTimer = 0;
    this.lastPos.copy(pos);
    for (const m of this.hitMeshes) m.visible = true;
  }

  deactivate(): void {
    this.group.visible = false;
    this.state = 'dead';
    this.deathT = -1;
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  get eyePos(): THREE.Vector3 {
    return TMP_V2.set(this.group.position.x, this.group.position.y + 1.62, this.group.position.z);
  }

  damage(amount: number, point: THREE.Vector3, dir: THREE.Vector3, fx: EnemyFx): void {
    if (this.state === 'dead') return;
    this.hp -= amount;
    this.flinchT = 0.14;
    fx.impacts.spawn(point, TMP_V1.copy(dir).negate(), 'flesh');
    if (this.hp <= 0) this.die(dir, fx);
  }

  private die(dir: THREE.Vector3, fx: EnemyFx): void {
    this.state = 'dead';
    this.deathT = 0;
    this.burstLeft = 0;
    // fall away from the shot direction
    this.fallAxis.set(dir.z, 0, -dir.x).normalize();
    this.onKilled?.();
    void fx;
  }

  update(c: EnemyContext): void {
    if (this.state === 'dead') {
      this.updateDeath(c.dt);
      return;
    }
    const dt = c.dt;
    this.flinchT = Math.max(0, this.flinchT - dt);

    // line of sight, throttled
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.12 + Math.random() * 0.08;
      this.hasLOS = this.checkLOS(c);
    }

    const toPlayer = this.toPlayerTmp.subVectors(c.playerFeet, this.group.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    toPlayer.divideScalar(Math.max(dist, 0.001));

    if (this.state === 'advance') {
      if (dist < this.preferredRange && this.hasLOS) {
        this.state = 'combat';
        this.burstCd = 0.35 + Math.random() * 0.5;
      } else {
        this.advance(c, toPlayer, dist);
      }
    }
    if (this.state === 'combat') {
      if (!this.hasLOS || dist > this.preferredRange + 4) {
        this.state = 'advance';
      } else {
        this.combat(c, toPlayer, dist);
      }
    }

    // face the player when engaging
    const targetYaw = Math.atan2(toPlayer.x, toPlayer.z);
    if (this.state === 'combat') {
      let dy = targetYaw - this.group.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.group.rotation.y += dy * Math.min(1, dt * 7);
    }

    // walk animation
    const moving = this.state === 'advance';
    if (moving) {
      this.walkT += dt * 9;
      const swing = Math.sin(this.walkT) * 0.55;
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      this.group.position.y = Math.abs(Math.sin(this.walkT)) * 0.04;
    } else {
      this.legL.rotation.x *= 1 - Math.min(1, dt * 8);
      this.legR.rotation.x *= 1 - Math.min(1, dt * 8);
    }
  }

  private advance(c: EnemyContext, toPlayer: THREE.Vector3, dist: number): void {
    const dt = c.dt;
    let dirX = toPlayer.x;
    let dirZ = toPlayer.z;

    // detour when stuck against geometry
    this.stuckTimer += dt;
    if (this.stuckTimer > 0.55) {
      const moved = this.group.position.distanceTo(this.lastPos);
      if (moved < 0.12 && dist > 2) {
        this.detourTimer = 1.1;
        this.detourSign = Math.random() < 0.5 ? -1 : 1;
      }
      this.stuckTimer = 0;
      this.lastPos.copy(this.group.position);
    }
    if (this.detourTimer > 0) {
      this.detourTimer -= dt;
      dirX += -toPlayer.z * this.detourSign * 1.4;
      dirZ += toPlayer.x * this.detourSign * 1.4;
    }

    const speed = this.advanceSpeed * (this.flinchT > 0 ? 0.4 : 1);
    const len = Math.hypot(dirX, dirZ) || 1;
    this.moveBy((dirX / len) * speed * dt, (dirZ / len) * speed * dt, c.colliders);
  }

  private combat(c: EnemyContext, toPlayer: THREE.Vector3, dist: number): void {
    const dt = c.dt;
    // strafe around the player
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = 1.4 + Math.random() * 1.8;
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      if (Math.random() < 0.25) this.strafeDir = 0; // hold still and shoot
    }
    if (dist > this.preferredRange) {
      this.moveBy(toPlayer.x * 1.6 * dt, toPlayer.z * 1.6 * dt, c.colliders);
    } else if (dist < this.preferredRange * 0.55) {
      this.moveBy(-toPlayer.x * 1.8 * dt, -toPlayer.z * 1.8 * dt, c.colliders);
    }
    this.moveBy(-toPlayer.z * this.strafeDir * 1.7 * dt, toPlayer.x * this.strafeDir * 1.7 * dt, c.colliders);

    // burst fire
    if (this.flinchT > 0) return;
    if (this.burstLeft > 0) {
      this.shotCd -= dt;
      if (this.shotCd <= 0) {
        this.shotCd = 0.12 + Math.random() * 0.03;
        this.burstLeft--;
        this.fireShot(c);
      }
    } else {
      this.burstCd -= dt;
      if (this.burstCd <= 0) {
        this.burstLeft = 3 + Math.floor(Math.random() * 3);
        this.burstCd = 0.8 + Math.random() * 1.3;
      }
    }
  }

  private fireShot(c: EnemyContext): void {
    this.group.updateMatrixWorld(true);
    const muzzle = this.muzzleRef.getWorldPosition(TMP_V2);
    this.fxFlash(c, muzzle);
    c.fx.sfx.distantShot(muzzle);

    const eye = c.playerEye;
    const dist = muzzle.distanceTo(eye);
    let chance = 0.5 * Math.max(0.35, 1 - (dist - 10) / 55);
    if (c.playerSprinting) chance *= 0.7;
    if (c.playerCrouching) chance *= 0.8;

    const hit = Math.random() < chance;
    const end = TMP_V1.copy(eye);
    if (hit) {
      end.x += (Math.random() - 0.5) * 0.2;
      end.y += (Math.random() - 0.5) * 0.2;
      c.onPlayerHit(6 + Math.random() * 5, muzzle);
    } else {
      end.x += (Math.random() - 0.5) * 2.4;
      end.y += (Math.random() - 0.5) * 1.6 + 0.4;
      end.z += (Math.random() - 0.5) * 2.4;
      c.onNearMiss(end);
    }

    // tracer + world impact check
    const dir = new THREE.Vector3().subVectors(end, muzzle);
    const maxDist = dir.length();
    dir.divideScalar(maxDist);
    this.ray.set(muzzle, dir);
    this.ray.far = maxDist;
    const hits = this.ray.intersectObjects(c.hittables, false);
    let tracerEnd = end;
    if (hits.length > 0) {
      tracerEnd = hits[0].point;
      const n = hits[0].face
        ? hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld)
        : dir.clone().negate();
      c.fx.impacts.spawn(tracerEnd, n, 'world');
    }
    c.fx.tracers.spawn(muzzle, tracerEnd);
  }

  private fxFlash(c: EnemyContext, muzzle: THREE.Vector3): void {
    c.fx.flash.spawn(muzzle, 0.7);
  }

  private checkLOS(c: EnemyContext): boolean {
    const eye = this.eyePos;
    const target = c.playerEye;
    const dir = TMP_V1.subVectors(target, eye);
    const dist = dir.length();
    if (dist > 55) return false;
    dir.divideScalar(dist);
    this.ray.set(eye, dir);
    this.ray.far = dist - 0.4;
    const hits = this.ray.intersectObjects(c.hittables, false);
    return hits.length === 0;
  }

  private moveBy(dx: number, dz: number, colliders: Collider[]): void {
    const p = this.group.position;
    p.x += dx;
    p.z += dz;
    const r = 0.38;
    for (const col of colliders) {
      if (col.max.y < 0.35 || col.min.y > 1.75) continue; // overhead or ground trim
      if (p.x + r <= col.min.x || p.x - r >= col.max.x) continue;
      if (p.z + r <= col.min.z || p.z - r >= col.max.z) continue;
      const pxL = p.x + r - col.min.x;
      const pxR = col.max.x - (p.x - r);
      const pzL = p.z + r - col.min.z;
      const pzR = col.max.z - (p.z - r);
      const m = Math.min(pxL, pxR, pzL, pzR);
      if (m === pxL) p.x = col.min.x - r;
      else if (m === pxR) p.x = col.max.x + r;
      else if (m === pzL) p.z = col.min.z - r;
      else p.z = col.max.z + r;
    }
  }

  private updateDeath(dt: number): void {
    if (this.deathT < 0) return;
    this.deathT += dt;
    const t = Math.min(1, this.deathT / 0.65);
    const e = 1 - Math.pow(1 - t, 3);
    this.group.setRotationFromAxisAngle(this.fallAxis, e * (Math.PI / 2) * 0.92);
    this.group.position.y = -0.06 * e;
    if (this.deathT > 3.2 && this.deathT < 4.6) {
      this.group.position.y = -0.06 - (this.deathT - 3.2) * 0.6;
    }
    if (this.deathT >= 4.6) this.deactivate();
  }

  /** separation nudge from the manager so squads don't stack. */
  nudge(x: number, z: number): void {
    if (this.state === 'dead') return;
    this.group.position.x += x;
    this.group.position.z += z;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
  }
}
