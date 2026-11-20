import * as THREE from 'three';
import type { CameraRig } from '../core/CameraRig';
import type { SFX } from '../audio/SFX';
import type { Viewmodel } from './Viewmodel';
import { DebrisPool, FlashPool, ImpactPool, ShellPool, TracerPool } from './Fx';

export interface WeaponInput {
  firing: boolean;
  aimHeld: boolean;
  reloadPressed: boolean;
  sprinting: boolean;
  moving: boolean;
  grounded: boolean;
  speed: number;
  lookDX: number;
  lookDY: number;
}

export interface WeaponHooks {
  onAmmoChange?: (mag: number, reserve: number) => void;
}

const TMP_ORIGIN = new THREE.Vector3();
const TMP_END = new THREE.Vector3();
const TMP_MUZZLE = new THREE.Vector3();
const TMP_PORT = new THREE.Vector3();
const TMP_RIGHT = new THREE.Vector3();
const TMP_UP = new THREE.Vector3();
const TMP_DIR = new THREE.Vector3();

/**
 * KSR-9 SMG: full-auto hitscan, ADS, recoil viewpunch, muzzle flash,
 * tracers, shell ejection, bullet decals and weapon bloom.
 */
export class Weapon {
  readonly name = 'KSR-9';
  mag = 30;
  readonly magSize = 30;
  reserve = 150;
  aimBlend = 0;
  reloading = false;

  private readonly fireInterval = 60 / 780;
  private cooldown = 0;
  private dryCooldown = 0;
  private bloom = 0;
  private ray = new THREE.Raycaster();

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
    this.debris = new DebrisPool(scene, 3, hittables);
  }

  reset(): void {
    this.mag = this.magSize;
    this.reserve = 150;
    this.reloading = false;
    this.aimBlend = 0;
    this.cooldown = 0;
    this.bloom = 0;
    this.hooks.onAmmoChange?.(this.mag, this.reserve);
  }

  update(dt: number, input: WeaponInput): void {
    const wantAim = input.aimHeld && !this.reloading && !input.sprinting ? 1 : 0;
    this.aimBlend += (wantAim - this.aimBlend) * Math.min(1, dt * 10);

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
      aim: this.aimBlend,
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

    // spread cone: tighter when ADS, looser moving / airborne / sustained fire
    const spread =
      THREE.MathUtils.lerp(0.019, 0.0045, this.aimBlend) +
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
      const normal = h.face
        ? h.face.normal.clone().transformDirection(h.object.matrixWorld)
        : TMP_DIR.clone().negate();
      this.impacts.spawn(h.point, normal, 'world');
    }

    this.vm.getMuzzleWorldPos(TMP_MUZZLE);
    this.flash.spawn(TMP_MUZZLE);
    this.tracers.spawn(TMP_MUZZLE, TMP_END);
    this.shells.spawn(
      this.camera.localToWorld(TMP_PORT.set(0.14, -0.1, -0.32)),
      TMP_RIGHT,
    );

    this.sfx.shot();
    this.rig.addPunch(0.013 + Math.random() * 0.004, (Math.random() - 0.5) * 0.007);
    this.rig.addTrauma(0.055);
    this.vm.fireRecoil();
    this.hooks.onAmmoChange?.(this.mag, this.reserve);
  }
}
