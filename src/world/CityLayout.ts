import * as THREE from 'three';

/**
 * CityLayout — pure data description of the open-world map.
 *
 * Everything about the map's shape lives here (roads, zones, building
 * plots, sidewalk slabs, alleys, prop/interactable placements) so the
 * mesh-building side (City) stays dumb and swappable. Deterministic:
 * the same seed always yields the same city.
 */

export type ZoneId = 'downtown' | 'residential' | 'slum' | 'industrial';

export interface BuildingPlot {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  zone: ZoneId;
}

export interface Slab {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface Spot {
  x: number;
  z: number;
  yaw: number;
}

export interface KioskSite {
  x: number;
  z: number;
  name: string;
  color: string;
}

export interface CityLayout {
  readonly road: number;
  readonly block: number;
  readonly pitch: number;
  readonly half: number;
  readonly roadCenters: number[];
  readonly zones: ZoneId[]; // per-block, row-major over the block grid
  readonly gridN: number; // blocks per axis
  readonly buildings: BuildingPlot[];
  readonly slabs: Slab[];
  readonly walkPoints: THREE.Vector3[];
  readonly trees: Spot[];
  readonly trashCans: Spot[];
  readonly dumpsters: Spot[];
  readonly parkingSpots: Spot[];
  readonly roadSpawns: THREE.Vector3[];
  readonly kiosks: KioskSite[];
  readonly carts: Spot[];
  readonly fires: Spot[];
}

export const ROAD = 16;
export const BLOCK = 36;
export const SIDEWALK = 4; // wide sidewalks
export const PITCH = ROAD + BLOCK; // 52

/** road centre lines: 7 roads per axis, city spans ±178 */
export const ROAD_CENTERS = [-156, -104, -52, 0, 52, 104, 156];
export const HALF = 178; // world half size (perimeter walls just beyond)

/** deterministic PRNG (mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Zone map: downtown in the centre, a slum quarter in the far north-west,
 * an industrial district in the far south-east, residential everywhere else.
 */
function zoneFor(bx: number, bz: number): ZoneId {
  if (Math.abs(bx) <= 26 && Math.abs(bz) <= 26) return 'downtown';
  if (bx <= -78 && bz >= 78) return 'slum';
  if (bx >= 78 && bz <= -78) return 'industrial';
  return 'residential';
}

/**
 * Build the whole layout. Building placement leaves the block edge band
 * (|offset| ≤ 16) and the block centre alley clear, so props placed at
 * edge midpoints / corners / centre never intersect a building.
 */
export function buildCityLayout(seed = 0x1dea): CityLayout {
  const rnd = rng(seed);
  const blockCenters: number[] = [];
  for (let i = 0; i < ROAD_CENTERS.length - 1; i++) {
    blockCenters.push((ROAD_CENTERS[i] + ROAD_CENTERS[i + 1]) / 2);
  }
  const gridN = blockCenters.length; // 6

  const zones: ZoneId[] = [];
  const buildings: BuildingPlot[] = [];
  const slabs: Slab[] = [];
  const walkPoints: THREE.Vector3[] = [];
  const trees: Spot[] = [];
  const trashCans: Spot[] = [];
  const dumpsters: Spot[] = [];
  const parkingSpots: Spot[] = [];

  // footprint stays within the 28m inner block; props live at |16| offsets
  const putSlabsAndWalks = (bx: number, bz: number): void => {
    const inner = BLOCK - SIDEWALK * 2; // 28
    const mid = inner / 2 + SIDEWALK / 2; // 16
    slabs.push(
      { x: bx, z: bz - mid, w: BLOCK, d: SIDEWALK },
      { x: bx, z: bz + mid, w: BLOCK, d: SIDEWALK },
      { x: bx - mid, z: bz, w: SIDEWALK, d: inner },
      { x: bx + mid, z: bz, w: SIDEWALK, d: inner },
    );
    for (const [x, z] of [
      [bx, bz - mid],
      [bx, bz + mid],
      [bx - mid, bz],
      [bx + mid, bz],
      [bx - mid, bz - mid],
      [bx + mid, bz - mid],
      [bx - mid, bz + mid],
      [bx + mid, bz + mid],
    ]) {
      walkPoints.push(new THREE.Vector3(x, 0, z));
    }
  };

  const edge = BLOCK / 2 + ROAD / 2 - 2.2; // roadside parking line
  for (const bx of blockCenters) {
    for (const bz of blockCenters) {
      const zone = zoneFor(bx, bz);
      zones.push(zone);
      putSlabsAndWalks(bx, bz);

      if (zone === 'downtown') {
        // one tall glass tower, sometimes with a low podium beside it
        const w = 15 + rnd() * 6;
        const d = 15 + rnd() * 6;
        const h = 26 + rnd() * 30;
        buildings.push({ x: bx + (rnd() - 0.5) * 4, z: bz + (rnd() - 0.5) * 4, w, d, h, zone });
        if (rnd() < 0.5) {
          const side = rnd() < 0.5 ? -1 : 1;
          buildings.push({
            x: bx + side * 10.5,
            z: bz + (rnd() - 0.5) * 6,
            w: 8 + rnd() * 3,
            d: 8 + rnd() * 4,
            h: 5 + rnd() * 4,
            zone,
          });
        }
      } else if (zone === 'residential') {
        // two mid-rises on the diagonal → an alley down the middle
        for (const sx of [-1, 1]) {
          buildings.push({
            x: bx + sx * 7 + (rnd() - 0.5) * 3,
            z: bz + sx * 7 + (rnd() - 0.5) * 3,
            w: 11 + rnd() * 3.5,
            d: 11 + rnd() * 3.5,
            h: 8 + rnd() * 9,
            zone,
          });
        }
        if (rnd() < 0.3) {
          buildings.push({
            x: bx + (rnd() - 0.5) * 8,
            z: bz - 13 + rnd() * 4,
            w: 6 + rnd() * 3,
            d: 5 + rnd() * 2,
            h: 4.5 + rnd() * 2.5,
            zone,
          });
        }
        dumpsters.push({ x: bx, z: bz, yaw: rnd() * Math.PI });
        for (let t = 0; t < 3; t++) {
          trees.push({ x: bx + (t % 2 === 0 ? -8 : 8), z: bz + (t < 2 ? -16 : 16), yaw: 0 });
        }
        for (let c = 0; c < 2; c++) {
          trashCans.push({ x: bx + (rnd() - 0.5) * 6, z: bz + (rnd() < 0.5 ? -1 : 1) * 15.5, yaw: 0 });
        }
      } else if (zone === 'slum') {
        // four shacks in a 2×2 with alleys between
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            buildings.push({
              x: bx + sx * 6.5 + (rnd() - 0.5) * 2.4,
              z: bz + sz * 6.5 + (rnd() - 0.5) * 2.4,
              w: 7 + rnd() * 2.2,
              d: 7 + rnd() * 2.2,
              h: 3.5 + rnd() * 3,
              zone,
            });
          }
        }
        dumpsters.push({ x: bx, z: bz, yaw: rnd() * Math.PI });
        for (let c = 0; c < 2; c++) {
          trashCans.push({ x: bx + (rnd() - 0.5) * 6, z: bz + (rnd() < 0.5 ? -1 : 1) * 15.5, yaw: 0 });
        }
        if (rnd() < 0.5) trees.push({ x: bx + (rnd() - 0.5) * 4, z: bz + 16, yaw: 0 });
      } else {
        // industrial: one or two long warehouses + a container/dumpster yard
        if (rnd() < 0.55) {
          buildings.push({
            x: bx + (rnd() - 0.5) * 3,
            z: bz - 6 + (rnd() - 0.5) * 3,
            w: 15 + rnd() * 4,
            d: 12 + rnd() * 3,
            h: 7 + rnd() * 3.5,
            zone,
          });
          buildings.push({
            x: bx + (rnd() - 0.5) * 3,
            z: bz + 9,
            w: 14 + rnd() * 4,
            d: 9 + rnd() * 2.5,
            h: 6.5 + rnd() * 3,
            zone,
          });
        } else {
          buildings.push({
            x: bx,
            z: bz + (rnd() - 0.5) * 3,
            w: 17 + rnd() * 3,
            d: 14 + rnd() * 3,
            h: 7.5 + rnd() * 3,
            zone,
          });
        }
        for (let dd = 0; dd < 2; dd++) {
          dumpsters.push({ x: bx - 14 + dd * 28, z: bz + 16, yaw: Math.PI / 2 + (rnd() - 0.5) * 0.3 });
        }
        for (let t = 0; t < 2; t++) {
          trees.push({ x: bx + (t === 0 ? -8 : 8), z: bz - 16, yaw: 0 });
        }
        trashCans.push({ x: bx + 16, z: bz + (rnd() - 0.5) * 6, yaw: 0 });
      }

      // four roadside parking spots per block (cars pick 14 at random)
      parkingSpots.push({ x: bx - 8, z: bz + edge, yaw: 0 });
      parkingSpots.push({ x: bx + 8, z: bz + edge, yaw: 0 });
      parkingSpots.push({ x: bx + edge, z: bz - 8, yaw: Math.PI / 2 });
      parkingSpots.push({ x: bx + edge, z: bz + 8, yaw: Math.PI / 2 });
    }
  }

  // alley walk points: block centres are guaranteed clear of buildings
  const alleyPoints: THREE.Vector3[] = blockCenters.flatMap((bx) =>
    blockCenters.map((bz) => new THREE.Vector3(bx, 0, bz)),
  );
  walkPoints.push(...alleyPoints);

  // police spawn points on the outer ring + mid-arms of every road
  const roadSpawns: THREE.Vector3[] = [];
  for (const c of ROAD_CENTERS) {
    roadSpawns.push(new THREE.Vector3(c, 0, -162));
    roadSpawns.push(new THREE.Vector3(c, 0, 162));
    roadSpawns.push(new THREE.Vector3(-162, 0, c));
    roadSpawns.push(new THREE.Vector3(162, 0, c));
  }

  // interactables sit at block-corner positions (always clear of buildings,
  // never overlapping each other)
  const kiosks: KioskSite[] = [
    { x: 10, z: 42, name: 'MARKET', color: '#ffd257' }, // downtown, near spawn
    { x: 147, z: -61, name: 'LIQUOR', color: '#7dff9a' }, // industrial edge
    { x: -147, z: 113, name: 'PAWN', color: '#ff8a5c' }, // slum
    { x: 95, z: 43, name: 'BODEGA', color: '#7dc4ff' }, // residential east
    { x: -43, z: -95, name: 'CHINA TOWN', color: '#ff5c7d' }, // residential south
  ];
  const carts: Spot[] = [
    { x: 42, z: 10, yaw: 0 }, // downtown
    { x: -94, z: 62, yaw: 0 }, // slum edge
    { x: 114, z: -146, yaw: 0 }, // industrial
    { x: -146, z: -62, yaw: 0 }, // residential west
  ];
  const fires: Spot[] = [
    { x: 42, z: 42, yaw: 0 }, // downtown NE
    { x: -10, z: -10, yaw: 0 }, // downtown SW
    { x: -62, z: 94, yaw: 0 }, // slum
    { x: 146, z: -114, yaw: 0 }, // industrial
    { x: 114, z: 42, yaw: 0 }, // residential east
    { x: -94, z: -94, yaw: 0 }, // residential south-west
    { x: -146, z: 42, yaw: 0 }, // residential west
    { x: 10, z: 146, yaw: 0 }, // residential north
  ];

  return {
    road: ROAD,
    block: BLOCK,
    pitch: PITCH,
    half: HALF,
    roadCenters: ROAD_CENTERS,
    zones,
    gridN,
    buildings,
    slabs,
    walkPoints,
    trees,
    trashCans,
    dumpsters,
    parkingSpots,
    roadSpawns,
    kiosks,
    carts,
    fires,
  };
}
