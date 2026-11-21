import * as THREE from 'three';
import { createFire, type Fire } from './Fire';
import { buildCityLayout, type CityLayout, type ZoneId } from './CityLayout';

export interface Collider {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/** Deterministic PRNG so textures are identical on every load. */
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

const asphaltTex = (repeat: number, withLane = false) =>
  canvasTexture(512, repeat, (ctx, s, rnd) => {
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 9000, 0.07);
    if (withLane) {
      // dashed centre line (texture runs along the road)
      ctx.fillStyle = 'rgba(190,170,90,0.5)';
      ctx.fillRect(s * 0.47, s * 0.1, s * 0.06, s * 0.34);
      ctx.fillRect(s * 0.47, s * 0.6, s * 0.06, s * 0.34);
    }
    for (let i = 0; i < 5; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const r = 20 + rnd() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(5,6,8,0.5)');
      g.addColorStop(1, 'rgba(5,6,8,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });

const concreteTex = () =>
  canvasTexture(512, 1, (ctx, s, rnd) => {
    ctx.fillStyle = '#1f2329';
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 7000, 0.08);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, s / 3 - 1, s, 2);
    ctx.fillRect(0, (s * 2) / 3 - 1, s, 2);
    for (let i = 0; i < 8; i++) {
      const x = rnd() * s;
      const w = 3 + rnd() * 8;
      ctx.fillStyle = `rgba(10,12,14,${0.1 + rnd() * 0.15})`;
      ctx.fillRect(x, rnd() * s * 0.4, w, s * (0.3 + rnd() * 0.5));
    }
  });

const metalTex = () =>
  canvasTexture(512, 1, (ctx, s, rnd) => {
    ctx.fillStyle = '#191f25';
    ctx.fillRect(0, 0, s, s);
    const stripe = 32;
    for (let x = 0; x < s; x += stripe) {
      const g = ctx.createLinearGradient(x, 0, x + stripe, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.10)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.02)');
      g.addColorStop(1, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, stripe, s);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, s, 26);
    ctx.fillRect(0, s - 26, s, 26);
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

/** facade with a scatter of faintly lit windows (emissive paint, no real light) */
const facadeTex = (litChance: number, warm = 'rgba(220,190,120,0.85)') =>
  canvasTexture(256, 1, (ctx, s, rnd) => {
    ctx.fillStyle = '#101317';
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, rnd, 3000, 0.06);
    const cols = 6;
    const rows = 8;
    const cw = s / cols;
    const rh = s / rows;
    for (let cx = 0; cx < cols; cx++) {
      for (let ry = 0; ry < rows; ry++) {
        const x = cx * cw + cw * 0.18;
        const y = ry * rh + rh * 0.22;
        const w = cw * 0.62;
        const h = rh * 0.5;
        const lit = rnd();
        if (lit < litChance) ctx.fillStyle = warm; // warm lit window
        else if (lit < litChance + 0.06) ctx.fillStyle = 'rgba(140,170,210,0.55)'; // cold TV glow
        else ctx.fillStyle = 'rgba(8,9,11,0.95)'; // dark glass
        ctx.fillRect(x, y, w, h);
      }
    }
  });

export interface ParkingSpot {
  pos: THREE.Vector3;
  yaw: number;
}

export interface StorePoint {
  name: string;
  /** register interaction point (on the sidewalk in front of the sign) */
  register: THREE.Vector3;
}

const ZONE_STYLE: Record<ZoneId, { tex: () => THREE.CanvasTexture; color: number; emissive: number; intensity: number; rep: [number, number] }> = {
  downtown: { tex: () => facadeTex(0.12, 'rgba(190,205,235,0.8)'), color: 0x3d4652, emissive: 0x8ea0c0, intensity: 0.5, rep: [3, 8] },
  residential: { tex: () => facadeTex(0.14), color: 0x5a616c, emissive: 0x9a8a68, intensity: 0.45, rep: [2, 3] },
  slum: { tex: () => facadeTex(0.06, 'rgba(255,170,90,0.7)'), color: 0x6a5a4e, emissive: 0x8a5a30, intensity: 0.3, rep: [1, 1] },
  industrial: { tex: () => metalTex(), color: 0x4e565e, emissive: 0x000000, intensity: 0, rep: [3, 2] },
};

/**
 * Night open world: a 6×6-block road grid spanning ±178 m with downtown
 * towers, residential mid-rises, slum shanties and industrial warehouses.
 * Everything repetitive is an InstancedMesh (buildings per zone, sidewalk
 * slabs, streetlights, trees, trash, dumpsters) — a few dozen draw calls
 * for the whole city. Dense FogExp2 hides the map edges.
 */
export class City {
  readonly group = new THREE.Group();
  readonly layout: CityLayout;
  readonly colliders: Collider[] = [];
  readonly hittables: THREE.Object3D[] = [];
  readonly fires: Fire[] = [];
  readonly firePositions: THREE.Vector3[] = [];
  readonly parkingSpots: ParkingSpot[] = [];
  /** market/liquor/pawn registers for the robbery system */
  readonly storePoints: StorePoint[] = [];
  /** hot-dog cart interaction points */
  readonly cartPoints: THREE.Vector3[] = [];
  /** sidewalk + alley waypoints for civilian wandering */
  readonly walkPoints: THREE.Vector3[] = [];
  /** roadside points for police spawns */
  readonly roadSpawnPoints: THREE.Vector3[] = [];
  readonly playerStart = new THREE.Vector3(27, 0, 21);

  constructor() {
    this.layout = buildCityLayout();
    this.buildSky();
    this.buildGround();
    this.buildRoads();
    this.buildSidewalks();
    this.buildBuildings();
    this.buildPerimeter();
    this.buildStreetlights();
    this.buildProps();
    this.buildFiresAndKiosks();
    this.buildPoints();
  }

  // ---------------------------------------------------------------- sky/floor
  private buildSky(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(320, 24, 14),
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

    const starPos: number[] = [];
    for (let i = 0; i < 300; i++) {
      const a = Math.random() * Math.PI * 2;
      const y = 0.18 + Math.random() * 0.8;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      starPos.push(Math.cos(a) * r * 300, y * 300, Math.sin(a) * r * 300);
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

  private buildGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.layout.half * 2, this.layout.half * 2),
      new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.96, metalness: 0.04 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.hittables.push(ground);
  }

  private buildRoads(): void {
    const tex = asphaltTex(4, true);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.06 });
    for (const c of this.layout.roadCenters) {
      // N-S strip (slightly raised; E-W sits a hair above to avoid z-fighting)
      const ns = new THREE.Mesh(new THREE.PlaneGeometry(this.layout.road, this.layout.half * 2), mat);
      ns.rotation.x = -Math.PI / 2;
      ns.position.set(c, 0.01, 0);
      ns.receiveShadow = true;
      this.group.add(ns);
      this.hittables.push(ns);
      const ew = new THREE.Mesh(new THREE.PlaneGeometry(this.layout.half * 2, this.layout.road), mat);
      ew.rotation.x = -Math.PI / 2;
      ew.position.set(0, 0.03, c);
      ew.receiveShadow = true;
      this.group.add(ew);
      this.hittables.push(ew);
    }
  }

  private buildSidewalks(): void {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.94, metalness: 0.04 });
    const slabs = this.layout.slabs;
    const mesh = new THREE.InstancedMesh(geo, mat, slabs.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    slabs.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.x, 0.06, s.z), q, new THREE.Vector3(s.w, 0.12, s.d));
      mesh.setMatrixAt(i, m);
    });
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildBuildings(): void {
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const byZone = new Map<ZoneId, THREE.InstancedMesh>();
    const zones: ZoneId[] = ['downtown', 'residential', 'slum', 'industrial'];
    for (const zone of zones) {
      const st = ZONE_STYLE[zone];
      const tex = st.tex();
      tex.repeat.set(st.rep[0], st.rep[1]);
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: st.intensity > 0 ? tex : undefined,
        emissive: new THREE.Color(st.emissive),
        emissiveIntensity: st.intensity,
        roughness: 0.88,
        metalness: zone === 'industrial' ? 0.4 : 0.08,
        color: st.color,
      });
      const count = this.layout.buildings.filter((b) => b.zone === zone).length;
      const mesh = new THREE.InstancedMesh(unit, mat, count);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.zone = zone;
      byZone.set(zone, mesh);
      this.group.add(mesh);
      this.hittables.push(mesh);
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const idx: Record<ZoneId, number> = { downtown: 0, residential: 0, slum: 0, industrial: 0 };
    for (const b of this.layout.buildings) {
      const mesh = byZone.get(b.zone) as THREE.InstancedMesh;
      m.compose(
        new THREE.Vector3(b.x, b.h / 2 + 0.12, b.z),
        q,
        new THREE.Vector3(b.w, b.h, b.d),
      );
      mesh.setMatrixAt(idx[b.zone]++, m);
      this.colliders.push({
        min: new THREE.Vector3(b.x - b.w / 2, 0.12, b.z - b.d / 2),
        max: new THREE.Vector3(b.x + b.w / 2, b.h + 0.12, b.z + b.d / 2),
      });
    }
  }

  private buildPerimeter(): void {
    const wallMat = new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.9, metalness: 0.05 });
    const h = this.layout.half;
    const walls: Array<[number, number, number, number, number, number]> = [
      [0, 5, -h, h * 2, 10, 1.4],
      [0, 5, h, h * 2, 10, 1.4],
      [-h, 5, 0, 1.4, 10, h * 2],
      [h, 5, 0, 1.4, 10, h * 2],
    ];
    for (const [x, y, z, w, hh, d] of walls) {
      this.addBox(wallMat, w, hh, d, new THREE.Vector3(x, y, z));
    }
  }

  private buildPoints(): void {
    for (const p of this.layout.roadSpawns) this.roadSpawnPoints.push(p);
    for (const s of this.layout.parkingSpots) {
      this.parkingSpots.push({ pos: new THREE.Vector3(s.x, 0, s.z), yaw: s.yaw });
    }
    // walk points already carry sidewalk + alley positions from the layout
    for (const p of this.layout.walkPoints) this.walkPoints.push(p);
  }

  // ---------------------------------------------------- street furniture
  /**
   * Streetlight poles along every road (instanced). Emissive heads only —
   * sodium-lamp look without a single real light.
   */
  private buildStreetlights(): void {
    const positions: THREE.Vector3[] = [];
    for (const c of this.layout.roadCenters) {
      let i = 0;
      for (let t = -166; t <= 166; t += 26, i++) {
        const side = (i % 2 === 0 ? 1 : -1) * (this.layout.road / 2 - 1.2);
        positions.push(new THREE.Vector3(c + side, 0, t)); // N-S road
        positions.push(new THREE.Vector3(t, 0, c + side)); // E-W road
      }
    }
    const count = positions.length;

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.7, metalness: 0.5 });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, 5.4, 8), poleMat, count);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x1a1c20,
      emissive: new THREE.Color(0x9fb4d8),
      emissiveIntensity: 1.5,
      roughness: 0.4,
    });
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.16, 0.4), headMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    positions.forEach((p, i) => {
      m.compose(new THREE.Vector3(p.x, 2.7, p.z), q, one);
      poles.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p.x, 5.42, p.z), q, one);
      heads.setMatrixAt(i, m);
    });
    poles.castShadow = false;
    heads.castShadow = false;
    this.group.add(poles, heads);
  }

  /** trees (instanced trunk + canopy), trash cans, dumpsters */
  private buildProps(): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const quatFromYaw = (yaw: number) => q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

    // --- trees
    const trees = this.layout.trees;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2e2620, roughness: 0.95 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1d2b1c, roughness: 1 });
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 2.6, 7), trunkMat, trees.length);
    const canopies = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.5, 0), canopyMat, trees.length);
    trees.forEach((t, i) => {
      m.compose(new THREE.Vector3(t.x, 1.3, t.z), q, one);
      trunks.setMatrixAt(i, m);
      const s = 0.9 + ((i * 37) % 10) / 22;
      m.compose(new THREE.Vector3(t.x, 3.1 + s * 0.5, t.z), quatFromYaw(i * 1.3), new THREE.Vector3(s, s * 1.25, s));
      canopies.setMatrixAt(i, m);
      this.colliders.push({
        min: new THREE.Vector3(t.x - 0.28, 0, t.z - 0.28),
        max: new THREE.Vector3(t.x + 0.28, 2.6, t.z + 0.28),
      });
    });
    trunks.castShadow = canopies.castShadow = true;
    this.group.add(trunks, canopies);

    // --- trash cans
    const trash = this.layout.trashCans;
    const trashMat = new THREE.MeshStandardMaterial({ color: 0x2c3136, roughness: 0.8, metalness: 0.3 });
    const cans = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.36, 0.85, 9), trashMat, trash.length);
    trash.forEach((t, i) => {
      m.compose(new THREE.Vector3(t.x, 0.43, t.z), q, one);
      cans.setMatrixAt(i, m);
      this.colliders.push({
        min: new THREE.Vector3(t.x - 0.38, 0, t.z - 0.38),
        max: new THREE.Vector3(t.x + 0.38, 0.88, t.z + 0.38),
      });
    });
    cans.castShadow = true;
    this.group.add(cans);

    // --- dumpsters (alley cover)
    const dumps = this.layout.dumpsters;
    const dumpMat = new THREE.MeshStandardMaterial({ map: metalTex(), roughness: 0.55, metalness: 0.6 });
    const meshes = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 1.3, 1.3), dumpMat, dumps.length);
    dumps.forEach((d, i) => {
      m.compose(new THREE.Vector3(d.x, 0.65, d.z), quatFromYaw(d.yaw), one);
      meshes.setMatrixAt(i, m);
      // world-space AABB of the rotated footprint
      const c = Math.abs(Math.cos(d.yaw));
      const s = Math.abs(Math.sin(d.yaw));
      const hx = c * 1.25 + s * 0.7;
      const hz = s * 1.25 + c * 0.7;
      this.colliders.push({
        min: new THREE.Vector3(d.x - hx, 0, d.z - hz),
        max: new THREE.Vector3(d.x + hx, 1.3, d.z + hz),
      });
    });
    meshes.castShadow = meshes.receiveShadow = true;
    this.group.add(meshes);
  }

  private buildFiresAndKiosks(): void {
    const fireBarrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.95, 14);
    const fireBarrelMat = new THREE.MeshStandardMaterial({ map: metalTex(), roughness: 0.7, metalness: 0.4, color: 0x4a4440 });
    this.layout.fires.forEach((f, i) => {
      const { object, fire } = createFire(fireBarrelGeo, fireBarrelMat, f.x, f.z, i * 13.7 + 5);
      this.group.add(object);
      this.fires.push(fire);
      this.firePositions.push(new THREE.Vector3(f.x, 1.4, f.z));
      const drum = object.children[0] as THREE.Mesh;
      this.hittables.push(drum);
      this.colliders.push({
        min: new THREE.Vector3(f.x - 0.46, 0, f.z - 0.46),
        max: new THREE.Vector3(f.x + 0.46, 1.1, f.z + 0.46),
      });
    });

    for (const k of this.layout.kiosks) {
      const register = this.addKiosk(new THREE.Vector3(k.x, 0, k.z), k.name, k.color);
      this.storePoints.push({ name: k.name, register });
    }

    const cartMat = new THREE.MeshStandardMaterial({ map: metalTex(), roughness: 0.6, metalness: 0.45, color: 0x8a4a2a });
    for (const c of this.layout.carts) {
      const cart = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.05, 0.95), cartMat);
      cart.position.set(c.x, 0.72, c.z);
      cart.castShadow = cart.receiveShadow = true;
      this.group.add(cart);
      this.hittables.push(cart);
      this.colliders.push({
        min: new THREE.Vector3(c.x - 0.85, 0, c.z - 0.5),
        max: new THREE.Vector3(c.x + 0.85, 1.24, c.z + 0.5),
      });
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.5),
        new THREE.MeshBasicMaterial({ map: this.signTex('HOT DOG $5', '#ffae4a') }),
      );
      sign.position.set(c.x, 1.85, c.z + 0.48);
      this.group.add(sign);
      this.cartPoints.push(new THREE.Vector3(c.x, 0, c.z + 1.8));
    }
  }

  /** glowing sign texture (self-lit, no real light) */
  private signTex(text: string, color: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#0a0b0d';
    ctx.fillRect(0, 0, 256, 96);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 88);
    ctx.fillStyle = color;
    ctx.font = 'bold 34px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 50);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private addKiosk(pos: THREE.Vector3, sign: string, color: string): THREE.Vector3 {
    const bodyMat = new THREE.MeshStandardMaterial({ map: metalTex(), roughness: 0.6, metalness: 0.5, color: 0x3a3f46 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.2), bodyMat);
    body.position.set(pos.x, 1.42, pos.z);
    body.castShadow = body.receiveShadow = true;
    this.group.add(body);
    this.hittables.push(body);
    this.colliders.push({
      min: new THREE.Vector3(pos.x - 1.3, 0, pos.z - 1.1),
      max: new THREE.Vector3(pos.x + 1.3, 2.72, pos.z + 1.1),
    });

    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 0.85),
      new THREE.MeshBasicMaterial({ map: this.signTex(sign, color) }),
    );
    // face toward the city centre, offset rotated with the sign
    const toCenter = new THREE.Vector3(-pos.x, 0, -pos.z);
    const yaw = toCenter.lengthSq() < 0.01 ? 0 : Math.atan2(toCenter.x, toCenter.z);
    face.rotation.y = yaw;
    face.position.set(Math.sin(yaw) * 1.11, 2.1, Math.cos(yaw) * 1.11).add(pos);
    this.group.add(face);

    // register interaction point in front of the sign
    return new THREE.Vector3(pos.x + Math.sin(yaw) * 2.2, 0, pos.z + Math.cos(yaw) * 2.2);
  }

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
