import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';

/**
 * Populates the 12km x 12km Combined-Arms Battlefield using real downloaded 3D models:
 * Falcon Airbase, Central Contested City, FOB Alpha, Opfor Base Bravo,
 * Destructible Buildings & Explosive Fuel Depots, and Alpine Forests/Rocks.
 */
export class BattlefieldBuilder {
  constructor(scene, assets, vfx, audio) {
    this.scene = scene;
    this.assets = assets;
    this.vfx = vfx;
    this.audio = audio;

    this.destructibles = []; // { root, pos, radius, height, hp, maxHp, explosive, destroyed, collapseAnim }
    this.staticObstacles = []; // { x, z, radius }
  }

  async buildAll(pbrTextures) {
    this._buildAirbaseSurface(pbrTextures);
    this._buildCityRoads(pbrTextures);

    await Promise.all([
      this._populateAirbase(),
      this._populateCity(),
      this._populateMilitaryBases(),
      this._populateNature(),
    ]);
  }

  _buildAirbaseSurface(tex) {
    const baseY = getTerrainHeight(-3400, -2200) + 0.12;
    const { asphaltDiff, asphaltNor, asphaltRough, concreteDiff, concreteNor, concreteRough } = tex;

    for (const t of [asphaltDiff, asphaltNor, asphaltRough]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(42, 4);
    }
    for (const t of [concreteDiff, concreteNor, concreteRough]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(16, 10);
    }

    const runwayMat = new THREE.MeshStandardMaterial({
      map: asphaltDiff,
      normalMap: asphaltNor,
      roughnessMap: asphaltRough,
      roughness: 0.82,
      metalness: 0.06,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });

    // 1650m x 52m Main Runway 09/27
    const runway = new THREE.Mesh(new THREE.PlaneGeometry(1650, 52), runwayMat);
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(-3100, baseY, -2200);
    runway.receiveShadow = true;
    this.scene.add(runway);

    // Runway Centerline & Threshold Markings (canvas texture)
    const markMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.7 });
    for (let x = -3860; x <= -2340; x += 48) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(22, 1.4), markMat);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(x, baseY + 0.04, -2200);
      stripe.receiveShadow = true;
      this.scene.add(stripe);
    }
    // Threshold piano keys
    for (let zOff = -20; zOff <= 20; zOff += 5) {
      if (Math.abs(zOff) < 3) continue;
      for (const endX of [-3905, -2295]) {
        const key = new THREE.Mesh(new THREE.PlaneGeometry(28, 2.2), markMat);
        key.rotation.x = -Math.PI / 2;
        key.position.set(endX, baseY + 0.04, -2200 + zOff);
        this.scene.add(key);
      }
    }

    // Concrete Apron & Taxiways
    const apronMat = new THREE.MeshStandardMaterial({
      map: concreteDiff,
      normalMap: concreteNor,
      roughnessMap: concreteRough,
      roughness: 0.88,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(420, 180), apronMat);
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(-3420, baseY + 0.02, -2340);
    apron.receiveShadow = true;
    this.scene.add(apron);

    // Connecting taxiways
    for (const tx of [-3600, -3200, -2500]) {
      const taxi = new THREE.Mesh(new THREE.PlaneGeometry(26, 120), runwayMat);
      taxi.rotation.x = -Math.PI / 2;
      taxi.position.set(tx, baseY + 0.01, -2260);
      taxi.receiveShadow = true;
      this.scene.add(taxi);
    }
  }

  _buildCityRoads(tex) {
    const cityY = getTerrainHeight(0, 0) + 0.14;
    const roadMat = new THREE.MeshStandardMaterial({
      map: tex.asphaltDiff,
      normalMap: tex.asphaltNor,
      roughnessMap: tex.asphaltRough,
      roughness: 0.85,
    });
    for (const offset of [-240, 0, 240]) {
      const roadNS = new THREE.Mesh(new THREE.PlaneGeometry(24, 1150), roadMat);
      roadNS.rotation.x = -Math.PI / 2;
      roadNS.position.set(offset, cityY, 0);
      roadNS.receiveShadow = true;
      this.scene.add(roadNS);

      const roadEW = new THREE.Mesh(new THREE.PlaneGeometry(1150, 24), roadMat);
      roadEW.rotation.x = -Math.PI / 2;
      roadEW.position.set(0, cityY + 0.01, offset);
      roadEW.receiveShadow = true;
      this.scene.add(roadEW);
    }
  }

  async _placeModel(url, x, z, yaw = 0, scaleMul = 1.0, { destructible = false, hp = 180, explosive = false, radius = 8 } = {}) {
    const inst = await this.assets.instantiate(url);
    const y = getTerrainHeight(x, z);
    inst.root.position.set(x, y, z);
    inst.root.rotation.y = yaw;
    if (scaleMul !== 1.0) inst.root.scale.setScalar(scaleMul);
    this.scene.add(inst.root);

    if (destructible) {
      this.destructibles.push({
        root: inst.root,
        pos: new THREE.Vector3(x, y + 6, z),
        radius,
        hp,
        maxHp: hp,
        explosive,
        destroyed: false,
        collapseTimer: 0,
      });
    }
    this.staticObstacles.push({ x, z, radius: radius * 0.75 });
    return inst.root;
  }

  async _populateAirbase() {
    const jobs = [];
    // Operations & Maintenance Hangar Structures
    jobs.push(this._placeModel('/assets/models/world/industrial_b.glb', -3520, -2420, 0, 1.5, { destructible: true, hp: 320, radius: 14 }));
    jobs.push(this._placeModel('/assets/models/world/industrial_d.glb', -3420, -2420, Math.PI / 2, 1.4, { destructible: true, hp: 320, radius: 12 }));
    jobs.push(this._placeModel('/assets/models/world/harbor_crane.glb', -3300, -2410, 0, 1.1, { destructible: true, hp: 280, radius: 12 }));
    // Control tower
    jobs.push(this._placeModel('/assets/models/world/city_6story.glb', -3620, -2380, 0, 1.2, { destructible: true, hp: 400, radius: 10 }));

    // Fuel trucks, floodlights, generators, explosive fuel barrels, barriers
    for (const fx of [-3550, -3380, -3260]) {
      jobs.push(this._placeModel('/assets/models/vehicles/fuel_truck.glb', fx, -2340, 0.3, 1.0, { destructible: true, hp: 90, explosive: true, radius: 5 }));
    }
    for (const lx of [-3700, -3450, -3200, -2950]) {
      jobs.push(this._placeModel('/assets/models/world/ph_flood_lights/flood_lights_1k.gltf', lx, -2265, Math.PI, 1.2, { destructible: false, radius: 2 }));
    }
    for (let i = 0; i < 6; i++) {
      jobs.push(this._placeModel('/assets/models/world/ph_concrete_road_barrier/concrete_road_barrier_1k.gltf', -3540 + i * 24, -2290, 0, 1.4, { radius: 2 }));
      jobs.push(this._placeModel('/assets/models/world/ph_Barrel_01/Barrel_01_1k.gltf', -3500 + i * 16, -2400, i * 0.7, 1.3, { destructible: true, hp: 35, explosive: true, radius: 3 }));
    }
    jobs.push(this._placeModel('/assets/models/world/ph_portable_generator/portable_generator_1k.gltf', -3470, -2395, 0.5, 1.4, { destructible: true, hp: 70, explosive: true, radius: 3 }));
    jobs.push(this._placeModel('/assets/models/world/ph_old_military_crate/old_military_crate_1k.gltf', -3460, -2390, 0.2, 1.4, { radius: 2 }));

    // Static parked reserve aircraft on apron
    jobs.push(this._placeModel('/assets/models/aircraft/f14.glb', -3490, -2330, 0.4, 1.0));
    jobs.push(this._placeModel('/assets/models/aircraft/uh60m.glb', -3340, -2330, -0.3, 1.0));

    await Promise.all(jobs);
  }

  async _populateCity() {
    const models = [
      '/assets/models/world/city_tower_1.glb',
      '/assets/models/world/city_tower_2.glb',
      '/assets/models/world/city_block_3.glb',
      '/assets/models/world/city_4story.glb',
      '/assets/models/world/city_6story.glb',
      '/assets/models/world/industrial_b.glb',
      '/assets/models/world/industrial_d.glb',
    ];
    const jobs = [];
    const blocks = [-420, -320, -140, -60, 60, 140, 320, 420];
    let idx = 0;
    for (const bx of blocks) {
      for (const bz of blocks) {
        if ((idx++ % 3) === 0 && Math.abs(bx) < 200 && Math.abs(bz) < 200) continue; // Keep central plaza open for tank battles
        const url = models[(Math.abs(bx + bz) + idx) % models.length];
        const yaw = ((idx % 4) * Math.PI) / 2;
        jobs.push(
          this._placeModel(url, bx + (Math.random() - 0.5) * 18, bz + (Math.random() - 0.5) * 18, yaw, 1.05, {
            destructible: true,
            hp: 260,
            radius: 16,
          })
        );
      }
    }
    await Promise.all(jobs);
  }

  async _populateMilitaryBases() {
    const bases = [
      { cx: -1250, cz: 320 },  // FOB Alpha
      { cx: 2400, cz: 1400 },  // Opfor Base Bravo
    ];
    const jobs = [];
    for (const b of bases) {
      jobs.push(this._placeModel('/assets/models/world/industrial_b.glb', b.cx - 45, b.cz - 45, 0, 1.3, { destructible: true, hp: 280, radius: 12 }));
      jobs.push(this._placeModel('/assets/models/world/industrial_d.glb', b.cx + 48, b.cz - 40, Math.PI / 2, 1.2, { destructible: true, hp: 280, radius: 11 }));
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const bx = b.cx + Math.cos(ang) * 90;
        const bz = b.cz + Math.sin(ang) * 90;
        jobs.push(this._placeModel('/assets/models/world/ph_concrete_road_barrier/concrete_road_barrier_1k.gltf', bx, bz, -ang + Math.PI / 2, 1.6, { radius: 2.5 }));
        jobs.push(this._placeModel('/assets/models/world/ph_Barrel_01/Barrel_01_1k.gltf', b.cx + Math.cos(ang + 0.2) * 35, b.cz + Math.sin(ang + 0.2) * 35, i, 1.4, { destructible: true, hp: 30, explosive: true, radius: 3 }));
      }
      jobs.push(this._placeModel('/assets/models/world/ph_flood_lights/flood_lights_1k.gltf', b.cx - 65, b.cz + 65, 0.8, 1.3, { radius: 2 }));
      jobs.push(this._placeModel('/assets/models/world/ph_portable_generator/portable_generator_1k.gltf', b.cx + 30, b.cz + 45, 0.2, 1.3, { destructible: true, hp: 60, explosive: true, radius: 3 }));
      jobs.push(this._placeModel('/assets/models/world/ph_ammo_box/ammo_box_1k.gltf', b.cx + 22, b.cz + 40, 0.4, 2.2, { radius: 1.5 }));
    }
    await Promise.all(jobs);
  }

  async _populateNature() {
    const jobs = [];
    for (let i = 0; i < 95; i++) {
      const x = (Math.random() - 0.5) * 6800;
      const z = (Math.random() - 0.5) * 6800;
      // Keep out of airbase runway, city core, and FOBs
      if (Math.abs(x + 3100) < 1050 && Math.abs(z + 2200) < 420) continue;
      if (Math.hypot(x, z) < 620) continue;
      if (Math.hypot(x + 1250, z - 320) < 220) continue;
      if (Math.hypot(x - 2400, z - 1400) < 240) continue;

      const y = getTerrainHeight(x, z);
      if (y > 390) continue; // Above timberline

      const url = i % 3 === 0 ? '/assets/models/world/common_tree.glb' : '/assets/models/world/pine_tree.glb';
      jobs.push(this._placeModel(url, x, z, Math.random() * Math.PI * 2, 0.9 + Math.random() * 0.7, { radius: 2.5 }));
    }

    for (let i = 0; i < 32; i++) {
      const x = (Math.random() - 0.5) * 6800;
      const z = (Math.random() - 0.5) * 6800;
      if (Math.abs(x + 3100) < 1050 && Math.abs(z + 2200) < 420) continue;
      const url = i % 2 === 0 ? '/assets/models/world/ph_boulder_01/boulder_01_1k.gltf' : '/assets/models/world/rock_1.glb';
      jobs.push(this._placeModel(url, x, z, Math.random() * Math.PI * 2, 1.0 + Math.random() * 1.4, { radius: 4 }));
    }
    await Promise.all(jobs);
  }

  damageStructureAt(hitPos, blastRadius, dmg) {
    for (const d of this.destructibles) {
      if (d.destroyed) continue;
      const dist = d.pos.distanceTo(hitPos);
      if (dist <= blastRadius + d.radius) {
        d.hp -= dmg * Math.max(0.25, 1.0 - dist / (blastRadius + d.radius));
        if (d.hp <= 0) {
          d.destroyed = true;
          d.collapseTimer = 2.2;
          const expScale = d.explosive ? 2.4 : 3.2;
          this.vfx.spawnExplosion(d.pos, expScale, true);
          this.vfx.addPersistentWreckFire(new THREE.Vector3(d.pos.x, getTerrainHeight(d.pos.x, d.pos.z), d.pos.z), 25);
          this.audio.playExplosion(d.pos, true);
        }
      }
    }
  }

  update(dt) {
    for (const d of this.destructibles) {
      if (d.destroyed && d.collapseTimer > 0) {
        d.collapseTimer = Math.max(0, d.collapseTimer - dt);
        d.root.position.y -= 9.5 * dt;
        d.root.rotation.x += 0.22 * dt;
        d.root.rotation.z += 0.14 * dt;
      }
    }
  }
}
