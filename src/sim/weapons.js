import * as THREE from 'three';
import { getTerrainHeight } from '../world/terrain.js';

/**
 * Combined-Arms Weapons, Ballistics, Homing Missiles & Armor Penetration Engine.
 */
export class WeaponSystem {
  constructor(scene, assets, vfx, audio, battlefield) {
    this.scene = scene;
    this.assets = assets;
    this.vfx = vfx;
    this.audio = audio;
    this.battlefield = battlefield;

    this.projectiles = []; // tracers & tank shells
    this.missiles = [];    // AIM-9L / AIM-120B / AGM homing missiles
    this.flares = [];      // heat decoys

    this.tracerGeo = new THREE.CylinderGeometry(0.14, 0.14, 7.5, 6);
    this.tracerGeo.rotateX(Math.PI / 2);
    this.shellGeo = new THREE.SphereGeometry(0.32, 8, 8);

    this.yellowMat = new THREE.MeshBasicMaterial({ color: 0xffd269 });
    this.redMat = new THREE.MeshBasicMaterial({ color: 0xff5533 });
    this.apMat = new THREE.MeshBasicMaterial({ color: 0xffe9a3 });
    this.flareGeo = new THREE.SphereGeometry(0.45, 6, 6);
    this.flareMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
  }

  spawnBullet(pos, vel, {
    ownerId,
    team,
    dmg = 25,
    armorPenMm = 45,
    blastRadius = 0,
    isHeavyShell = false,
  }) {
    const geo = isHeavyShell ? this.shellGeo : this.tracerGeo;
    const mat = isHeavyShell ? this.apMat : team === 'blue' ? this.yellowMat : this.redMat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    if (!isHeavyShell) {
      mesh.lookAt(pos.clone().add(vel));
    }
    this.scene.add(mesh);

    this.projectiles.push({
      mesh,
      pos: pos.clone(),
      prevPos: pos.clone(),
      vel: vel.clone(),
      ownerId,
      team,
      dmg,
      armorPenMm,
      blastRadius,
      isHeavyShell,
      life: isHeavyShell ? 6.0 : 2.6,
    });
  }

  async spawnMissile(pos, quat, vel, {
    ownerId,
    team,
    target = null,
    type = 'aim9', // 'aim9' | 'aim120' | 'agm'
  }) {
    const modelUrl = type === 'aim120'
      ? '/assets/models/weapons/aim120b.glb'
      : '/assets/models/weapons/aim9l.glb';

    let mesh;
    try {
      const inst = await this.assets.instantiate(modelUrl);
      mesh = inst.root;
    } catch {
      mesh = new THREE.Mesh(this.tracerGeo, this.apMat);
    }
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    this.scene.add(mesh);

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    const launchVel = vel.clone().addScaledVector(fwd, 95);

    this.missiles.push({
      mesh,
      pos: pos.clone(),
      quat: quat.clone(),
      vel: launchVel,
      ownerId,
      team,
      target,
      type,
      speedMax: type === 'aim120' ? 980 : type === 'aim9' ? 780 : 540,
      turnRate: type === 'aim9' ? 2.8 : type === 'aim120' ? 2.3 : 1.7,
      dmg: type === 'agm' ? 380 : 185,
      blastRadius: type === 'agm' ? 28 : 20,
      life: 14.0,
      smokeTimer: 0,
    });
  }

  spawnFlare(pos, jetVel) {
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const v = jetVel.clone().add(new THREE.Vector3(side * (16 + Math.random() * 10), -12, (Math.random() - 0.5) * 14));
      const mesh = new THREE.Mesh(this.flareGeo, this.flareMat);
      mesh.position.copy(pos);
      this.scene.add(mesh);
      this.flares.push({ mesh, pos: pos.clone(), vel: v, life: 2.2 });
      this.vfx.spawnFlare(pos, v);
    }
  }

  /**
   * Evaluates armor penetration against sloped tank hulls.
   */
  _computeTankArmorDamage(proj, unit) {
    if (unit.category !== 'tank') return { dmg: proj.dmg, ricochet: false };
    const hitDir = proj.vel.clone().normalize().negate();
    const unitFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(unit.quat);
    const unitRight = new THREE.Vector3(1, 0, 0).applyQuaternion(unit.quat);

    const fwdDot = Math.abs(hitDir.dot(unitFwd));
    const sideDot = Math.abs(hitDir.dot(unitRight));
    const frontFace = hitDir.dot(unitFwd) > 0.35;

    let baseArmor = unit.specs?.sideArmorMm || 160;
    if (frontFace) baseArmor = unit.specs?.frontArmorMm || 600;
    else if (hitDir.dot(unitFwd) < -0.45) baseArmor = unit.specs?.rearArmorMm || 65;

    const obliquity = Math.max(0.22, Math.max(fwdDot, sideDot));
    const effectiveArmor = baseArmor / obliquity;

    if (obliquity < 0.28 && proj.armorPenMm < effectiveArmor) {
      return { dmg: 0, ricochet: true };
    }
    if (proj.armorPenMm >= effectiveArmor) {
      return { dmg: proj.dmg, ricochet: false };
    }
    // Partial / spall damage for HE / heavy blasts
    return { dmg: proj.blastRadius > 0 ? proj.dmg * 0.45 : proj.dmg * 0.12, ricochet: false };
  }

  update(dt, units, onUnitDamage, onFeedback) {
    // 1. Update Flares
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.life -= dt;
      f.vel.y -= 9.81 * dt;
      f.vel.multiplyScalar(Math.exp(-0.8 * dt));
      f.pos.addScaledVector(f.vel, dt);
      f.mesh.position.copy(f.pos);
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        this.flares.splice(i, 1);
      }
    }

    // 2. Update Ballistic Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.prevPos.copy(p.pos);
      p.vel.y -= 9.81 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);

      let impacted = false;

      // Check unit hits (swept segment distance)
      for (const u of units) {
        if (!u.alive || u.id === p.ownerId || u.team === p.team) continue;
        const hitRad = u.hitRadius || 6.0;
        const dist = this._pointToSegmentDist(u.pos, p.prevPos, p.pos);
        if (dist <= hitRad) {
          const { dmg, ricochet } = this._computeTankArmorDamage(p, u);
          this.vfx.spawnHitImpact(p.pos, new THREE.Vector3(0, 1, 0), true);
          if (ricochet) {
            if (p.ownerId === 'player' && onFeedback) onFeedback('RICOCHET — ARMOR DEFLECTED');
          } else if (dmg > 0) {
            onUnitDamage(u, dmg, p.ownerId);
          }
          if (p.blastRadius > 0) {
            this.vfx.spawnExplosion(p.pos, 1.4, true);
            this.audio.playExplosion(p.pos, false);
          }
          impacted = true;
          break;
        }
      }

      // Check building collisions
      if (!impacted) {
        for (const d of this.battlefield.destructibles) {
          if (d.destroyed) continue;
          if (p.pos.distanceTo(d.pos) < d.radius) {
            this.battlefield.damageStructureAt(p.pos, Math.max(8, p.blastRadius), p.dmg);
            this.vfx.spawnHitImpact(p.pos);
            impacted = true;
            break;
          }
        }
      }

      // Check terrain ground hit
      if (!impacted) {
        const gY = getTerrainHeight(p.pos.x, p.pos.z);
        if (p.pos.y <= gY) {
          p.pos.y = gY;
          if (p.isHeavyShell || p.blastRadius > 0) {
            this.vfx.spawnExplosion(p.pos, 1.2, false);
            this.audio.playExplosion(p.pos, false);
            this.battlefield.damageStructureAt(p.pos, p.blastRadius, p.dmg);
            // Splash damage to nearby ground units
            for (const u of units) {
              if (!u.alive || u.team === p.team) continue;
              const d = u.pos.distanceTo(p.pos);
              if (d < Math.max(12, p.blastRadius)) {
                onUnitDamage(u, p.dmg * 0.65 * (1 - d / Math.max(12, p.blastRadius)), p.ownerId);
              }
            }
          } else {
            this.vfx.spawnHitImpact(p.pos);
          }
          impacted = true;
        }
      }

      if (impacted || p.life <= 0) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    // 3. Update Guided Missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;

      // Flare decoy check for IR missiles
      if (m.type === 'aim9' && m.target && m.target.alive) {
        for (const f of this.flares) {
          if (f.pos.distanceTo(m.pos) < 160 && Math.random() < 0.04) {
            m.target = { pos: f.pos, vel: f.vel, alive: true, hitRadius: 3, isFlare: true };
            break;
          }
        }
      }

      // Proportional navigation lead pursuit
      if (m.target && m.target.alive) {
        const toTgt = new THREE.Vector3().subVectors(m.target.pos, m.pos);
        const dist = toTgt.length();
        const tGo = dist / Math.max(200, m.vel.length());
        const intercept = m.target.pos.clone().addScaledVector(m.target.vel || new THREE.Vector3(), tGo * 0.75);
        const desiredDir = intercept.sub(m.pos).normalize();

        const targetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), desiredDir);
        m.quat.rotateTowards(targetQuat, m.turnRate * dt);
      }

      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(m.quat);
      const curSpeed = Math.min(m.speedMax, m.vel.length() + 340 * dt);
      m.vel.copy(fwd).multiplyScalar(curSpeed);
      m.pos.addScaledVector(m.vel, dt);

      m.mesh.position.copy(m.pos);
      m.mesh.quaternion.copy(m.quat);

      // Rocket motor smoke trail
      m.smokeTimer -= dt;
      if (m.smokeTimer <= 0) {
        m.smokeTimer = 0.025;
        this.vfx.spawnSmokePuff(m.pos, 2.8, 0xdbe3ec, 1.5);
      }

      let detonate = false;
      for (const u of units) {
        if (!u.alive || u.id === m.ownerId || u.team === m.team) continue;
        if (u.pos.distanceTo(m.pos) <= (u.hitRadius || 6) + 12) {
          detonate = true;
          break;
        }
      }
      if (m.target?.isFlare && m.pos.distanceTo(m.target.pos) < 12) detonate = true;

      const gY = getTerrainHeight(m.pos.x, m.pos.z);
      if (m.pos.y <= gY) {
        m.pos.y = gY;
        detonate = true;
      }

      if (detonate || m.life <= 0) {
        if (detonate) {
          this.vfx.spawnExplosion(m.pos, 2.6, true);
          this.audio.playExplosion(m.pos, true);
          this.battlefield.damageStructureAt(m.pos, m.blastRadius, m.dmg);
          for (const u of units) {
            if (!u.alive || u.team === m.team) continue;
            const d = u.pos.distanceTo(m.pos);
            if (d <= m.blastRadius + (u.hitRadius || 6)) {
              onUnitDamage(u, m.dmg, m.ownerId);
            }
          }
        }
        this.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
      }
    }
  }

  _pointToSegmentDist(p, a, b) {
    const ab = new THREE.Vector3().subVectors(b, a);
    const lenSq = ab.lengthSq();
    if (lenSq < 1e-6) return p.distanceTo(a);
    const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(p, a).dot(ab) / lenSq, 0, 1);
    const proj = a.clone().addScaledVector(ab, t);
    return p.distanceTo(proj);
  }
}
