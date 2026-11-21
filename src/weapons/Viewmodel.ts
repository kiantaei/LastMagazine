import * as THREE from 'three';
import { normalizeGun, type Assets, type NormalizedModel } from '../core/Assets';

export const RELOAD_TIME = 1.9;

const HIP_POS = new THREE.Vector3(0.17, -0.2, -0.42);
const HIP_ROT = { x: 0, y: 0.03, z: 0.01 };
const SPRINT_POS = new THREE.Vector3(0.09, -0.24, -0.38);
const SPRINT_ROT = { x: 0.5, y: 0.5, z: 0.15 };

const PISTOL_LENGTH = 0.33;
const MAG_LENGTH = 0.135;       // scaled from the SMG magazine
const MAG_RAKE = 0.7;           // +40°, matches the new pistol's grip rake

// grip anchors derived from the new pistol geometry (gun space, muzzle -z)
const GRIP_UPPER = new THREE.Vector3(0.0, 0.033, -0.002);
const MAG_REST = new THREE.Vector3(0.0, -0.001, 0.027);

export interface VMContext {
  dt: number;
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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * First-person P9C sidearm: a real GLTF pistol gripped by two gloved hand
 * models with posed finger bones. Bodycam feel — mouse-lag sway, walk bob,
 * breathing, recoil springs, sprint pose, a weapon light that trails the
 * eyes (the only "our" light besides the yard fires) and a hand-driven
 * magazine reload: the off hand dips off-screen, seats a fresh mag and the
 * spent one drops as a world prop.
 */
export class Viewmodel {
  readonly group = new THREE.Group();
  private gunWrap: NormalizedModel;
  private handR: THREE.Group;      // gun space — static grip
  private handL: THREE.Group;      // gun space — animated support hand
  private handLBase = new THREE.Vector3();
  private freshMag: THREE.Object3D;
  private heldMag: THREE.Object3D;
  private magRestPos = new THREE.Vector3();
  private magRestQuat = new THREE.Quaternion();
  private magAxis = new THREE.Vector3(0, -Math.cos(MAG_RAKE), Math.sin(MAG_RAKE)).normalize();
  private muzzleRef = new THREE.Object3D();
  private torch: THREE.SpotLight;
  private spill: THREE.PointLight;
  private torchTarget = new THREE.Object3D();
  private torchOn = true;
  private torchLevel = 1;
  private torchDipT = 5 + Math.random() * 6;
  private torchDip = 0;

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
    // --- real pistol, normalized to barrel -z, centered, 0.33m -------------
    const pistol = assets.pistol.scene;
    this.gunWrap = normalizeGun(pistol, PISTOL_LENGTH, true); // muzzle at raw +x → -z
    this.group.add(this.gunWrap.group);

    // --- magazine: scaled SMG magazine aligned with the grip rake ----------
    const magTemplate = assets.smgMagazine.scene;
    const makeMag = (): THREE.Group => {
      const inner = magTemplate.clone(true);
      inner.scale.setScalar(MAG_LENGTH / 0.496);
      const wrap = new THREE.Group();
      wrap.add(inner);
      wrap.rotation.x = MAG_RAKE;
      return wrap;
    };

    // seated magazine (hidden inside the well until the reload lifts it out)
    this.heldMag = makeMag();
    this.heldMag.position.copy(MAG_REST);
    this.gunWrap.group.add(this.heldMag);
    this.magRestPos.copy(MAG_REST);
    this.magRestQuat.identity();
    // fresh magazine carried by the off hand
    this.freshMag = makeMag();
    this.freshMag.position.set(0.002, 0.052, 0.012);
    this.freshMag.visible = false;

    // --- hands ---------------------------------------------------------------
    this.handR = this.seatHand(assets.hands.right, GRIP_UPPER.clone().add(new THREE.Vector3(0.024, 0.014, 0.006)), 48, {
      index: [0.1, 0.04, 0],          // trigger finger — straight reach
      middle: [0.82, 0.68, 0.32],
      ring: [0.86, 0.72, 0.34],
      pinky: [0.8, 0.62, 0.28],
      thumb: [0.12, 0.48, 0.22],
    });
    this.handL = this.seatHand(assets.hands.left, GRIP_UPPER.clone().add(new THREE.Vector3(-0.033, -0.03, 0.018)), 50, {
      index: [0.62, 0.5, 0.24],
      middle: [0.64, 0.52, 0.26],
      ring: [0.62, 0.5, 0.24],
      pinky: [0.56, 0.44, 0.2],
      thumb: [0.12, 0.42, 0.2],
    });
    this.handLBase.copy(this.handL.position);
    this.handL.add(this.freshMag);
    this.gunWrap.group.add(this.handR, this.handL);

    // --- the only light we own: the weapon light ----------------------------
    const torch = new THREE.SpotLight(0xeaf1ff, 950, 40, 0.43, 0.5, 1.7);
    torch.position.set(0.03, -0.02, -0.1);
    torch.castShadow = true;
    torch.shadow.mapSize.set(1024, 1024);
    torch.shadow.camera.near = 0.2;
    torch.shadow.camera.far = 40;
    torch.shadow.bias = -0.002;
    this.torchTarget.position.set(0.05, -0.05, -14);
    this.group.add(this.torchTarget);
    torch.target = this.torchTarget;
    this.group.add(torch);
    this.torch = torch;

    // flashlight spill: the weapon light bounces off the hands and gun —
    // a faint, short-range glow that dies with the torch (same light source).
    // Lives at SCENE level and tracks the gun every frame: camera-child
    // lights are collected for the world but never illuminate the
    // camera-child viewmodel meshes.
    const spill = new THREE.PointLight(0xcfe0ff, 0, 3.5, 2);
    spill.position.set(0.08, -0.12, -0.3);
    this.spill = spill;

    this.muzzleRef.position.set(0, 0.1, -(PISTOL_LENGTH / 2) - 0.025);
    this.group.add(this.muzzleRef);

    // collect glove materials for persona tints
    for (const hand of [this.handR, this.handL]) {
      hand.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) this.gloveMats.push(m as THREE.MeshStandardMaterial);
        }
      });
    }
  }

  private gloveMats: THREE.MeshStandardMaterial[] = [];
  private suppressed = false;
  private spillLocal = new THREE.Vector3();

  /** pose + place a glove hand so its wrist bone sits on the anchor */
  private seatHand(
    hand: { scene: THREE.Group; bones: Map<string, THREE.Object3D> },
    anchor: THREE.Vector3,
    pitchDeg: number,
    curls: Record<string, [number, number, number]>,
  ): THREE.Group {
    const scene = hand.scene;
    const segs = ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal'];
    const curl = (finger: string, angles: [number, number, number]) => {
      segs.forEach((seg, i) => {
        const bone = hand.bones.get(`${finger}-${seg}`);
        if (bone) bone.setRotationFromAxisAngle(new THREE.Vector3(1, 0, 0), angles[i]);
      });
    };
    for (const [finger, angles] of Object.entries(curls)) curl(finger, angles);
    scene.rotation.set(THREE.MathUtils.degToRad(pitchDeg), 0, 0);
    scene.updateMatrixWorld(true);
    const wrist = hand.bones.get('wrist');
    const off = wrist ? wrist.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    const wrap = new THREE.Group();
    wrap.add(scene);
    wrap.position.copy(anchor).sub(off);
    return wrap;
  }

  attach(camera: THREE.Camera, scene?: THREE.Scene): void {
    camera.add(this.group);
    if (scene) scene.add(this.spill);
  }

  getTorchOn(): boolean {
    return this.torchOn;
  }

  /** toggle the weapon light (F) — the click sound is played by the caller */
  toggleTorch(): boolean {
    this.torchOn = !this.torchOn;
    return this.torchOn;
  }

  /** hide the whole viewmodel + kill its lights (while driving) */
  setSuppressed(on: boolean): void {
    this.suppressed = on;
    this.group.visible = !on;
    if (on) this.spill.intensity = 0;
  }

  /** persona glove tint */
  setGloveTint(hex: number): void {
    for (const m of this.gloveMats) {
      m.color.setHex(hex);
      m.roughness = 0.88;
      m.metalness = 0.04;
    }
  }

  fireRecoil(): void {
    this.recPV += 6.2;
    this.recZV += 1.6;
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
        new THREE.BoxGeometry(0.04, 0.14, 0.06),
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
    this.recPV += (-this.recP * 210 - this.recPV * 17) * dt;
    this.recP += this.recPV * dt;
    this.recZV += (-this.recZ * 240 - this.recZV * 19) * dt;
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
    const wantSprint = c.sprinting && this.fireGlow <= 0 ? 1 : 0;
    this.sprintBlend += (wantSprint - this.sprintBlend) * Math.min(1, dt * 8);
    const s = this.sprintBlend;

    let px = HIP_POS.x;
    let py = HIP_POS.y;
    let pz = HIP_POS.z;
    let rx = HIP_ROT.x;
    let ry = HIP_ROT.y;
    let rz = HIP_ROT.z;

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
    let freshVisible = false;
    let boltJolt = 0;
    let handLdip = 0;  // 0 = support pose, 1 = fully dipped off-screen
    let handLseat = 0; // 0..1 slap toward the grip with the fresh mag
    if (this.reloadT >= 0) {
      const t = this.reloadT;
      w = smoothstep(t / 0.28) * (1 - smoothstep((t - 1.62) / 0.28));
      px += -0.05 * w;
      py += -0.12 * w;
      pz += 0.05 * w;
      rx += 0.28 * w;
      ry += 0.3 * w;
      rz += -0.44 * w;

      // off hand dips away, comes back carrying the fresh magazine, seats it
      handLdip = smoothstep((t - 0.5) / 0.35) * (1 - smoothstep((t - 1.1) / 0.12));
      handLseat = smoothstep((t - 1.22) / 0.2) * (1 - smoothstep((t - 1.56) / 0.2));
      freshVisible = t > 0.95 && t < 1.56;

      // the seated mag slides out along the grip rake, then "becomes" debris
      if (t > 0.45 && t < 0.95) {
        magDrop = smoothstep((t - 0.45) / 0.34);
        magVisible = magDrop < 0.985;
      }
      if (t >= 1.5 && t < 1.62) {
        boltJolt = Math.sin(((t - 1.5) / 0.12) * Math.PI) * 0.055;
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

    // magazine rides down the grip rake, tilts, then the debris prop takes over
    this.heldMag.visible = magVisible;
    this.heldMag.position.copy(this.magRestPos);
    this.heldMag.quaternion.copy(this.magRestQuat);
    if (magDrop > 0) {
      this.heldMag.position.addScaledVector(this.magAxis, magDrop * 0.15);
      const tiltQ = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        magDrop * 0.42,
      );
      this.heldMag.quaternion.multiply(tiltQ);
    }

    // off hand: dip off-screen, rise with the fresh mag, slap it home
    this.freshMag.visible = freshVisible;
    const dip = handLdip;
    const seat = handLseat;
    this.handL.position.set(
      this.handLBase.x + dip * -0.03 + seat * 0.036,
      this.handLBase.y + dip * -0.42 + seat * 0.055,
      this.handLBase.z + dip * 0.1 + seat * -0.02,
    );
    this.handL.rotation.set(
      dip * -0.85 + seat * 0.12,
      seat * 0.18,
      dip * 0.3 + seat * -0.14,
    );

    // weapon light: smoothed toggle, battery-style micro flicker, beam lag
    this.torchLevel += ((this.torchOn ? 1 : 0) - this.torchLevel) * Math.min(1, dt * 14);
    this.torchDipT -= dt;
    if (this.torchDipT <= 0) {
      this.torchDip = 0.09;
      this.torchDipT = 7 + Math.random() * 9;
    }
    this.torchDip = Math.max(0, this.torchDip - dt);
    const dipK = this.torchDip > 0 ? 0.45 + 0.55 * Math.abs(Math.sin(this.torchDip * 34)) : 1;
    const flicker = 0.965 + 0.035 * Math.sin(this.time * 43) * Math.sin(this.time * 17);
    const suppressK = this.suppressed ? 0 : 1;
    this.torch.intensity = 950 * this.torchLevel * flicker * dipK * suppressK;
    this.spill.intensity = 8.5 * this.torchLevel * dipK * suppressK;
    // scene-level spill hovers just off the gun's upper-right (gun sits at
    // this.group origin — group space, no HIP offset baked in)
    this.spillLocal.set(0.22, 0.15, -0.16);
    this.group.localToWorld(this.spillLocal);
    this.spill.position.copy(this.spillLocal);
    // the beam trails the eyes — pure handheld feel
    this.torchTarget.position.set(
      0.05 + this.lagX * 26 + bobX * 3,
      -0.05 + this.lagY * 26 + bobY * 3 - this.recP * 0.12,
      -14,
    );
  }
}
