import * as THREE from 'three';
import { normalizeGun, type Assets, type NormalizedModel } from '../core/Assets';

export const RELOAD_TIME = 1.7;

const HIP_POS = new THREE.Vector3(0.22, -0.24, -0.48);
const HIP_ROT = { x: 0, y: 0.04, z: 0.015 };
const ADS_POS = new THREE.Vector3(0, -0.052, -0.32);
const SPRINT_POS = new THREE.Vector3(0.1, -0.26, -0.4);
const SPRINT_ROT = { x: 0.42, y: 0.42, z: 0.12 };

const SMG_LENGTH = 0.62;

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
 * First-person weapon: a real GLTF SMG with the full bodycam feel —
 * mouse-lag sway, walk bob, breathing, recoil springs, sprint pose and a
 * keyframed magazine reload that pulls the actual magazine node out of the
 * gun, drops it as a world prop and seats a fresh one.
 */
export class Viewmodel {
  readonly group = new THREE.Group();
  private gunWrap: NormalizedModel;
  private heldMag: THREE.Object3D;
  private magRestPos = new THREE.Vector3();
  private magRestQuat = new THREE.Quaternion();
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

  constructor(assets: Assets) {
    // --- real SMG, normalized to barrel -z, centered, 0.62m ---------------
    const smg = assets.smg.scene;
    this.gunWrap = normalizeGun(smg, SMG_LENGTH);
    this.group.add(this.gunWrap.group);

    // pull the magazine out of the model into gun-wrapper space
    const magNode = assets.smg.magNode;
    if (magNode) {
      this.gunWrap.group.updateMatrixWorld(true);
      const rel = new THREE.Matrix4()
        .copy(this.gunWrap.group.matrixWorld)
        .invert()
        .multiply(magNode.matrixWorld);
      rel.decompose(this.magRestPos, this.magRestQuat, new THREE.Vector3());
      const held = magNode.clone(true);
      held.position.copy(this.magRestPos);
      held.quaternion.copy(this.magRestQuat);
      held.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.frustumCulled = false;
          mesh.castShadow = false;
        }
      });
      this.gunWrap.group.add(held);
      this.heldMag = held;
      magNode.visible = false; // the held clone is the gun's magazine now
    } else {
      this.heldMag = new THREE.Group();
    }

    // --- lights -------------------------------------------------------------
    const torch = new THREE.SpotLight(0xffedd0, 420, 38, 0.46, 0.6, 2);
    torch.position.set(0.05, -0.04, -0.2);
    torch.castShadow = true;
    torch.shadow.mapSize.set(1024, 1024);
    torch.shadow.camera.near = 0.2;
    torch.shadow.camera.far = 38;
    torch.shadow.bias = -0.002;
    const torchTarget = new THREE.Object3D();
    torchTarget.position.set(0.05, -0.05, -14);
    this.group.add(torchTarget);
    torch.target = torchTarget;
    this.group.add(torch);

    const fill = new THREE.PointLight(0xd8dce4, 2.2, 1.6, 2);
    fill.position.set(0.14, 0.12, -0.12);
    this.group.add(fill);

    this.muzzleRef.position.set(0, 0.02, -(SMG_LENGTH / 2) - 0.04);
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
    return this.heldMag.getWorldPosition(out);
  }

  /** fresh world-space magazine prop for the dropped-mag debris pool */
  makeMagPropMesh(): THREE.Mesh {
    const meshes: THREE.Mesh[] = [];
    this.heldMag.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) meshes.push(m);
    });
    const first = meshes[0];
    if (!first) {
      return new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.17, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x101215, metalness: 0.6, roughness: 0.5 }),
      );
    }
    return new THREE.Mesh(first.geometry, (first.material as THREE.Material).clone());
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

    // reload pose + magazine animation
    let w = 0;
    let magDrop = 0;   // 0 = seated, 1 = fully dropped
    let magVisible = true;
    let boltJolt = 0;
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
        magDrop = smoothstep((t - 0.5) / 0.22);
        magVisible = magDrop < 0.98;
      } else if (t >= 1.12 && t < 1.5) {
        const rise = smoothstep((t - 1.12) / 0.3);
        magDrop = 1 - rise;
        magVisible = true;
      }
      if (t >= 1.45 && t < 1.62) {
        boltJolt = Math.sin(((t - 1.45) / 0.17) * Math.PI) * 0.06;
      }
    }

    this.group.position.set(
      px + this.lagX + bobX,
      py + this.lagY + bobY + breathe,
      pz + this.recZ,
    );
    this.group.rotation.set(
      rx - this.recP * 0.1 + this.lagY * 3.4 + boltJolt,
      ry + this.lagX * 3.4,
      rz + Math.cos(this.bobT) * 0.02 * intensity,
    );

    // magazine rides out of the well, tilts, drops, then seats again
    this.heldMag.visible = magVisible;
    this.heldMag.position.copy(this.magRestPos);
    this.heldMag.position.y -= magDrop * 0.22;
    this.heldMag.quaternion.copy(this.magRestQuat);
    if (magDrop > 0) {
      const tiltQ = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        -magDrop * 0.5,
      );
      this.heldMag.quaternion.multiply(tiltQ);
    }
  }
}
