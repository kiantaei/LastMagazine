import * as THREE from 'three';
import { getTerrainHeight, getTerrainNormal } from '../world/terrain.js';

/**
 * Combined-Arms AI Manager
 * Coordinates AI Fighter Jets, Attack Helicopters, Main Battle Tanks/AA, and Animated Infantry Squads.
 */
export class CombinedArmsAI {
  constructor(scene, assets, weapons, vfx, audio) {
    this.scene = scene;
    this.assets = assets;
    this.weapons = weapons;
    this.vfx = vfx;
    this.audio = audio;

    this.units = []; // Active & wrecked AI units
    this.mixers = [];
    this.nextId = 1;
    this.kills = 0;
    this.onEvent = null;
  }

  clearAll() {
    for (const u of this.units) {
      this.scene.remove(u.root);
    }
    this.units = [];
    this.mixers = [];
  }

  async spawnBattle(mission) {
    this.clearAll();
    const jobs = [];

    // Opfor Jets
    const opforJets = [
      { url: '/assets/models/aircraft/su27.glb', name: 'Su-27 Flanker' },
      { url: '/assets/models/aircraft/j11b.glb', name: 'J-11B Flanker' },
      { url: '/assets/models/aircraft/su57.glb', name: 'Su-57 Felon' },
    ];
    for (let i = 0; i < mission.enemyJets; i++) {
      const spec = opforJets[i % opforJets.length];
      jobs.push(this._spawnAircraft({
        name: `${spec.name} [${i + 1}]`,
        url: spec.url,
        team: 'red',
        category: 'jet',
        pos: new THREE.Vector3(1400 + i * 380, 620 + (i % 3) * 140, -1200 + i * 420),
        hp: 150,
        hitRadius: 11,
      }));
    }

    // Bluefor Ally Jets
    for (let i = 0; i < mission.allyJets; i++) {
      jobs.push(this._spawnAircraft({
        name: `Viper Wingman ${i + 1}`,
        url: i % 2 === 0 ? '/assets/models/aircraft/f16.glb' : '/assets/models/aircraft/f22.glb',
        team: 'blue',
        category: 'jet',
        pos: new THREE.Vector3(-2800 + i * 280, 520 + i * 80, -1900 + i * 240),
        hp: 160,
        hitRadius: 10,
      }));
    }

    // Opfor Attack Helicopters
    for (let i = 0; i < mission.enemyHelis; i++) {
      jobs.push(this._spawnAircraft({
        name: `AH-1W Super Cobra ${i + 1}`,
        url: '/assets/models/aircraft/ah1w.glb',
        team: 'red',
        category: 'heli',
        pos: new THREE.Vector3(600 + i * 320, 145, 500 + (i % 2) * 350),
        hp: 140,
        hitRadius: 8,
      }));
    }

    // Opfor Tanks & Mobile AA
    for (let i = 0; i < mission.enemyTanks; i++) {
      const isAA = i % 3 === 2;
      const url = isAA
        ? '/assets/models/vehicles/tank_aa.glb'
        : i % 2 === 0
          ? '/assets/models/vehicles/tank_heavy.glb'
          : '/assets/models/vehicles/tank_ifv.glb';
      const ang = (i / Math.max(1, mission.enemyTanks)) * Math.PI * 1.4;
      const x = 350 + Math.cos(ang) * 450 + (i % 2) * 180;
      const z = 120 + Math.sin(ang) * 420;
      jobs.push(this._spawnTank({
        name: isAA ? `ZSU-AA Battery ${i + 1}` : `Opfor Armor ${i + 1}`,
        url,
        team: 'red',
        isAA,
        pos: new THREE.Vector3(x, getTerrainHeight(x, z), z),
        hp: isAA ? 210 : 340,
        hitRadius: 5.5,
      }));
    }

    // Bluefor Ally Tanks
    for (let i = 0; i < mission.allyTanks; i++) {
      const x = -1150 + (i % 3) * 75;
      const z = 250 + Math.floor(i / 3) * 90;
      jobs.push(this._spawnTank({
        name: `Sabre Armor ${i + 1}`,
        url: '/assets/models/vehicles/abrams.glb',
        team: 'blue',
        isAA: false,
        pos: new THREE.Vector3(x, getTerrainHeight(x, z), z),
        hp: 380,
        hitRadius: 5.5,
      }));
    }

    // Opfor & Bluefor Infantry Squads
    for (let i = 0; i < mission.enemyInfantry; i++) {
      const cx = i % 2 === 0 ? 180 : 2350;
      const cz = i % 2 === 0 ? 80 : 1380;
      const x = cx + (Math.random() - 0.5) * 260;
      const z = cz + (Math.random() - 0.5) * 260;
      jobs.push(this._spawnSoldier({
        name: `Opfor Rifleman ${i + 1}`,
        url: i % 2 === 0 ? '/assets/models/units/soldier_animated.glb' : '/assets/models/units/swat.glb',
        team: 'red',
        pos: new THREE.Vector3(x, getTerrainHeight(x, z), z),
      }));
    }

    for (let i = 0; i < mission.allyInfantry; i++) {
      const x = -1240 + (Math.random() - 0.5) * 180;
      const z = 320 + (Math.random() - 0.5) * 180;
      jobs.push(this._spawnSoldier({
        name: `Allied Rifleman ${i + 1}`,
        url: '/assets/models/units/soldier_animated.glb',
        team: 'blue',
        pos: new THREE.Vector3(x, getTerrainHeight(x, z), z),
      }));
    }

    await Promise.all(jobs);
  }

  async _spawnAircraft({ name, url, team, category, pos, hp, hitRadius }) {
    const inst = await this.assets.instantiate(url);
    inst.root.position.copy(pos);
    this.scene.add(inst.root);

    const heading = team === 'red' ? Math.PI * 0.75 : -Math.PI * 0.25;
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, heading, 0, 'YXZ'));
    const speed = category === 'jet' ? 195 : 42;

    this.units.push({
      id: `ai_${this.nextId++}`,
      name,
      team,
      category,
      root: inst.root,
      rotorMain: inst.rotorMain,
      rotorTail: inst.rotorTail,
      pos: pos.clone(),
      quat,
      vel: new THREE.Vector3(0, 0, -1).applyQuaternion(quat).multiplyScalar(speed),
      speed,
      hp,
      maxHp: hp,
      hitRadius,
      alive: true,
      crashing: false,
      crashTimer: 0,
      fireCooldown: 1.5 + Math.random() * 2.5,
      missileCooldown: 6 + Math.random() * 6,
      flybyCooldown: 0,
      smokeTimer: 0,
      waypoint: new THREE.Vector3((Math.random() - 0.5) * 3200, pos.y, (Math.random() - 0.5) * 3200),
    });
  }

  async _spawnTank({ name, url, team, isAA, pos, hp, hitRadius }) {
    const inst = await this.assets.instantiate(url);
    inst.root.position.copy(pos);
    this.scene.add(inst.root);

    const heading = team === 'red' ? Math.PI * 0.85 : -Math.PI * 0.15;
    this.units.push({
      id: `ai_${this.nextId++}`,
      name,
      team,
      category: 'tank',
      isAA,
      root: inst.root,
      turretPivot: inst.turretPivot,
      gunPivot: inst.gunPivot,
      pos: pos.clone(),
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, heading, 0)),
      vel: new THREE.Vector3(),
      heading,
      turretYaw: heading,
      hp,
      maxHp: hp,
      hitRadius,
      alive: true,
      specs: { frontArmorMm: isAA ? 120 : 480, sideArmorMm: isAA ? 60 : 160, rearArmorMm: 50 },
      fireCooldown: 2 + Math.random() * 3,
      waypoint: new THREE.Vector3((Math.random() - 0.5) * 900, 0, (Math.random() - 0.5) * 900),
    });
  }

  async _spawnSoldier({ name, url, team, pos }) {
    const inst = await this.assets.instantiate(url);
    inst.root.position.copy(pos);
    this.scene.add(inst.root);

    let mixer = null;
    if (inst.animations.length > 0) {
      mixer = new THREE.AnimationMixer(inst.clone);
      const walkClip = inst.animations.find((a) => /walk|run/i.test(a.name)) || inst.animations[0];
      if (walkClip) {
        const action = mixer.clipAction(walkClip);
        action.timeScale = 0.8 + Math.random() * 0.4;
        action.play();
      }
      this.mixers.push(mixer);
    }

    this.units.push({
      id: `ai_${this.nextId++}`,
      name,
      team,
      category: 'infantry',
      root: inst.root,
      mixer,
      pos: pos.clone(),
      quat: new THREE.Quaternion(),
      vel: new THREE.Vector3(),
      heading: Math.random() * Math.PI * 2,
      hp: 55,
      maxHp: 55,
      hitRadius: 2.2,
      alive: true,
      fireCooldown: 1.5 + Math.random() * 2.5,
      waypoint: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 140, 0, (Math.random() - 0.5) * 140)),
    });
  }

  damageUnit(unit, dmg, attackerId) {
    if (!unit.alive) return;
    unit.hp -= dmg;
    if (unit.hp <= 0) {
      unit.hp = 0;
      unit.alive = false;

      if (attackerId === 'player') {
        this.kills++;
        if (this.onEvent) this.onEvent(`TARGET DESTROYED: ${unit.name.toUpperCase()}`);
      }

      if (unit.category === 'jet' || unit.category === 'heli') {
        unit.crashing = true;
        unit.crashTimer = 3.2;
        this.vfx.spawnExplosion(unit.pos, 2.0, true);
        this.audio.playExplosion(unit.pos, true);
      } else {
        this.vfx.spawnExplosion(unit.pos, unit.category === 'tank' ? 2.4 : 0.7, unit.category === 'tank');
        this.audio.playExplosion(unit.pos, unit.category === 'tank');
        if (unit.category === 'tank') {
          this.vfx.addPersistentWreckFire(unit.pos, 28);
          // Darken destroyed tank hull
          unit.root.traverse((o) => {
            if (o.isMesh && o.material) {
              o.material = o.material.clone();
              o.material.color.setHex(0x1f2124);
            }
          });
        } else {
          unit.root.rotation.x = Math.PI / 2;
        }
      }
    }
  }

  update(dt, playerUnit) {
    for (const m of this.mixers) m.update(dt);

    const allCombatants = playerUnit ? [playerUnit, ...this.units] : this.units;

    for (const u of this.units) {
      // Crashing aircraft spiral down in flames
      if (u.crashing) {
        u.crashTimer -= dt;
        u.vel.y -= 28 * dt;
        u.pos.addScaledVector(u.vel, dt);
        u.root.position.copy(u.pos);
        u.root.rotation.z += 3.2 * dt;
        u.root.rotation.x += 0.9 * dt;
        u.smokeTimer -= dt;
        if (u.smokeTimer <= 0) {
          u.smokeTimer = 0.05;
          this.vfx.spawnSmokePuff(u.pos, 4.5, 0x202224, 2.4);
        }
        const gY = getTerrainHeight(u.pos.x, u.pos.z);
        if (u.pos.y <= gY || u.crashTimer <= 0) {
          u.crashing = false;
          u.pos.y = gY;
          this.vfx.spawnExplosion(u.pos, 3.2, true);
          this.vfx.addPersistentWreckFire(u.pos, 24);
          this.audio.playExplosion(u.pos, true);
          u.root.visible = false;
        }
        continue;
      }

      if (!u.alive) continue;

      // Nearest opposing target
      let target = null;
      let bestDist = Infinity;
      for (const other of allCombatants) {
        if (!other.alive || other.team === u.team) continue;
        // Ground tanks prioritize ground targets unless AA
        if (u.category === 'tank' && !u.isAA && other.category === 'jet' && other.pos.y > 240) continue;
        const d = u.pos.distanceTo(other.pos);
        if (d < bestDist) {
          bestDist = d;
          target = other;
        }
      }

      if (u.category === 'jet' || u.category === 'heli') {
        this._updateAirAI(u, dt, target, bestDist, playerUnit);
      } else if (u.category === 'tank') {
        this._updateTankAI(u, dt, target, bestDist);
      } else if (u.category === 'infantry') {
        this._updateInfantryAI(u, dt, target, bestDist);
      }
    }
  }

  _updateAirAI(u, dt, target, dist, playerUnit) {
    if (u.rotorMain) u.rotorMain.rotation.y += 22 * dt;
    if (u.rotorTail) u.rotorTail.rotation.x += 26 * dt;

    if (u.flybyCooldown > 0) u.flybyCooldown -= dt;
    if (playerUnit && u.category === 'jet' && u.pos.distanceTo(playerUnit.pos) < 280 && u.flybyCooldown <= 0) {
      u.flybyCooldown = 7.0;
      this.audio.playJetFlyby(u.pos);
    }

    const goal = target ? target.pos.clone() : u.waypoint;
    if (u.category === 'jet') {
      goal.y = Math.max(goal.y + 80, getTerrainHeight(goal.x, goal.z) + 280);
    } else {
      goal.y = getTerrainHeight(u.pos.x, u.pos.z) + 95;
    }

    const toGoal = goal.sub(u.pos);
    const goalDist = toGoal.length();
    if (!target && goalDist < 220) {
      u.waypoint.set((Math.random() - 0.5) * 4500, 480 + Math.random() * 450, (Math.random() - 0.5) * 4500);
    }

    const desiredDir = toGoal.normalize();
    // Terrain avoidance pull-up
    const groundAhead = getTerrainHeight(u.pos.x + u.vel.x * 1.4, u.pos.z + u.vel.z * 1.4);
    const minSafeY = groundAhead + (u.category === 'jet' ? 190 : 65);
    if (u.pos.y < minSafeY) {
      desiredDir.y = Math.max(desiredDir.y, 0.55);
      desiredDir.normalize();
    }

    const targetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), desiredDir);
    const turnSpeed = u.category === 'jet' ? 1.15 : 1.35;
    u.quat.rotateTowards(targetQuat, turnSpeed * dt);

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(u.quat);
    u.vel.copy(fwd).multiplyScalar(u.speed);
    u.pos.addScaledVector(u.vel, dt);

    u.root.position.copy(u.pos);
    u.root.quaternion.copy(u.quat);

    // Smoke if heavily damaged
    if (u.hp < u.maxHp * 0.45) {
      u.smokeTimer -= dt;
      if (u.smokeTimer <= 0) {
        u.smokeTimer = 0.08;
        this.vfx.spawnSmokePuff(u.pos, 3.4, 0x26282a, 1.9);
      }
    }

    // Fire at target when lined up
    u.fireCooldown -= dt;
    u.missileCooldown -= dt;
    if (target && dist < 1700) {
      const aimDir = target.pos.clone().sub(u.pos).normalize();
      const align = fwd.dot(aimDir);
      if (align > 0.94 && u.fireCooldown <= 0) {
        u.fireCooldown = 0.22;
        const bulletVel = fwd.clone().multiplyScalar(820).addScaledVector(new THREE.Vector3((Math.random() - 0.5) * 28, (Math.random() - 0.5) * 28, (Math.random() - 0.5) * 28), 1);
        this.weapons.spawnBullet(u.pos.clone().addScaledVector(fwd, 10), bulletVel, {
          ownerId: u.id,
          team: u.team,
          dmg: 14,
          armorPenMm: 35,
        });
      }
      if (u.category === 'jet' && align > 0.9 && dist > 420 && dist < 2400 && u.missileCooldown <= 0) {
        u.missileCooldown = 11 + Math.random() * 6;
        this.weapons.spawnMissile(u.pos.clone().addScaledVector(fwd, 6), u.quat, u.vel, {
          ownerId: u.id,
          team: u.team,
          target,
          type: 'aim9',
        });
        if (playerUnit && target.id === playerUnit.id) {
          this.audio.playRWRAlert();
          if (this.onEvent) this.onEvent('WARNING: MISSILE LAUNCH DETECTED [DEPLOY FLARES: X]');
        }
      }
    }
  }

  _updateTankAI(u, dt, target, dist) {
    const goal = target && dist < 1400 ? target.pos : u.waypoint;
    const dx = goal.x - u.pos.x;
    const dz = goal.z - u.pos.z;
    const dGoal = Math.hypot(dx, dz);

    if (!target && dGoal < 45) {
      u.waypoint.set((Math.random() - 0.5) * 1600, 0, (Math.random() - 0.5) * 1600);
    }

    const desiredMove = target && dist < 260 ? false : dGoal > 25;
    if (desiredMove) {
      const desiredHeading = Math.atan2(-dx, -dz);
      u.heading = this._lerpAngle(u.heading, desiredHeading, 1 - Math.exp(-1.2 * dt));
      const spd = u.isAA ? 10.5 : 8.2;
      u.pos.x += -Math.sin(u.heading) * spd * dt;
      u.pos.z += -Math.cos(u.heading) * spd * dt;
    }

    u.pos.y = getTerrainHeight(u.pos.x, u.pos.z);
    const n = getTerrainNormal(u.pos.x, u.pos.z);
    const fwd = new THREE.Vector3(-Math.sin(u.heading), 0, -Math.cos(u.heading));
    const right = new THREE.Vector3().crossVectors(fwd, n).normalize();
    const alignedFwd = new THREE.Vector3().crossVectors(n, right).normalize();
    const m = new THREE.Matrix4().makeBasis(right, n, alignedFwd.clone().negate());
    u.quat.setFromRotationMatrix(m);

    u.root.position.copy(u.pos);
    u.root.quaternion.copy(u.quat);

    // Rotate independent turret toward target
    if (target) {
      const worldTargetYaw = Math.atan2(-(target.pos.x - u.pos.x), -(target.pos.z - u.pos.z));
      u.turretYaw = this._lerpAngle(u.turretYaw, worldTargetYaw, 1 - Math.exp(-1.5 * dt));
      if (u.turretPivot) {
        // Local turret yaw relative to hull
        u.turretPivot.rotation.y = u.turretYaw - u.heading;
      }

      u.fireCooldown -= dt;
      if (u.fireCooldown <= 0 && dist < (u.isAA ? 1500 : 1100)) {
        u.fireCooldown = u.isAA ? 0.24 : 5.2 + Math.random() * 2.5;
        const muzzlePos = u.pos.clone().add(new THREE.Vector3(0, 2.4, 0));
        const aimVec = target.pos.clone().add(new THREE.Vector3(0, target.category === 'tank' ? 1.5 : 0, 0)).sub(muzzlePos);
        const targetDist = aimVec.length();
        const muzzleVel = u.isAA ? 750 : 780;
        // Compensate slightly for ballistic gravity drop
        const tof = targetDist / muzzleVel;
        aimVec.y += 0.5 * 9.81 * tof * tof;
        aimVec.normalize().multiplyScalar(muzzleVel);
        // Realistic dispersion
        aimVec.x += (Math.random() - 0.5) * 18;
        aimVec.z += (Math.random() - 0.5) * 18;

        this.weapons.spawnBullet(muzzlePos, aimVec, {
          ownerId: u.id,
          team: u.team,
          dmg: u.isAA ? 16 : 95,
          armorPenMm: u.isAA ? 45 : 410,
          blastRadius: u.isAA ? 0 : 7,
          isHeavyShell: !u.isAA,
        });
        if (!u.isAA) this.audio.playTankCannon(u.pos);
      }
    }
  }

  _updateInfantryAI(u, dt, target, dist) {
    const goal = target && dist < 320 ? target.pos : u.waypoint;
    const dx = goal.x - u.pos.x;
    const dz = goal.z - u.pos.z;
    const d = Math.hypot(dx, dz);
    if (!target && d < 12) {
      u.waypoint.set(u.pos.x + (Math.random() - 0.5) * 160, 0, u.pos.z + (Math.random() - 0.5) * 160);
    }
    if (d > 28) {
      u.heading = this._lerpAngle(u.heading, Math.atan2(-dx, -dz), 1 - Math.exp(-4 * dt));
      u.pos.x += -Math.sin(u.heading) * 3.8 * dt;
      u.pos.z += -Math.cos(u.heading) * 3.8 * dt;
    }
    u.pos.y = getTerrainHeight(u.pos.x, u.pos.z);
    u.root.position.copy(u.pos);
    u.root.rotation.y = u.heading;

    if (target && dist < 260) {
      u.fireCooldown -= dt;
      if (u.fireCooldown <= 0) {
        u.fireCooldown = 1.6 + Math.random() * 1.6;
        const dir = target.pos.clone().sub(u.pos).normalize();
        dir.x += (Math.random() - 0.5) * 0.08;
        dir.y += 0.02;
        dir.z += (Math.random() - 0.5) * 0.08;
        this.weapons.spawnBullet(u.pos.clone().add(new THREE.Vector3(0, 1.4, 0)), dir.multiplyScalar(360), {
          ownerId: u.id,
          team: u.team,
          dmg: 6,
          armorPenMm: 10,
        });
      }
    }
  }

  _lerpAngle(a, b, t) {
    let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }
}
