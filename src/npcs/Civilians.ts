import * as THREE from 'three';
import type { Collider } from '../world/City';
import type { Assets } from '../core/Assets';
import type { WorldFx } from '../weapons/Fx';
import { makeNpcVariant, type NpcVariant } from './NpcFactory';

export interface NpcCtx {
  dt: number;
  playerPos: THREE.Vector3;
  playerDriving: boolean;
  playerCarSpeed: number;
  /** world position of the last player gunshot (for scaring civs) */
  lastShotAt: number;
  lastShotPos: THREE.Vector3;
}

export interface CiviliansHooks {
  onCivKilled: (byCar: boolean) => void;
  onCivShot: (killed: boolean) => void;
}

type Part = 'head' | 'body';
const PART_MULT: Record<Part, number> = { head: 2.2, body: 1 };
const HEIGHT = 1.75;

const TMP_V = new THREE.Vector3();

/**
 * Night-city pedestrians. Wander the sidewalks, flee from gunfire and fast
 * cars, and die with the real Death clip when shot or run over. Hit zones
 * are invisible boxes (colorWrite off) so bullets resolve head/body.
 */
export class Civilian {
  readonly group = new THREE.Group();
  readonly hitMeshes: THREE.Mesh[] = [];
  state: 'wander' | 'flee' | 'dead' = 'wander';

  private mixer: THREE.AnimationMixer | null = null;
  readonly variant: NpcVariant;
  private actions: Partial<Record<'Idle' | 'Walk' | 'Run' | 'Death', THREE.AnimationAction>> = {};
  private current: THREE.AnimationAction | null = null;
  private target = new THREE.Vector3();
  private idleT = 0;
  private fleeT = 0;
  private deadT = -1;
  private hp = 40;

  onCrimes: CiviliansHooks | null = null;

  constructor(
    scene: THREE.Scene,
    private fx: WorldFx,
    private colliders: Collider[],
    private walkPoints: THREE.Vector3[],
    assets: Assets,
  ) {
    // one cheap base model, diversified procedurally: body type via XYZ
    // scaling, outfit via per-instance material clones (see NpcFactory)
    const variant = makeNpcVariant(assets);
    this.variant = variant;
    const man = variant.group.children[0];
    this.group.add(variant.group);

    this.mixer = new THREE.AnimationMixer(man);
    for (const clip of assets.man.clips) {
      if (clip.name.includes('Idle')) this.actions.Idle = this.mixer.clipAction(clip);
      else if (clip.name.includes('Walk')) this.actions.Walk = this.mixer.clipAction(clip);
      else if (clip.name.includes('Run')) this.actions.Run = this.mixer.clipAction(clip);
      else if (clip.name.includes('Death')) {
        const a = this.mixer.clipAction(clip);
        a.loop = THREE.LoopOnce;
        a.clampWhenFinished = true;
        this.actions.Death = a;
      }
    }

    const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const box = (w: number, h: number, d: number, y: number, part: Part): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hitMat);
      m.position.set(0, y, 0);
      m.userData.npc = this;
      m.userData.mult = PART_MULT[part];
      this.group.add(m);
      this.hitMeshes.push(m);
    };
    box(0.26, 0.28, 0.26, 1.62, 'head');
    box(0.44, 1.05, 0.3, 0.85, 'body');

    scene.add(this.group);
    this.group.visible = false;
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  /** spawn on a sidewalk point */
  activate(): void {
    const p = this.pickPoint();
    this.group.position.copy(p);
    this.group.rotation.set(0, Math.random() * Math.PI * 2, 0);
    this.group.visible = true;
    this.state = 'wander';
    this.hp = 40;
    this.deadT = -1;
    this.idleT = Math.random() * 2;
    this.fleeT = 0;
    if (this.mixer) {
      this.mixer.timeScale = 1;
      this.mixer.stopAllAction();
    }
    this.current = null;
    this.pickWanderTarget();
    this.setAnim('Idle');
  }

  deactivate(): void {
    this.group.visible = false;
    this.state = 'dead';
    this.deadT = -1;
  }

  private pickPoint(): THREE.Vector3 {
    return this.walkPoints[Math.floor(Math.random() * this.walkPoints.length)];
  }

  private pickWanderTarget(): void {
    const p = this.pickPoint();
    // keep targets reasonably close so the city stays populated locally
    if (p.distanceTo(this.group.position) < 30) this.target.copy(p);
    else this.target.copy(this.group.position).addScaledVector(TMP_V.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(), 12);
  }

  damage(amount: number, point: THREE.Vector3, dir: THREE.Vector3, byCar: boolean): void {
    if (this.state === 'dead') return;
    this.hp -= amount;
    this.fx.impacts.spawn(point, TMP_V.copy(dir).negate(), 'flesh');
    if (this.hp <= 0) {
      this.die();
      this.onCrimes?.onCivKilled(byCar);
      this.onCrimes?.onCivShot(true);
    } else {
      this.onCrimes?.onCivShot(false);
      this.startFlee(this.group.position);
    }
  }

  /** run over by a car — instant */
  killByCar(speed: number): void {
    if (this.state === 'dead') return;
    this.hp = 0;
    this.die();
    this.onCrimes?.onCivKilled(true);
    this.onCrimes?.onCivShot(true);
    void speed;
  }

  private die(): void {
    this.state = 'dead';
    this.deadT = 0;
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.actions.Death?.reset().play();
    }
  }

  startFlee(from: THREE.Vector3): void {
    if (this.state === 'dead') return;
    this.state = 'flee';
    this.fleeT = 5 + Math.random() * 3;
    // run away from the threat
    TMP_V.subVectors(this.group.position, from);
    TMP_V.y = 0;
    if (TMP_V.lengthSq() < 0.01) TMP_V.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    TMP_V.normalize();
    this.target.copy(this.group.position).addScaledVector(TMP_V, 26);
    this.setAnim('Run');
  }

  update(c: NpcCtx): void {
    if (!this.group.visible) return;
    if (this.state === 'dead') {
      this.deadT += c.dt;
      this.mixer?.update(c.dt);
      // corpse lingers, then the slot respawns elsewhere
      if (this.deadT > 18) this.activate();
      return;
    }

    this.mixer?.update(c.dt);
    const speed =
      this.state === 'flee' ? 5.2 : this.current === this.actions.Walk ? 1.9 : 0;

    // --- threat scan -----------------------------------------------------
    const toPlayer = TMP_V.subVectors(c.playerPos, this.group.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const carThreat =
      c.playerDriving && dist < 9 && Math.abs(c.playerCarSpeed) > 6
        ? Math.max(0, 1 - Math.abs(c.playerCarSpeed) / 30)
        : 0;
    if (c.lastShotAt > 0 && performance.now() / 1000 - c.lastShotAt < 1.4 && dist < 24) {
      this.startFlee(c.lastShotPos);
    } else if (carThreat > 0.35 && dist < 8) {
      this.startFlee(c.playerPos);
    }

    if (this.state === 'flee') {
      this.fleeT -= c.dt;
      if (this.fleeT <= 0) {
        this.state = 'wander';
        this.pickWanderTarget();
        this.setAnim('Idle');
        this.idleT = 0.5;
      }
    }

    // --- wander ------------------------------------------------------------
    if (this.state === 'wander') {
      if (this.idleT > 0) {
        this.idleT -= c.dt;
        if (this.idleT <= 0) {
          this.pickWanderTarget();
          this.setAnim('Walk');
        }
      } else {
        TMP_V.subVectors(this.target, this.group.position);
        TMP_V.y = 0;
        if (TMP_V.lengthSq() < 2.25) {
          this.setAnim('Idle');
          this.idleT = 1.5 + Math.random() * 4;
        } else {
          const yaw = Math.atan2(TMP_V.x, TMP_V.z);
          let dy = yaw - this.group.rotation.y;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          this.group.rotation.y += dy * Math.min(1, c.dt * 5);
        }
      }
    }

    if (speed > 0) {
      TMP_V.subVectors(this.target, this.group.position);
      TMP_V.y = 0;
      TMP_V.normalize();
      this.moveBy(TMP_V.x * speed * c.dt, TMP_V.z * speed * c.dt);
    }
  }

  private setAnim(name: 'Idle' | 'Walk' | 'Run', fade = 0.25): void {
    const next = this.actions[name];
    if (!next || this.current === next) return;
    next.reset().fadeIn(fade).play();
    this.current?.fadeOut(fade);
    this.current = next;
  }

  private moveBy(dx: number, dz: number): void {
    const p = this.group.position;
    p.x += dx;
    p.z += dz;
    const r = 0.34;
    for (const col of this.colliders) {
      if (col.max.y < 0.35 || col.min.y > 1.7) continue;
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
    // hard clamp to the playable area
    p.x = Math.max(-82, Math.min(82, p.x));
    p.z = Math.max(-82, Math.min(82, p.z));
  }
}

/**
 * Pedestrian pool + hitzone registration. Keeps the night streets alive
 * with N wanderers around the player.
 */
export class Civilians {
  readonly pool: Civilian[] = [];
  readonly hitMeshes: THREE.Mesh[] = [];
  killedByGun = 0;
  killedByCar = 0;

  constructor(
    scene: THREE.Scene,
    private fx: WorldFx,
    private colliders: Collider[],
    private walkPoints: THREE.Vector3[],
    assets: Assets,
    count = 10,
    private hooks: CiviliansHooks = { onCivKilled: () => undefined, onCivShot: () => undefined },
  ) {
    for (let i = 0; i < count; i++) {
      const civ = new Civilian(scene, fx, colliders, walkPoints, assets);
      civ.onCrimes = {
        onCivKilled: (byCar) => {
          if (byCar) this.killedByCar++;
          else this.killedByGun++;
          for (const m of civ.hitMeshes) {
            const idx = this.hitMeshes.indexOf(m);
            if (idx >= 0) this.hitMeshes.splice(idx, 1);
          }
          this.hooks.onCivKilled(byCar);
        },
        onCivShot: (killed) => this.hooks.onCivShot(killed),
      };
      this.pool.push(civ);
    }
  }

  start(): void {
    this.killedByGun = 0;
    this.killedByCar = 0;
    this.hitMeshes.length = 0;
    for (const c of this.pool) {
      c.activate();
      this.hitMeshes.push(...c.hitMeshes);
    }
  }

  update(dt: number, ctx: Omit<NpcCtx, 'dt'>): void {
    for (const c of this.pool) c.update({ ...ctx, dt });
  }

  /** a gunshot report scared everyone near pos */
  scareAround(pos: THREE.Vector3, radius: number, playerPos: THREE.Vector3): void {
    for (const c of this.pool) {
      if (!c.alive) continue;
      if (c.group.position.distanceTo(pos) < radius || c.group.position.distanceTo(playerPos) < radius) {
        c.startFlee(pos);
      }
    }
  }

  get aliveCount(): number {
    return this.pool.reduce((n, c) => n + (c.alive ? 1 : 0), 0);
  }
}
