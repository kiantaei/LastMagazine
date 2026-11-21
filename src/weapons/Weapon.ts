import * as THREE from 'three';
import type { CameraRig } from '../core/CameraRig';
import type { SFX } from '../audio/SFX';
import { RELOAD_TIME, type Viewmodel } from './Viewmodel';
import { DebrisPool, FlashPool, ImpactPool, ShellPool, TracerPool, type WorldFx } from './Fx';

export interface WeaponInput {
  firing: boolean;
  reloadPressed: boolean;
  sprinting: boolean;
  moving: boolean;
  grounded: boolean;
  speed: number;
  lookDX: number;
  lookDY: number;
  /** while driving: world position for flash/tracer origins */
  muzzleOverride?: THREE.Vector3;
}

export interface WeaponHooks {
  onAmmoChange?: (mag: number, reserve: number) => void;
  onHit?: (killed: boolean) => void;
  onShot?: () => void;
  onCivilianHit?: (killed: boolean) => void;
  onPoliceHit?: (wrecked: boolean) => void;
}

const TMP_ORIGIN = new THREE.Vector3();
const TMP_END = new THREE.Vector3();
const TMP_MUZZLE = new THREE.Vector3();
const TMP_PORT = new THREE.Vector3();
const TMP_RIGHT = new THREE.Vector3();
const TMP_UP = new THREE.Vector3();
const TMP_DIR = new THREE.Vector3();

/**
 * P9C sidearm: real GLTF pistol with gloved hands, fast semi-auto hitscan,
 * recoil viewpunch, muzzle flash, tracers, shell ejection, bullet decals
 * and weapon bloom. No aim-down-sights — hip fire only.
 */
export class Weapon {
  readonly name = 'P9C';
  mag = 15;
  readonly magSize = 15;
  reserve = 90;
  readonly damage = 34;
  reloading = false;
  /** shared world-FX bundle handed to the NPC / police systems */
  readonly fx: WorldFx;

  private readonly fireInterval = 0.15;
  private cooldown = 0;
  private dryCooldown = 0;
  private bloom = 0;
  private ray = new THREE.Raycaster();
  private reloadT = 0;
  private reloadStage = 0;

  /** reload timeline: [time in seconds, foley stage] — matches the viewmodel keyframes */
  private static readonly RELOAD_EVENTS = [
    [0.32, 'release'],
    [0.85, 'out'],
    [1.5, 'in'],
    [1.62, 'bolt1'],
    [1.72, 'bolt2'],
  ] as const;

  private flash: FlashPool;
  private tracers: TracerPool;
  private shells: ShellPool;
  private impacts: ImpactPool;
  private debris: DebrisPool;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private rig: CameraRig,
    private vm: Viewmodel,
    private sfx: SFX,
    private hittables: THREE.Object3D[],
    scene: THREE.Scene,
    private hooks: WeaponHooks = {},
  ) {
    this.flash = new FlashPool(scene, 5);
    this.tracers = new TracerPool(scene, 28);
    this.shells = new ShellPool(scene, 16, hittables);
    this.impacts = new ImpactPool(scene);
    this.debris = new DebrisPool(scene, 3, hittables, () => this.vm.makeMagPropMesh());
    this.fx = { flash: this.flash, tracers: this.tracers, impacts: this.impacts, sfx };
  }

  reset(): void {
    this.mag = this.magSize;
    this.reserve = 90;
    this.reloading = false;
    this.cooldown = 0;
    this.bloom = 0;
    this.reloadT = 0;
    this.reloadStage = 0;
    this.vm.setReload(-1);
    this.hooks.onAmmoChange?.(this.mag, this.reserve);
  }

  tryReload(): void {
    if (this.reloading || this.mag === this.magSize || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = 0;
    this.reloadStage = 0;
  }

  get reloadProgress(): number {
    return this.reloading ? this.reloadT / RELOAD_TIME : 0;
  }

  update(dt: number, input: WeaponInput): void {
    // --- reload state machine ---------------------------------------------
    if (input.reloadPressed) this.tryReload();
    if (this.reloading) {
      this.reloadT += dt;
      const ev = Weapon.RELOAD_EVENTS;
      while (this.reloadStage < ev.length && ev[this.reloadStage][0] <= this.reloadT) {
        const stage = ev[this.reloadStage][1];
        this.sfx.reload(stage);
        if (stage === 'out') {
          // the visual mag just left the well — spawn the ballistic prop
          this.camera.updateMatrixWorld(true);
          this.camera.getWorldDirection(TMP_DIR);
          this.vm.getMuzzleWorldPos(TMP_MUZZLE);
          this.vm.getMagWorldPos(TMP_PORT);
          this.debris.spawn(TMP_PORT, TMP_DIR);
        }
        this.reloadStage++;
      }
      if (this.reloadT >= RELOAD_TIME) {
        const take = Math.min(this.magSize - this.mag, this.reserve);
        this.mag += take;
        this.reserve -= take;
        this.reloading = false;
        this.hooks.onAmmoChange?.(this.mag, this.reserve);
      }
      this.vm.setReload(this.reloadT);
    } else {
      this.vm.setReload(-1);
    }

    const wantAim = 0;
    void wantAim;

    this.cooldown -= dt;
    this.dryCooldown -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.05);

    if (input.firing && !this.reloading && this.cooldown <= 0) {
      if (this.mag > 0) {
        this.fire(input);
      } else if (this.dryCooldown <= 0) {
        this.sfx.dryFire();
        this.cooldown = 0.3;
        this.dryCooldown = 0.32;
      }
    }

    this.flash.update(dt);
    this.tracers.update(dt);
    this.shells.update(dt, (p) => this.sfx.shellTink(p));
    this.impacts.update(dt);
    this.debris.update(dt);

    this.vm.update({
      dt,
      sprinting: input.sprinting,
      moving: input.moving,
      grounded: input.grounded,
      speed: input.speed,
      lookDX: input.lookDX,
      lookDY: input.lookDY,
    });
  }

  private fire(input: WeaponInput): void {
    this.mag--;
    this.cooldown = this.fireInterval;
    this.bloom = Math.min(0.02, this.bloom + 0.0038);

    this.camera.updateMatrixWorld(true);
    const origin = this.camera.getWorldPosition(TMP_ORIGIN);
    this.camera.getWorldDirection(TMP_DIR);
    TMP_RIGHT.setFromMatrixColumn(this.camera.matrixWorld, 0);
    TMP_UP.setFromMatrixColumn(this.camera.matrixWorld, 1);

    // spread cone: looser moving / airborne / sustained fire — hip fire only
    const spread =
      0.019 +
      (input.moving ? 0.009 : 0) +
      (input.grounded ? 0 : 0.024) +
      this.bloom;
    const gauss = () => Math.random() + Math.random() - 1;
    TMP_DIR.addScaledVector(TMP_RIGHT, gauss() * spread).addScaledVector(TMP_UP, gauss() * spread).normalize();

    this.ray.set(origin, TMP_DIR);
    this.ray.far = 90;
    const hits = this.ray.intersectObjects(this.hittables, false);

    TMP_END.copy(origin).addScaledVector(TMP_DIR, 70);
    if (hits.length > 0) {
      const h = hits[0];
      TMP_END.copy(h.point);
      const ud = h.object.userData as {
        npc?: { damage(amount: number, point: THREE.Vector3, dir: THREE.Vector3, byCar: boolean): void; alive: boolean };
        policeUnit?: { damage(amount: number, point: THREE.Vector3, dir: THREE.Vector3): boolean };
        mult?: number;
      };
      if (ud.npc) {
        const wasAlive = ud.npc.alive;
        ud.npc.damage(this.damage * (ud.mult ?? 1), h.point, TMP_DIR, false);
        if (wasAlive) {
          this.hooks.onHit?.(!ud.npc.alive);
          this.hooks.onCivilianHit?.(!ud.npc.alive);
        }
      } else if (ud.policeUnit) {
        const wrecked = ud.policeUnit.damage(this.damage, h.point, TMP_DIR);
        this.hooks.onHit?.(wrecked);
        this.hooks.onPoliceHit?.(wrecked);
      } else {
        const normal = h.face
          ? h.face.normal.clone().transformDirection(h.object.matrixWorld)
          : TMP_DIR.clone().negate();
        this.impacts.spawn(h.point, normal, 'world');
      }
    }

    if (input.muzzleOverride) {
      TMP_MUZZLE.copy(input.muzzleOverride);
    } else {
      this.vm.getMuzzleWorldPos(TMP_MUZZLE);
    }
    this.flash.spawn(TMP_MUZZLE);
    this.tracers.spawn(TMP_MUZZLE, TMP_END);
    this.shells.spawn(
      this.camera.localToWorld(TMP_PORT.set(0.12, -0.08, -0.2)),
      TMP_RIGHT,
    );

    this.sfx.shot();
    this.rig.addPunch(0.013 + Math.random() * 0.004, (Math.random() - 0.5) * 0.007);
    this.rig.addTrauma(0.055);
    if (!input.muzzleOverride) this.vm.fireRecoil();
    this.hooks.onShot?.();
    this.hooks.onAmmoChange?.(this.mag, this.reserve);
  }
}
