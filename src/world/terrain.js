import * as THREE from 'three';

function hash2(ix, iz) {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);

  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm(x, z, octaves = 5) {
  let val = 0;
  let amp = 0.5;
  let freq = 1.0;
  for (let i = 0; i < octaves; i++) {
    val += amp * valueNoise(x * freq, z * freq);
    freq *= 2.04;
    amp *= 0.5;
  }
  return val;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export const MAP_SIZE = 12000;

/**
 * Deterministic heightfield for the 12x12km Combined-Arms Theatre.
 * Sculpted flat zones for Falcon Airbase, Central City, FOB Alpha, and Opfor Base Bravo,
 * surrounded by dramatic mountain ridges and canyon passes.
 */
export function getTerrainHeight(x, z) {
  // Base rolling terrain & dramatic mountain ridges
  const n1 = fbm(x * 0.00045 + 11.3, z * 0.00045 + 7.1, 5);
  const ridge = 1.0 - Math.abs(fbm(x * 0.00032 - 3.7, z * 0.00032 + 19.4, 4) * 2.0 - 1.0);
  let h = n1 * 180 + Math.pow(ridge, 2.2) * 580;

  // River/valley floor corridor along central diagonal
  const valleyDist = Math.abs(z - x * 0.25) / 1450;
  const valleyMask = smoothstep(0.15, 1.35, valleyDist);
  h *= 0.14 + 0.86 * valleyMask;

  // Flatten key tactical zones smoothly:
  // 1. Falcon Airbase (-3400, -2200) -> flat plateau at y = 18m
  const airbaseDist = Math.hypot((x + 3400) / 1350, (z + 2200) / 700);
  const airbaseFlat = 1.0 - smoothstep(0.65, 1.25, airbaseDist);
  h = THREE.MathUtils.lerp(h, 18, airbaseFlat);

  // 2. Central Contested City (0, 0) -> flat basin at y = 14m
  const cityDist = Math.hypot(x / 850, z / 850);
  const cityFlat = 1.0 - smoothstep(0.55, 1.2, cityDist);
  h = THREE.MathUtils.lerp(h, 14, cityFlat);

  // 3. FOB Alpha (-1250, 320) -> y = 16m
  const fobDist = Math.hypot((x + 1250) / 480, (z - 320) / 480);
  const fobFlat = 1.0 - smoothstep(0.5, 1.15, fobDist);
  h = THREE.MathUtils.lerp(h, 16, fobFlat);

  // 4. Opfor Forward Base (2400, 1400) -> y = 20m
  const opforDist = Math.hypot((x - 2400) / 560, (z - 1400) / 560);
  const opforFlat = 1.0 - smoothstep(0.5, 1.15, opforDist);
  h = THREE.MathUtils.lerp(h, 20, opforFlat);

  return Math.max(4, h);
}

export function getTerrainNormal(x, z, out = new THREE.Vector3()) {
  const eps = 3.0;
  const hL = getTerrainHeight(x - eps, z);
  const hR = getTerrainHeight(x + eps, z);
  const hD = getTerrainHeight(x, z - eps);
  const hU = getTerrainHeight(x, z + eps);
  return out.set(hL - hR, 2 * eps, hD - hU).normalize();
}

export function buildTerrainMesh(textures) {
  const segs = 260;
  const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = getTerrainHeight(x, z);
    pos.setY(i, y);

    // Slope & altitude vertex coloring to drive rock/grass/snow transitions
    const n = getTerrainNormal(x, z);
    const slope = 1.0 - n.y; // 0 flat, 1 vertical
    const snow = smoothstep(420, 620, y);
    const rock = smoothstep(0.11, 0.34, slope);

    // Base grass tint -> dry rock -> alpine snow
    let r = THREE.MathUtils.lerp(0.68, 0.45, rock);
    let g = THREE.MathUtils.lerp(0.74, 0.44, rock);
    let b = THREE.MathUtils.lerp(0.58, 0.41, rock);

    r = THREE.MathUtils.lerp(r, 0.94, snow);
    g = THREE.MathUtils.lerp(g, 0.96, snow);
    b = THREE.MathUtils.lerp(b, 1.0, snow);

    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const { grassDiff, grassNor, grassRough } = textures;
  for (const t of [grassDiff, grassNor, grassRough]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(95, 95);
  }

  const mat = new THREE.MeshStandardMaterial({
    map: grassDiff,
    normalMap: grassNor,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: grassRough,
    roughness: 0.92,
    metalness: 0.02,
    vertexColors: true,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

export function buildVolumetricClouds(scene, smokeTex) {
  const cloudGroup = new THREE.Group();
  const cloudCount = 65;

  for (let i = 0; i < cloudCount; i++) {
    const cluster = new THREE.Group();
    const cx = (Math.random() - 0.5) * 9500;
    const cz = (Math.random() - 0.5) * 9500;
    const cy = 620 + Math.random() * 520;
    cluster.position.set(cx, cy, cz);

    const puffs = 4 + Math.floor(Math.random() * 4);
    for (let p = 0; p < puffs; p++) {
      const mat = new THREE.SpriteMaterial({
        map: smokeTex,
        color: 0xf1f5f9,
        transparent: true,
        opacity: 0.28 + Math.random() * 0.14,
        depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set(
        (Math.random() - 0.5) * 320,
        (Math.random() - 0.5) * 48,
        (Math.random() - 0.5) * 260
      );
      const sx = 280 + Math.random() * 360;
      const sy = 110 + Math.random() * 140;
      sp.scale.set(sx, sy, 1);
      mat.rotation = Math.random() * Math.PI * 2;
      cluster.add(sp);
    }
    cloudGroup.add(cluster);
  }

  scene.add(cloudGroup);
  return cloudGroup;
}
