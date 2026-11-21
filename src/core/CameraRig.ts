import * as THREE from 'three';

/**
 * Minimal world-state snapshot the rig animates on top of.
 * The Player class produces one of these every frame.
 */
export interface RigState {
  pos: THREE.Vector3;      // feet position on the ground plane
  eyeHeight: number;       // current eye height (crouch-aware)
  groundSpeed: number;     // horizontal speed, m/s
  grounded: boolean;
  sprinting: boolean;
  crouching: boolean;
  dead: boolean;
}

/** drive-chase camera state (third person, strapped to the car roof) */
export interface DriveCam {
  center: THREE.Vector3;   // car position
  carYaw: number;          // car heading
  camYaw: number;          // orbit yaw (mouse-controlled, auto-realigns)
  speed: number;           // car speed m/s
}

const RIGHT = new THREE.Vector3();
const TMP_C = new THREE.Vector3();

/**
 * Bodycam camera rig.
 * Everything that makes the view feel like a camera bolted to a body:
 * walk-cycle head bob, idle breathing, viewpunch springs, trauma shake,
 * landing dips and a death slump — plus a third-person chase mode for
 * driving (the bodycam is duct-taped to the roof).
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  sensitivity = 0.0021;

  private time = 0;
  private bobT = 0;
  private trauma = 0;
  private punchP = 0;
  private punchPV = 0;
  private punchR = 0;
  private punchRV = 0;
  private dip = 0;
  private dipV = 0;
  private deathT = 0;
  private fov = 102;
  private targetFov = 102;
  private drive: DriveCam | null = null;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.fov, aspect, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
  }

  setTargetFov(fov: number): void {
    this.targetFov = fov;
  }

  /** enter the drive chase camera (orbit seeded behind the car) */
  setDrive(center: THREE.Vector3, carYaw: number): void {
    this.drive = {
      center,
      carYaw,
      camYaw: carYaw + Math.PI,
      speed: 0,
    };
  }

  /** refresh the drive target every frame */
  syncDrive(center: THREE.Vector3, carYaw: number, speed: number): void {
    if (!this.drive) return;
    this.drive.center = center;
    this.drive.carYaw = carYaw;
    this.drive.speed = speed;
  }

  clearDrive(): void {
    this.drive = null;
  }

  /** Instant viewpunch impulse (recoil, explosions). */
  addPunch(pitchKick: number, rollKick: number): void {
    this.punchPV += pitchKick;
    this.punchRV += rollKick;
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  onLand(impactSpeed: number): void {
    this.dipV -= impactSpeed * 0.16;
  }

  reset(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.trauma = 0;
    this.deathT = 0;
    this.bobT = 0;
    this.punchP = this.punchPV = this.punchR = this.punchRV = 0;
    this.dip = this.dipV = 0;
  }

  update(dt: number, s: RigState, lookDX: number, lookDY: number): void {
    this.time += dt;

    if (this.drive) {
      this.updateDrive(dt, lookDX);
      return;
    }

    // --- look ------------------------------------------------------------
    if (!s.dead) {
      this.yaw -= lookDX * this.sensitivity;
      this.pitch -= lookDY * this.sensitivity;
      const lim = 1.47;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    }

    // --- fov -------------------------------------------------------------
    const want = s.dead ? 96 : this.targetFov;
    this.fov += (want - this.fov) * Math.min(1, dt * 11);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // --- head bob + breathing ---------------------------------------------
    const intensity = s.grounded ? Math.min(s.groundSpeed / 5.2, 1.4) : 0.12;
    if (s.grounded && s.groundSpeed > 0.4) {
      this.bobT += dt * (5.0 + s.groundSpeed * 1.25);
    }
    const sprintMul = s.sprinting ? 1.3 : 1;
    const bobX = Math.cos(this.bobT) * 0.016 * intensity * sprintMul;
    const bobY = Math.sin(this.bobT * 2) * 0.02 * intensity * sprintMul;
    const breathe =
      Math.sin(this.time * 1.35) * 0.0026 + Math.sin(this.time * 0.53) * 0.0013;

    // --- springs -----------------------------------------------------------
    this.punchPV += (-this.punchP * 300 - this.punchPV * 20) * dt;
    this.punchP += this.punchPV * dt;
    this.punchRV += (-this.punchR * 300 - this.punchRV * 20) * dt;
    this.punchR += this.punchRV * dt;
    this.dipV += (-this.dip * 240 - this.dipV * 17) * dt;
    this.dip += this.dipV * dt;

    // --- trauma shake -------------------------------------------------------
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const sh = this.trauma * this.trauma;
    const t = this.time;
    const shP = (Math.sin(t * 61.3) + Math.sin(t * 23.9) * 0.6) * 0.012 * sh;
    const shY = (Math.sin(t * 53.7 + 1.3) + Math.sin(t * 31.1) * 0.6) * 0.012 * sh;
    const shR = Math.sin(t * 47.9 + 2.1) * 0.014 * sh;

    // --- death slump --------------------------------------------------------
    let deathRoll = 0;
    let deathPitch = 0;
    let deathDrop = 0;
    if (s.dead) {
      this.deathT = Math.min(1, this.deathT + dt * 1.05);
      const e = 1 - Math.pow(1 - this.deathT, 3);
      deathRoll = e * 1.05;
      deathPitch = -e * 0.22;
      deathDrop = e * s.eyeHeight * 0.72;
    }

    // --- compose ------------------------------------------------------------
    RIGHT.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const c = this.camera;
    c.position.copy(s.pos);
    c.position.y += s.eyeHeight + bobY + breathe + this.dip + deathDrop;
    c.position.addScaledVector(RIGHT, bobX);

    c.rotation.set(
      this.pitch + this.punchP + shP + deathPitch,
      this.yaw + shY,
      this.punchR + shR + Math.cos(this.bobT) * 0.011 * intensity + deathRoll,
    );
  }

  /** third-person chase cam while driving — orbit yaw auto-realigns behind the car */
  private updateDrive(dt: number, lookDX: number): void {
    const d = this.drive!;
    // mouse orbits around the car; the cam slowly swings back behind it
    d.camYaw -= lookDX * this.sensitivity * 1.4;
    let diff = d.carYaw + Math.PI - d.camYaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    d.camYaw += diff * Math.min(1, dt * 1.4);

    const radius = 5.2 + Math.min(1.6, Math.abs(d.speed) * 0.05);
    const height = 2.3;
    this.camera.position.set(
      d.center.x - Math.sin(d.camYaw) * radius,
      d.center.y + height,
      d.center.z - Math.cos(d.camYaw) * radius,
    );

    // bodycam shake: trauma + engine vibration scaled by speed
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const sh = this.trauma * this.trauma;
    const t = this.time;
    const vib = Math.min(1, Math.abs(d.speed) / 18);
    const shY = (Math.sin(t * 53.7 + 1.3) + Math.sin(t * 31.1) * 0.6) * 0.012 * sh;
    const shP = (Math.sin(t * 61.3) + Math.sin(t * 23.9) * 0.6) * (0.012 * sh + 0.0035 * vib);
    const shR = Math.sin(t * 47.9 + 2.1) * (0.014 * sh + 0.004 * vib);

    TMP_C.copy(d.center);
    TMP_C.y += 1.15;
    this.camera.lookAt(TMP_C);
    this.camera.rotation.z += shR;
    this.camera.rotation.x += shP;
    this.camera.rotation.y += shY;

    const want = 95 + Math.min(10, Math.abs(d.speed) * 0.5);
    this.fov += (want - this.fov) * Math.min(1, dt * 6);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
