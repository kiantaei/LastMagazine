import * as THREE from 'three';

export const RELOAD_TIME = 1.7;
const SIGHT_Y = 0.09; // sight axis above gun origin — ADS anchors this to screen center

const HIP_POS = new THREE.Vector3(0.22, -0.235, -0.44);
const HIP_ROT = { x: 0, y: 0.04, z: 0.015 };
const ADS_POS = new THREE.Vector3(0, -SIGHT_Y, -0.27);
const SPRINT_POS = new THREE.Vector3(0.1, -0.26, -0.38);
const SPRINT_ROT = { x: 0.42, y: 0.42, z: 0.12 };

export interface VMContext {
  dt: number;
  aim: number;        // 0..1 ADS blend (owned by Weapon)
  sprinting: boolean;
  moving: boolean;
  grounded: boolean;
  speed: number;      // player ground speed
  lookDX: number;
  lookDY: number;
}

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/**
 * First-person weapon model with the full bodycam feel:
 * mouse-lag sway, walk bob, breathing, recoil springs, sprint pose and a
 * keyframed magazine reload (drop, grab, slap, bolt release).
 */
export class Viewmodel {
  readonly group = new THREE.Group();
  readonly magMesh: THREE.Mesh;
  readonly boltHandle: THREE.Mesh;
  private muzzleRef = new THREE.Object3D();

  private time = 0;
  private bobT = 0;
  private lagX = 0;
  private lagY = 0;
  private recP = 0;
  private recPV = 0;
  private recZ = 0;
  private recZV = 0;
  private fireGlow = 0;
  private sprintBlend = 0;
  private reloadT = -1;

  private magRestY: number;
  private boltRestZ: number;

  constructor() {
    const gunmetal = new THREE.MeshStandardMaterial({
      color: 0x23272d,
      metalness: 0.85,
      roughness: 0.36,
    });
    const polymer = new THREE.MeshStandardMaterial({
      color: 0x17191d,
      metalness: 0.15,
      roughness: 0.72,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x101215,
      metalness: 0.6,
      roughness: 0.5,
    });

    const add = (
      geo: THREE.BufferGeometry,
      mat: THREE.MeshStandardMaterial,
      x: number,
      y: number,
      z: number,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = false;
      m.receiveShadow = false;
      this.group.add(m);
      return m;
    };

    add(new THREE.BoxGeometry(0.062, 0.11, 0.3), gunmetal, 0, 0, -0.02);          // receiver
    add(new THREE.BoxGeometry(0.055, 0.075, 0.16), polymer, 0, 0.005, -0.24);     // handguard
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.2, 10), gunmetal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.4);
    this.group.add(barrel);
    add(new THREE.BoxGeometry(0.045, 0.11, 0.05), polymer, 0, -0.095, 0.09);      // grip
    (this.group.children[this.group.children.length - 1] as THREE.Mesh).rotation.x = -0.3;
    add(new THREE.BoxGeometry(0.05, 0.065, 0.15), polymer, 0, 0.005, 0.17);       // stock

    // magazine (animated during reload)
    this.magMesh = add(new THREE.BoxGeometry(0.048, 0.16, 0.08), dark, 0, -0.13, -0.03);
    this.magMesh.rotation.x = 0.1;
    this.magRestY = this.magMesh.position.y;

    // charging handle (pulled during reload)
    this.boltHandle = add(new THREE.BoxGeometry(0.02, 0.018, 0.055), gunmetal, 0.042, 0.03, 0.02);
    this.boltRestZ = this.boltHandle.position.z;

    // iron sights
    add(new THREE.BoxGeometry(0.008, 0.035, 0.012), dark, 0, 0.0725, -0.3);       // front post
    add(new THREE.BoxGeometry(0.022, 0.01, 0.012), dark, 0, 0.06, -0.3);
    add(new THREE.BoxGeometry(0.008, 0.035, 0.012), dark, -0.011, 0.0725, 0.03);  // rear notch
    add(new THREE.BoxGeometry(0.008, 0.035, 0.012), dark, 0.011, 0.0725, 0.03);
    add(new THREE.BoxGeometry(0.03, 0.01, 0.012), dark, 0, 0.06, 0.03);

    // weapon light — the bodycam's best friend in a dark yard
    add(new THREE.BoxGeometry(0.03, 0.03, 0.08), dark, 0.038, -0.035, -0.2);
    const torch = new THREE.SpotLight(0xffedd0, 190, 34, 0.42, 0.55, 2);
    torch.position.set(0.038, -0.03, -0.24);
    torch.castShadow = true;
    torch.shadow.mapSize.set(1024, 1024);
    torch.shadow.camera.near = 0.2;
    torch.shadow.camera.far = 34;
    torch.shadow.bias = -0.002;
    const torchTarget = new THREE.Object3D();
    torchTarget.position.set(0.038, -0.04, -14);
    this.group.add(torchTarget);
    torch.target = torchTarget;
    this.group.add(torch);

    this.muzzleRef.position.set(0, 0.02, -0.5);
    this.group.add(this.muzzleRef);
  }

  attach(camera: THREE.Camera): void {
    camera.add(this.group);
  }

  fireRecoil(): void {
    this.recPV += 5.4;
    this.recZV += 1.7;
    this.fireGlow = 0.32;
  }

  /** t = elapsed reload seconds, or -1 when not reloading. */
  setReload(t: number): void {
    this.reloadT = t;
  }

  getMuzzleWorldPos(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzleRef.getWorldPosition(out);
  }

  getMagWorldPos(out: THREE.Vector3): THREE.Vector3 {
    return this.magMesh.getWorldPosition(out);
  }

  update(c: VMContext): void {
    const dt = c.dt;
    this.time += dt;
    this.fireGlow = Math.max(0, this.fireGlow - dt);

    // springs
    this.recPV += (-this.recP * 190 - this.recPV * 17) * dt;
    this.recP += this.recPV * dt;
    this.recZV += (-this.recZ * 220 - this.recZV * 19) * dt;
    this.recZ += this.recZV * dt;

    // mouse lag (weapon trails the eyes)
    this.lagX += (-c.lookDX * 0.0016 - this.lagX) * Math.min(1, dt * 11);
    this.lagY += (-c.lookDY * 0.0016 - this.lagY) * Math.min(1, dt * 11);
    this.lagX = Math.max(-0.035, Math.min(0.035, this.lagX));
    this.lagY = Math.max(-0.03, Math.min(0.03, this.lagY));

    // walk bob + breathing
    const intensity = c.grounded && c.moving ? Math.min(c.speed / 5.2, 1.3) : 0;
    if (c.grounded && c.moving) this.bobT += dt * (5 + c.speed * 1.2);
    const bobX = Math.cos(this.bobT) * 0.013 * intensity;
    const bobY = Math.sin(this.bobT * 2) * 0.015 * intensity;
    const breathe = Math.sin(this.time * 1.3) * 0.0024;

    // pose blending
    const aim = c.aim;
    const wantSprint = c.sprinting && this.fireGlow <= 0 && aim < 0.3 ? 1 : 0;
    this.sprintBlend += (wantSprint - this.sprintBlend) * Math.min(1, dt * 8);
    const s = this.sprintBlend;

    let px = THREE.MathUtils.lerp(HIP_POS.x, ADS_POS.x, aim);
    let py = THREE.MathUtils.lerp(HIP_POS.y, ADS_POS.y, aim);
    let pz = THREE.MathUtils.lerp(HIP_POS.z, ADS_POS.z, aim);
    let rx = THREE.MathUtils.lerp(HIP_ROT.x, 0, aim);
    let ry = THREE.MathUtils.lerp(HIP_ROT.y, 0, aim);
    let rz = THREE.MathUtils.lerp(HIP_ROT.z, 0, aim);

    px += (SPRINT_POS.x - px) * s;
    py += (SPRINT_POS.y - py) * s;
    pz += (SPRINT_POS.z - pz) * s;
    rx += (SPRINT_ROT.x - rx) * s;
    ry += (SPRINT_ROT.y - ry) * s;
    rz += (SPRINT_ROT.z - rz) * s;

    // reload pose
    let w = 0;
    let magY = 0;
    let magRx = 0;
    let magVisible = true;
    let boltPull = 0;
    if (this.reloadT >= 0) {
      const t = this.reloadT;
      w = smoothstep(t / 0.28) * (1 - smoothstep((t - 1.45) / 0.25));
      px += -0.045 * w;
      py += -0.13 * w;
      pz += 0.05 * w;
      rx += 0.38 * w;
      ry += 0.28 * w;
      rz += -0.5 * w;

      if (t > 0.5 && t < 1.12) {
        const drop = smoothstep((t - 0.5) / 0.22);
        magY = -0.2 * drop;
        magRx = -0.55 * drop;
        magVisible = drop < 0.98;
      } else if (t >= 1.12 && t < 1.5) {
        const rise = smoothstep((t - 1.12) / 0.3);
        magY = -0.2 * (1 - rise);
        magRx = -0.55 * (1 - rise);
        magVisible = true;
      }
      if (t >= 1.45 && t < 1.62) {
        boltPull = Math.sin(((t - 1.45) / 0.17) * Math.PI);
      }
    }

    this.group.position.set(
      px + this.lagX + bobX,
      py + this.lagY + bobY + breathe,
      pz + this.recZ,
    );
    this.group.rotation.set(
      rx - this.recP * 0.1 + this.lagY * 3.4,
      ry + this.lagX * 3.4,
      rz + Math.cos(this.bobT) * 0.02 * intensity,
    );

    this.magMesh.visible = magVisible;
    this.magMesh.position.y = this.magRestY + magY;
    this.magMesh.rotation.x = 0.1 + magRx;
    this.boltHandle.position.z = this.boltRestZ + boltPull * 0.055;
  }
}
