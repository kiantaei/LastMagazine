import * as THREE from 'three';

// -------------------------------------------------------------- textures
function radialSprite(inner: string, outer: string, size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function bulletHoleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 26);
  g.addColorStop(0, 'rgba(8,8,9,0.95)');
  g.addColorStop(0.45, 'rgba(16,15,14,0.75)');
  g.addColorStop(1, 'rgba(20,20,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const flashTex = () => radialSprite('rgba(255,244,214,1)', 'rgba(255,166,64,0.85)');
const smokeTex = () => radialSprite('rgba(120,118,112,0.55)', 'rgba(90,88,84,0.3)');

// ------------------------------------------------------------ muzzle flash
export class FlashPool {
  private items: Array<{ light: THREE.PointLight; sprite: THREE.Sprite; life: number }> = [];
  private idx = 0;

  constructor(scene: THREE.Scene, count = 5) {
    for (let i = 0; i < count; i++) {
      const light = new THREE.PointLight(0xffc37a, 0, 16, 2);
      light.visible = false;
      scene.add(light);
      const mat = new THREE.SpriteMaterial({
        map: flashTex(),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        rotation: Math.random() * Math.PI * 2,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.setScalar(0.34);
      sprite.visible = false;
      scene.add(sprite);
      this.items.push({ light, sprite, life: 0 });
    }
  }

  spawn(pos: THREE.Vector3, scale = 1): void {
    const it = this.items[this.idx++ % this.items.length];
    it.light.position.copy(pos);
    it.light.intensity = 60 * scale;
    it.light.visible = true;
    it.sprite.position.copy(pos);
    it.sprite.scale.setScalar(0.3 * scale + Math.random() * 0.1);
    (it.sprite.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI * 2;
    it.sprite.visible = true;
    it.life = 0.05;
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (it.life > 0) {
        it.life -= dt;
        if (it.life <= 0) {
          it.light.visible = false;
          it.light.intensity = 0;
          it.sprite.visible = false;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- tracers
interface Tracer {
  mesh: THREE.Mesh;
  dir: THREE.Vector3;
  head: THREE.Vector3;
  remaining: number;
}

export class TracerPool {
  private items: Tracer[] = [];
  private idx = 0;
  private readonly speed = 300;

  constructor(scene: THREE.Scene, count = 28) {
    const geo = new THREE.BoxGeometry(0.016, 0.016, 1);
    geo.translate(0, 0, -0.5); // extends forward from origin along -z? we orient via quaternion
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.items.push({ mesh, dir: new THREE.Vector3(), head: new THREE.Vector3(), remaining: 0 });
    }
  }

  spawn(from: THREE.Vector3, to: THREE.Vector3): void {
    const it = this.items[this.idx++ % this.items.length];
    it.dir.subVectors(to, from);
    const dist = it.dir.length();
    if (dist < 0.4) return;
    it.dir.divideScalar(dist);
    it.head.copy(from);
    it.remaining = dist;
    it.mesh.visible = true;
    it.mesh.position.copy(from);
    it.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), it.dir);
    it.mesh.scale.z = 0.01;
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      const step = Math.min(this.speed * dt, it.remaining);
      it.head.addScaledVector(it.dir, step);
      it.remaining -= step;
      const seg = Math.min(2.6, this.speed * dt + it.mesh.scale.z);
      it.mesh.position.copy(it.head).addScaledVector(it.dir, -seg / 2);
      it.mesh.scale.z = Math.max(0.05, seg);
      if (it.remaining <= 0) it.mesh.visible = false;
    }
  }
}

// ----------------------------------------------------------------- shells
interface Shell {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  groundY: number;
  bounces: number;
  life: number;
  tinked: boolean;
}

export class ShellPool {
  private items: Shell[] = [];
  private idx = 0;
  private ray: THREE.Raycaster;

  constructor(
    private scene: THREE.Scene,
    count = 16,
    private hittables: THREE.Object3D[] = [],
  ) {
    const geo = new THREE.CylinderGeometry(0.008, 0.008, 0.034, 8);
    this.ray = new THREE.Raycaster();
    this.ray.far = 4;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0xc9973f, metalness: 0.9, roughness: 0.32 }),
      );
      m.visible = false;
      scene.add(m);
      this.items.push({
        mesh: m,
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        groundY: 0,
        bounces: 0,
        life: 0,
        tinked: false,
      });
    }
  }

  /**
   * @param pos    ejection port position
   * @param right  camera-right direction
   */
  spawn(pos: THREE.Vector3, right: THREE.Vector3): void {
    const it = this.items[this.idx++ % this.items.length];
    it.mesh.position.copy(pos);
    it.vel
      .copy(right)
      .multiplyScalar(1.9 + Math.random() * 1.1)
      .add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 1.7 + Math.random() * 0.7, (Math.random() - 0.5) * 0.5));
    it.spin.set(Math.random() * 22, Math.random() * 22, Math.random() * 22);
    // find the ground beneath
    this.ray.set(pos, new THREE.Vector3(0, -1, 0));
    const hits = this.ray.intersectObjects(this.hittables, false);
    it.groundY = hits.length > 0 ? hits[0].point.y : 0;
    it.bounces = 0;
    it.life = 2.6;
    it.tinked = false;
    it.mesh.visible = true;
  }

  update(dt: number, tink: (p: THREE.Vector3) => void): void {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.life -= dt;
      it.vel.y -= 9.8 * dt;
      it.mesh.position.addScaledVector(it.vel, dt);
      it.mesh.rotation.x += it.spin.x * dt;
      it.mesh.rotation.y += it.spin.y * dt;
      it.mesh.rotation.z += it.spin.z * dt;
      const floor = it.groundY + 0.02;
      if (it.mesh.position.y < floor && it.vel.y < 0) {
        it.mesh.position.y = floor;
        it.vel.y *= -0.32;
        it.vel.x *= 0.55;
        it.vel.z *= 0.55;
        it.bounces++;
        if (!it.tinked) {
          it.tinked = true;
          tink(it.mesh.position);
        }
        if (it.bounces > 3) {
          it.vel.set(0, 0, 0);
          it.spin.set(0, 0, 0);
        }
      }
      if (it.life <= 0) it.mesh.visible = false;
    }
  }
}

// ---------------------------------------------------------------- impacts
interface SparkBurst {
  points: THREE.Points;
  vel: Float32Array;
  life: number;
}

interface SmokePuff {
  sprite: THREE.Sprite;
  life: number;
}

const SPARKS_PER_BURST = 9;

export class ImpactPool {
  private bursts: SparkBurst[] = [];
  private bIdx = 0;
  private decals: THREE.Mesh[] = [];
  private dIdx = 0;
  private smokes: SmokePuff[] = [];
  private sIdx = 0;

  constructor(private scene: THREE.Scene, burstCount = 10, decalCount = 40, smokeCount = 12) {
    for (let i = 0; i < burstCount; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS_PER_BURST * 3), 3));
      const mat = new THREE.PointsMaterial({
        color: 0xffd090,
        size: 0.045,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const points = new THREE.Points(geo, mat);
      points.visible = false;
      points.frustumCulled = false;
      scene.add(points);
      this.bursts.push({ points, vel: new Float32Array(SPARKS_PER_BURST * 3), life: 0 });
    }

    const holeTex = bulletHoleTexture();
    const dGeo = new THREE.PlaneGeometry(0.16, 0.16);
    for (let i = 0; i < decalCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: holeTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      const m = new THREE.Mesh(dGeo, mat);
      m.visible = false;
      scene.add(m);
      this.decals.push(m);
    }

    const sTex = smokeTex();
    for (let i = 0; i < smokeCount; i++) {
      const mat = new THREE.SpriteMaterial({ map: sTex, transparent: true, depthWrite: false });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      scene.add(sp);
      this.smokes.push({ sprite: sp, life: 0 });
    }
  }

  spawn(point: THREE.Vector3, normal: THREE.Vector3, kind: 'world' | 'flesh' = 'world'): void {
    // sparks
    const b = this.bursts[this.bIdx++ % this.bursts.length];
    const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < SPARKS_PER_BURST; i++) {
      pos.setXYZ(i, point.x, point.y, point.z);
      const vx = normal.x + (Math.random() - 0.5) * 1.6;
      const vy = normal.y + Math.random() * 1.4;
      const vz = normal.z + (Math.random() - 0.5) * 1.6;
      b.vel[i * 3] = vx * 3.2;
      b.vel[i * 3 + 1] = vy * 3.2;
      b.vel[i * 3 + 2] = vz * 3.2;
    }
    pos.needsUpdate = true;
    (b.points.material as THREE.PointsMaterial).color.setHex(kind === 'flesh' ? 0x9c1418 : 0xffd090);
    (b.points.material as THREE.PointsMaterial).size = kind === 'flesh' ? 0.06 : 0.045;
    b.points.visible = true;
    b.life = 0.3;

    if (kind === 'world') {
      // bullet hole decal
      const d = this.decals[this.dIdx++ % this.decals.length];
      d.position.copy(point).addScaledVector(normal, 0.012);
      d.lookAt(point.clone().add(normal));
      d.rotateZ(Math.random() * Math.PI * 2);
      d.scale.setScalar(0.8 + Math.random() * 0.5);
      d.visible = true;

      // smoke puff
      const s = this.smokes[this.sIdx++ % this.smokes.length];
      s.sprite.position.copy(point).addScaledVector(normal, 0.06);
      s.sprite.scale.setScalar(0.14);
      (s.sprite.material as THREE.SpriteMaterial).opacity = 0.5;
      s.sprite.visible = true;
      s.life = 0.55;
    }
  }

  update(dt: number): void {
    for (const b of this.bursts) {
      if (!b.points.visible) continue;
      b.life -= dt;
      const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < SPARKS_PER_BURST; i++) {
        b.vel[i * 3 + 1] -= 11 * dt;
        pos.setXYZ(
          i,
          pos.getX(i) + b.vel[i * 3] * dt,
          pos.getY(i) + b.vel[i * 3 + 1] * dt,
          pos.getZ(i) + b.vel[i * 3 + 2] * dt,
        );
      }
      pos.needsUpdate = true;
      const mat = b.points.material as THREE.PointsMaterial;
      mat.opacity = Math.max(0, b.life / 0.3);
      if (b.life <= 0) b.points.visible = false;
    }
    for (const s of this.smokes) {
      if (!s.sprite.visible) continue;
      s.life -= dt;
      const t = 1 - s.life / 0.55;
      s.sprite.scale.setScalar(0.14 + t * 0.42);
      s.sprite.position.y += dt * 0.35;
      (s.sprite.material as THREE.SpriteMaterial).opacity = 0.5 * (1 - t);
      if (s.life <= 0) s.sprite.visible = false;
    }
    void this.scene;
  }
}

// ----------------------------------------------------------------- debris
/** Dropped magazines (reload) with simple ballistic fall. */
export class DebrisPool {
  private items: Array<{ mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number; groundY: number }> = [];
  private idx = 0;
  private ray: THREE.Raycaster;

  constructor(
    scene: THREE.Scene,
    count = 3,
    private hittables: THREE.Object3D[] = [],
    makeMesh: () => THREE.Mesh = () =>
      new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.17, 0.085),
        new THREE.MeshStandardMaterial({ color: 0x101215, metalness: 0.6, roughness: 0.5 }),
      ),
  ) {
    this.ray = new THREE.Raycaster();
    this.ray.far = 3;
    for (let i = 0; i < count; i++) {
      const m = makeMesh();
      m.visible = false;
      m.castShadow = true;
      scene.add(m);
      this.items.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, groundY: 0 });
    }
  }

  spawn(pos: THREE.Vector3, forward: THREE.Vector3): void {
    const it = this.items[this.idx++ % this.items.length];
    it.mesh.position.copy(pos);
    it.vel.set((Math.random() - 0.5) * 0.6, -0.6, (Math.random() - 0.5) * 0.6).addScaledVector(forward, 0.55);
    it.spin.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7);
    this.ray.set(pos, new THREE.Vector3(0, -1, 0));
    const hits = this.ray.intersectObjects(this.hittables, false);
    it.groundY = hits.length > 0 ? hits[0].point.y : 0;
    it.life = 3;
    it.mesh.visible = true;
    (it.mesh.material as THREE.MeshStandardMaterial).opacity = 1;
    (it.mesh.material as THREE.MeshStandardMaterial).transparent = false;
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.life -= dt;
      it.vel.y -= 9.8 * dt;
      it.mesh.position.addScaledVector(it.vel, dt);
      it.mesh.rotation.x += it.spin.x * dt;
      it.mesh.rotation.z += it.spin.z * dt;
      if (it.mesh.position.y < it.groundY + 0.04 && it.vel.y < 0) {
        it.mesh.position.y = it.groundY + 0.04;
        it.vel.set(0, 0, 0);
        it.spin.set(0, 0, 0);
      }
      if (it.life < 0.6) {
        const mat = it.mesh.material as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.opacity = Math.max(0, it.life / 0.6);
      }
      if (it.life <= 0) it.mesh.visible = false;
    }
  }
}

import type { SFX } from '../audio/SFX';

/** shared world-FX bundle handed to NPC / police systems */
export interface WorldFx {
  flash: FlashPool;
  tracers: TracerPool;
  impacts: ImpactPool;
  sfx: SFX;
}
