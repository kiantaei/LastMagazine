import * as THREE from 'three';
import { createFire, type Fire } from './Fire';

export interface Collider {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/** Deterministic PRNG so the city layout is identical on every load. */
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

/** dark facade with a scatter of faintly lit windows (emissive, no real light) */
const facadeTex = () =>
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
        if (lit < 0.14) ctx.fillStyle = 'rgba(220,190,120,0.85)'; // warm lit window
        else if (lit < 0.2) ctx.fillStyle = 'rgba(140,170,210,0.55)'; // cold TV glow
        else ctx.fillStyle = 'rgba(8,9,11,0.95)'; // dark glass
        ctx.fillRect(x, y, w, h);
      }
    }
  });

const ROAD = 16; // road width
const BLOCK = 36; // building block width
const PITCH = ROAD + BLOCK; // 52
/** road centre-line coordinates */
const ROAD_CENTERS = [-78, -26, 26, 78];
const HALF = 86; // world half size (perimeter walls)

export interface ParkingSpot {
  pos: THREE.Vector3;
  yaw: number;
}

/**
 * Night city: road grid with sidewalks, dark high-rise blocks, alley fires,
 * dumpsters and perimeter walls. Lit only by the weapon light, muzzle flash
 * and the burning barrels; building windows are emissive paint, not lamps.
 */
export class City {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly hittables: THREE.Object3D[] = [];
  readonly fires: Fire[] = [];
  readonly firePositions: THREE.Vector3[] = [];
  readonly parkingSpots: ParkingSpot[] = [];
  /** sidewalk waypoints for civilian wandering */
  readonly walkPoints: THREE.Vector3[] = [];
  /** roadside points for police spawns */
  readonly roadSpawnPoints: THREE.Vector3[] = [];
  readonly playerStart = new THREE.Vector3(27, 0, 21);

  constructor() {
    this.buildSky();
    this.buildGround();
    this.buildRoads();
    this.buildBlocks();
    this.buildPerimeter();
    this.buildFiresAndProps();
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
    // one dark plane under everything; roads/sidewalks sit on top
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2, HALF * 2),
      new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.96, metalness: 0.04 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.hittables.push(ground);
  }

  private buildRoads(): void {
    const tex = asphaltTex(2, true);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.06 });
    for (const c of ROAD_CENTERS) {
      // N-S road strip
      const ns = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, HALF * 2), mat);
      ns.rotation.x = -Math.PI / 2;
      ns.position.set(c, 0, 0);
      ns.receiveShadow = true;
      this.group.add(ns);
      this.hittables.push(ns);
      // E-W road strip
      const ew = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, ROAD), mat);
      ew.rotation.x = -Math.PI / 2;
      ew.position.set(0, 0, c);
      ew.receiveShadow = true;
      this.group.add(ew);
      this.hittables.push(ew);
    }
  }

  // ------------------------------------------------------------------ blocks
  private buildBlocks(): void {
    const sidewalkMat = new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.94, metalness: 0.04 });
    const facade = facadeTex();
    const concrete = new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.9 });
    const metal = new THREE.MeshStandardMaterial({ map: metalTex(), roughness: 0.55, metalness: 0.6 });
    const rnd = mulberry32(0x9e3779b9);

    const blockCenters = [-52, 0, 52];
    for (const bx of blockCenters) {
      for (const bz of blockCenters) {
        // sidewalk slab ring around the block (2m wide, 0.12m high)
        const sw = 2;
        const inner = BLOCK - sw * 2;
        const slabs: Array<[number, number, number, number]> = [
          [bx, bz - inner / 2 - sw / 2, BLOCK, sw],
          [bx, bz + inner / 2 + sw / 2, BLOCK, sw],
          [bx - inner / 2 - sw / 2, bz, sw, inner],
          [bx + inner / 2 + sw / 2, bz, sw, inner],
        ];
        for (const [x, z, w, d] of slabs) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), sidewalkMat);
          m.position.set(x, 0.06, z);
          m.receiveShadow = true;
          this.group.add(m);
          this.walkPoints.push(new THREE.Vector3(x, 0, z));
        }
        // corner walk points too
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          this.walkPoints.push(
            new THREE.Vector3(bx + dx * (BLOCK / 2 - sw / 2), 0, bz + dz * (BLOCK / 2 - sw / 2)),
          );
        }

        // buildings: 1-2 towers per block, always inside the sidewalk ring
        const towerCount = rnd() < 0.55 ? 2 : 1;
        for (let t = 0; t < towerCount; t++) {
          const w = 10 + rnd() * 6;
          const d = 10 + rnd() * 6;
          const h = 9 + rnd() * 14;
          // footprint + half-size must stay inside the 32m inner block
          const px = towerCount === 1 ? bx + (rnd() - 0.5) * 6 : bx + (t === 0 ? -7.5 : 7.5);
          const pz = towerCount === 1 ? bz + (rnd() - 0.5) * 6 : bz + (rnd() - 0.5) * 10;
          const facadeMat = new THREE.MeshStandardMaterial({
            map: facade.clone(),
            emissiveMap: facade.clone(),
            emissive: new THREE.Color(0x9a8a68),
            emissiveIntensity: 0.5,
            roughness: 0.88,
            metalness: 0.08,
            color: 0x5a616c,
          });
          (facadeMat.map as THREE.Texture).repeat.set(Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(h / 7)));
          (facadeMat.emissiveMap as THREE.Texture).repeat.set(Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(h / 7)));
          const roofMat = rnd() < 0.5 ? concrete : metal;
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [facadeMat, facadeMat, roofMat, roofMat, facadeMat, facadeMat]);
          mesh.position.set(px, h / 2 + 0.12, pz);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.group.add(mesh);
          this.hittables.push(mesh);
          const half = new THREE.Vector3(w / 2, h / 2, d / 2);
          this.colliders.push({
            min: new THREE.Vector3(px - half.x, 0.12, pz - half.z),
            max: new THREE.Vector3(px + half.x, h + 0.12, pz + half.z),
          });
        }

        // roadside parking: 2 spots per block edge facing the road
        const edge = BLOCK / 2 + ROAD / 2 - 2.2;
        this.parkingSpots.push({ pos: new THREE.Vector3(bx - 8, 0, bz + edge), yaw: 0 });
        this.parkingSpots.push({ pos: new THREE.Vector3(bx + 8, 0, bz + edge), yaw: 0 });
        this.parkingSpots.push({ pos: new THREE.Vector3(bx + edge, 0, bz - 8), yaw: Math.PI / 2 });
        this.parkingSpots.push({ pos: new THREE.Vector3(bx + edge, 0, bz + 8), yaw: Math.PI / 2 });
      }
    }
  }

  private buildPerimeter(): void {
    const wallMat = new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.9, metalness: 0.05 });
    const walls: Array<[number, number, number, number, number, number]> = [
      [0, 5, -HALF, HALF * 2, 10, 1.4],
      [0, 5, HALF, HALF * 2, 10, 1.4],
      [-HALF, 5, 0, 1.4, 10, HALF * 2],
      [HALF, 5, 0, 1.4, 10, HALF * 2],
    ];
    for (const [x, y, z, w, h, d] of walls) {
      this.addBox(wallMat, w, h, d, new THREE.Vector3(x, y, z));
    }
  }

  private buildFiresAndProps(): void {
    const fireBarrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.95, 14);
    const fireBarrelMat = new THREE.MeshStandardMaterial({ map: metalTex(), roughness: 0.7, metalness: 0.4, color: 0x4a4440 });
    const metal = new THREE.MeshStandardMaterial({ map: metalTex(), roughness: 0.55, metalness: 0.6 });
    const spots: Array<[number, number]> = [
      [-14, 15],
      [16, -13],
      [-40, -40],
      [44, 38],
      [-58, 44],
      [58, -60],
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

    // dumpsters (alley cover)
    for (const [x, z, ry] of [
      [-20, -18, 0.2],
      [12, 26, -0.15],
      [-64, 8, Math.PI / 2],
      [40, 56, 0.1],
      [66, 24, -0.1],
    ] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 1.3), metal);
      m.position.set(x, 0.65, z);
      m.rotation.y = ry;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      this.hittables.push(m);
      const wide = Math.abs(ry) < 0.5;
      this.colliders.push({
        min: new THREE.Vector3(x - (wide ? 1.25 : 0.7), 0, z - (wide ? 0.7 : 1.25)),
        max: new THREE.Vector3(x + (wide ? 1.25 : 0.7), 1.3, z + (wide ? 0.7 : 1.25)),
      });
    }
  }

  private buildPoints(): void {
    // police spawn points: on the outer roads, away from the centre
    for (const c of ROAD_CENTERS) {
      this.roadSpawnPoints.push(new THREE.Vector3(c, 0, -70));
      this.roadSpawnPoints.push(new THREE.Vector3(c, 0, 70));
      this.roadSpawnPoints.push(new THREE.Vector3(-70, 0, c));
      this.roadSpawnPoints.push(new THREE.Vector3(70, 0, c));
    }
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
