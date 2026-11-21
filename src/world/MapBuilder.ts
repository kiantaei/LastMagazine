import * as THREE from 'three';
import { createFire, type Fire } from './Fire';

export interface Collider {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/** Deterministic PRNG so the arena layout is identical on every load. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(
  size: number,
  repeat: number,
  draw: (ctx: CanvasRenderingContext2D, s: number, rnd: () => number) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  draw(ctx, size, mulberry32(0xc0ffee));
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  return tex;
}

function grain(ctx: CanvasRenderingContext2D, s: number, rnd: () => number, n: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rnd() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

const asphaltTex = () =>
  canvasTexture(512, 9, (ctx, s, rnd) => {
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 9000, 0.07);
    // expansion joints
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, s, s);
    // oil stains
    for (let i = 0; i < 7; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const r = 20 + rnd() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(5,6,8,0.5)');
      g.addColorStop(1, 'rgba(5,6,8,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // cracks
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      let x = rnd() * s;
      let y = rnd() * s;
      ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) {
        x += (rnd() - 0.5) * 60;
        y += (rnd() - 0.5) * 60;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });

const concreteTex = () =>
  canvasTexture(512, 1, (ctx, s, rnd) => {
    ctx.fillStyle = '#1f2329';
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 7000, 0.08);
    // panel seams + drip stains
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, s / 3 - 1, s, 2);
    ctx.fillRect(0, (s * 2) / 3 - 1, s, 2);
    for (let i = 0; i < 8; i++) {
      const x = rnd() * s;
      const w = 3 + rnd() * 8;
      ctx.fillStyle = `rgba(10,12,14,${0.10 + rnd() * 0.15})`;
      ctx.fillRect(x, rnd() * s * 0.4, w, s * (0.3 + rnd() * 0.5));
    }
  });

const woodTex = () =>
  canvasTexture(256, 1, (ctx, s, rnd) => {
    const planks = 4;
    const pw = s / planks;
    for (let p = 0; p < planks; p++) {
      const l = 9 + rnd() * 6;
      ctx.fillStyle = `hsl(${24 + rnd() * 8}, 34%, ${l}%)`;
      ctx.fillRect(p * pw, 0, pw, s);
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      for (let i = 0; i < 26; i++) {
        ctx.beginPath();
        const x = p * pw + rnd() * pw;
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (rnd() - 0.5) * 6, s);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(p * pw, 0, 2, s);
    }
  });

const metalTex = () =>
  canvasTexture(512, 1, (ctx, s, rnd) => {
    ctx.fillStyle = '#191f25';
    ctx.fillRect(0, 0, s, s);
    // corrugation stripes
    const stripe = 32;
    for (let x = 0; x < s; x += stripe) {
      const g = ctx.createLinearGradient(x, 0, x + stripe, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.10)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.02)');
      g.addColorStop(1, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, stripe, s);
    }
    // rails + rivets
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, s, 26);
    ctx.fillRect(0, s - 26, s, 26);
    ctx.fillStyle = 'rgba(200,210,220,0.25)';
    for (let x = 8; x < s; x += 24) {
      ctx.beginPath();
      ctx.arc(x, 13, 2.2, 0, Math.PI * 2);
      ctx.arc(x, s - 13, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // rust blooms
    for (let i = 0; i < 6; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const r = 10 + rnd() * 46;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(122,66,32,0.34)');
      g.addColorStop(1, 'rgba(122,66,32,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });

/**
 * Builds the whole arena: ground, perimeter, cover props, fires,
 * collision AABBs, bullet-hit targets and enemy spawn points.
 * The night is lit ONLY by the yard fires — the player's weapon light
 * (owned by the viewmodel) does the rest. No ambient/moon/lamp lights.
 */
export class MapBuilder {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly hittables: THREE.Object3D[] = [];
  readonly spawnPoints: THREE.Vector3[] = [];
  readonly fires: Fire[] = [];
  readonly firePositions: THREE.Vector3[] = [];
  readonly playerStart = new THREE.Vector3(0, 0, 24);

  constructor() {
    this.buildSky();
    this.buildGroundAndWalls();
    this.buildFires();
    this.buildStructures();
    this.buildProps();
    this.buildSpawns();
  }

  // ---------------------------------------------------------------- sky/floor
  private buildSky(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(280, 24, 14),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(0x010204) },
          bottom: { value: new THREE.Color(0x030507) },
        },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
          void main(){ float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(mix(bottom, top, pow(h, 0.75)), 1.0); }`,
      }),
    );
    sky.frustumCulled = false;
    this.group.add(sky);

    // faint stars — decoration only, they emit no light
    const starPos: number[] = [];
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2;
      const y = 0.18 + Math.random() * 0.8;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      starPos.push(Math.cos(a) * r * 250, y * 250, Math.sin(a) * r * 250);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0x7f92b6,
        size: 1.6,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.5,
        fog: false,
        depthWrite: false,
      }),
    );
    stars.frustumCulled = false;
    this.group.add(stars);
  }

  private buildGroundAndWalls(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(68, 68),
      new THREE.MeshStandardMaterial({ map: asphaltTex(), roughness: 0.94, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.hittables.push(floor);

    const wallMat = new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.9, metalness: 0.05 });
    const walls: Array<[number, number, number, number, number, number]> = [
      // cx, cy, cz, w, h, d
      [0, 3, -32.5, 68, 6, 1.4],
      [0, 3, 32.5, 68, 6, 1.4],
      [-32.5, 3, 0, 1.4, 6, 68],
      [32.5, 3, 0, 1.4, 6, 68],
    ];
    for (const [x, y, z, w, h, d] of walls) {
      this.addBox(wallMat, w, h, d, new THREE.Vector3(x, y, z));
    }
  }

  // ------------------------------------------------------------------- fires
  private buildFires(): void {
    // oil drums burning around the yard — the arena's only light sources
    const fireBarrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.95, 14);
    const fireBarrelMat = new THREE.MeshStandardMaterial({ map: metalTex(), roughness: 0.7, metalness: 0.4, color: 0x4a4440 });
    const spots: Array<[number, number]> = [
      [-26, 22],
      [26, 22],
      [-26, -22],
      [26, -22],
      [0, -26],
      [-14, -4],
    ];
    for (let i = 0; i < spots.length; i++) {
      const [x, z] = spots[i];
      const { object, fire } = createFire(fireBarrelGeo, fireBarrelMat, x, z, i * 13.7 + 5);
      this.group.add(object);
      this.fires.push(fire);
      this.firePositions.push(new THREE.Vector3(x, 1.4, z));
      const drum = object.children[0] as THREE.Mesh;
      this.hittables.push(drum);
      this.colliders.push({
        min: new THREE.Vector3(x - 0.46, 0, z - 0.46),
        max: new THREE.Vector3(x + 0.46, 1.1, z + 0.46),
      });
    }
  }

  // --------------------------------------------------------------- structures
  private buildStructures(): void {
    const concrete = new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.9 });
    const metal = new THREE.MeshStandardMaterial({ map: metalTex(), roughness: 0.55, metalness: 0.6 });

    // interior lane walls with two doorways
    this.addBox(concrete, 11, 4.5, 1, new THREE.Vector3(-10.5, 2.25, 0));
    this.addBox(concrete, 4.5, 4.5, 1, new THREE.Vector3(5.25, 2.25, 0));
    // cross wall
    this.addBox(concrete, 1, 4.5, 12, new THREE.Vector3(16, 2.25, -8));

    // shipping containers (axis aligned so colliders are exact)
    this.addBox(metal, 6.1, 2.6, 2.5, new THREE.Vector3(-18, 1.3, -16));
    this.addBox(metal, 6.1, 2.6, 2.5, new THREE.Vector3(-18, 3.9, -16));
    this.addBox(metal, 2.5, 2.6, 6.1, new THREE.Vector3(20, 1.3, 10));
    this.addBox(metal, 6.1, 2.6, 2.5, new THREE.Vector3(8, 1.3, -18));

    // colonnade
    for (const [x, z] of [[-24, 8], [-24, -8], [24, 8], [24, -8]]) {
      this.addBox(concrete, 1.2, 5, 1.2, new THREE.Vector3(x, 2.5, z));
    }
  }

  // -------------------------------------------------------------------- props
  private buildProps(): void {
    const wood = new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.85 });
    const barrierMat = new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.92 });
    const barrelMat = new THREE.MeshStandardMaterial({ map: metalTex(), roughness: 0.6, metalness: 0.55 });

    const crateGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const crateAt = (x: number, y: number, z: number, ry: number): void => {
      const m = new THREE.Mesh(crateGeo, wood);
      m.position.set(x, y + 0.6, z);
      m.rotation.y = ry;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      this.hittables.push(m);
      // collider hugs the unrotated box; small yaw angles keep it fair
      const half = 0.62;
      this.colliders.push({
        min: new THREE.Vector3(x - half, y, z - half),
        max: new THREE.Vector3(x + half, y + 1.2, z + half),
      });
    };
    const crateCluster = (cx: number, cz: number): void => {
      const rnd = mulberry32(Math.floor(cx * 31 + cz * 17));
      for (let i = 0; i < 5; i++) {
        const x = cx + (rnd() - 0.5) * 3.4;
        const z = cz + (rnd() - 0.5) * 3.4;
        const stack = rnd() < 0.3 ? 2 : 1;
        for (let s = 0; s < stack; s++) crateAt(x, s * 1.2, z, rnd() * 0.5 - 0.25);
      }
    };
    for (const [x, z] of [[-6, 10], [12, 4], [-20, 4], [24, -6], [-12, -20], [4, -12], [20, 20], [-24, -8]]) {
      crateCluster(x, z);
    }

    // jersey barriers (waist-high cover)
    const barrierGeo = new THREE.BoxGeometry(2.2, 0.85, 0.6);
    for (const [x, z, ry] of [[0, 11, 0.1], [2.3, 11.2, 0.05], [-8, -6, Math.PI / 2], [-8.3, -8.3, Math.PI / 2], [13, -10, 0.2], [-16, 12, Math.PI / 2]]) {
      const m = new THREE.Mesh(barrierGeo, barrierMat);
      m.position.set(x, 0.425, z);
      m.rotation.y = ry;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      this.hittables.push(m);
      const w = ry === 0 || Math.abs(ry) < 0.3 ? 1.15 : 0.35;
      const d = w === 1.15 ? 0.35 : 1.15;
      this.colliders.push({
        min: new THREE.Vector3(x - w, 0, z - d),
        max: new THREE.Vector3(x + w, 0.85, z + d),
      });
    }

    // barrels
    const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.95, 14);
    for (const [x, z] of [[-16, 12], [14, 16], [-24, -14], [10, -6], [26, 4]]) {
      const rnd = mulberry32(Math.floor(x * 13 + z * 7));
      for (let i = 0; i < 3; i++) {
        const bx = x + (rnd() - 0.5) * 1.6;
        const bz = z + (rnd() - 0.5) * 1.6;
        const m = new THREE.Mesh(barrelGeo, barrelMat);
        m.position.set(bx, 0.475, bz);
        m.castShadow = m.receiveShadow = true;
        this.group.add(m);
        this.hittables.push(m);
        this.colliders.push({
          min: new THREE.Vector3(bx - 0.44, 0, bz - 0.44),
          max: new THREE.Vector3(bx + 0.44, 0.95, bz + 0.44),
        });
      }
    }
  }

  private buildSpawns(): void {
    const pts: Array<[number, number]> = [
      [-29, -29],
      [29, -29],
      [-29, 29],
      [29, 29],
      [0, -29.5],
      [-29.5, 0],
      [29.5, 0],
      [0, 29.5],
      [-29, 12],
      [29, -12],
    ];
    for (const [x, z] of pts) this.spawnPoints.push(new THREE.Vector3(x, 0, z));
  }

  // ------------------------------------------------------------------ helpers
  private addBox(
    material: THREE.MeshStandardMaterial,
    w: number,
    h: number,
    d: number,
    center: THREE.Vector3,
  ): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.copy(center);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    this.hittables.push(m);
    const half = new THREE.Vector3(w / 2, h / 2, d / 2);
    this.colliders.push({ min: center.clone().sub(half), max: center.clone().add(half) });
    return m;
  }
}
