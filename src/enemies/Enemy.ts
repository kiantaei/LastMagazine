import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Collider } from '../world/MapBuilder';
import type { SFX } from '../audio/SFX';
import type { FlashPool, TracerPool, ImpactPool } from '../weapons/Fx';
import { normalizeCharacter, normalizeGun, type Assets } from '../core/Assets';

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

const SOLDIER_HEIGHT = 1.78;
const RIFLE_LENGTH = 0.78;

const TMP_V1 = new THREE.Vector3();
const TMP_V2 = new THREE.Vector3();

/**
 * Hostile operative: a rigged, animation-driven GLTF soldier with
 * advance/combat AI, line-of-sight checks, burst fire with distance-based
 * accuracy, invisible zone hitboxes and a physical death fall.
 */
export class Enemy {
  readonly group = new THREE.Group();
  readonly hitMeshes: THREE.Mesh[] = [];
  hp = 100;
  state: 'advance' | 'combat' | 'dead' = 'advance';

  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<'Idle' | 'Walk' | 'Run', THREE.AnimationAction>> = {};
  private currentAction: THREE.AnimationAction | null = null;
  private muzzleRef = new THREE.Object3D();
  private ray = new THREE.Raycaster();

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

  constructor(scene: THREE.Scene, assets: Assets) {
    // --- animated soldier -------------------------------------------------
    const soldier = skeletonClone(assets.soldier.scene);
    soldier.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.frustumCulled = false; // skinned bbox culling glitches
      }
    });
    const norm = normalizeCharacter(soldier, SOLDIER_HEIGHT);
    this.group.add(norm.group);

    this.mixer = new THREE.AnimationMixer(soldier);
    for (const clip of assets.soldier.clips) {
      if (clip.name === 'Idle' || clip.name === 'Walk' || clip.name === 'Run') {
        this.actions[clip.name] = this.mixer.clipAction(clip);
      }
    }

    // --- rifle slung at chest ----------------------------------------------
    const rifle = normalizeGun(assets.ar.scene, RIFLE_LENGTH);
    rifle.group.position.set(0.17, 1.16, -0.2);
    rifle.group.rotation.set(0.12, 0, -0.08);
    this.group.add(rifle.group);

    this.muzzleRef.position.set(0.17, 1.22, -0.66);
    this.group.add(this.muzzleRef);

    // --- invisible hit zones ------------------------------------------------
    // colorWrite/depthWrite off: guaranteed not to draw, still raycast-able
    const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const hitbox = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      part: Part,
    ): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hitMat);
      m.position.set(x, y, z);
      m.userData.enemy = this;
      m.userData.mult = PART_MULT[part];
      this.group.add(m);
      this.hitMeshes.push(m);
    };
    hitbox(0.26, 0.3, 0.28, 0, 1.62, 0, 'head');
    hitbox(0.44, 0.64, 0.36, 0, 1.12, 0, 'torso');
    hitbox(0.42, 0.92, 0.34, 0, 0.45, 0, 'limb');

    scene.add(this.group);
    this.deactivate();
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
    if (this.mixer) this.mixer.timeScale = 1;
    this.setAnim('Run');
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
    if (this.hp <= 0) this.die(dir);
  }

  private die(dir: THREE.Vector3): void {
    this.state = 'dead';
    this.deathT = 0;
    this.burstLeft = 0;
    this.fallAxis.set(dir.z, 0, -dir.x).normalize();
    if (this.mixer) this.mixer.stopAllAction();
    this.onKilled?.();
  }

  update(c: EnemyContext): void {
    if (this.state === 'dead') {
      this.updateDeath(c.dt);
      return;
    }
    const dt = c.dt;
    this.mixer?.update(dt);
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
        this.setAnim('Idle');
      } else {
        this.advance(c, toPlayer, dist);
      }
    }
    if (this.state === 'combat') {
      if (!this.hasLOS || dist > this.preferredRange + 4) {
        this.state = 'advance';
        this.setAnim('Run');
      } else {
        this.combat(c, toPlayer, dist);
      }
    }

    // face the player when engaging
    if (this.state === 'combat') {
      const targetYaw = Math.atan2(toPlayer.x, toPlayer.z);
      let dy = targetYaw - this.group.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.group.rotation.y += dy * Math.min(1, c.dt * 7);
    }
  }

  private setAnim(name: 'Idle' | 'Walk' | 'Run', fade = 0.22): void {
    const next = this.actions[name];
    if (!next || this.currentAction === next) return;
    next.reset().fadeIn(fade).play();
    this.currentAction?.fadeOut(fade);
    this.currentAction = next;
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
    if (this.mixer) this.mixer.timeScale = Math.min(1.15, Math.max(0.65, speed / 3.1));
    const len = Math.hypot(dirX, dirZ) || 1;
    this.moveBy((dirX / len) * speed * dt, (dirZ / len) * speed * dt, c.colliders);
  }

  private combat(c: EnemyContext, toPlayer: THREE.Vector3, dist: number): void {
    const dt = c.dt;
    if (this.mixer) this.mixer.timeScale = 1;
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
    c.fx.flash.spawn(muzzle, 0.7);
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
      if (col.max.y < 0.35 || col.min.y > 1.75) continue;
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
