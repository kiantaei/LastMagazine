import * as THREE from 'three';

/**
 * High-Performance Battlefield VFX System
 * Renders sprite-based explosions, billowing fireballs, persistent wreck smoke,
 * wingtip contrails, missile exhaust plumes, shell impact dust, and physical tumbling debris.
 */
export class BattlefieldVFX {
  constructor(scene, textures) {
    this.scene = scene;
    this.fireTex = textures.fire;
    this.smokeTex = textures.smoke;
    this.sparkTex = textures.spark;

    this.particles = [];
    this.debris = [];
    this.flashLights = [];
    this.smokeColumns = [];

    this.debrisGeo = new THREE.BoxGeometry(0.45, 0.22, 0.65);
    this.debrisMat = new THREE.MeshStandardMaterial({
      color: 0x22252a,
      roughness: 0.78,
      metalness: 0.55,
    });
  }

  _spawnSprite(tex, pos, vel, {
    size = 8,
    endSize = 24,
    life = 1.2,
    color = 0xffffff,
    opacity = 0.85,
    additive = false,
    gravity = 0,
    drag = 0.98,
  } = {}) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    sprite.scale.set(size, size, 1);
    mat.rotation = Math.random() * Math.PI * 2;
    this.scene.add(sprite);

    this.particles.push({
      sprite,
      mat,
      vel: vel.clone(),
      size,
      endSize,
      life,
      maxLife: life,
      opacity,
      gravity,
      drag,
    });
  }

  spawnExplosion(pos, scale = 1.0, withDebris = true) {
    // Blast flash PointLight
    const light = new THREE.PointLight(0xff8c2b, 45 * scale, 180 * scale, 1.4);
    light.position.copy(pos).add(new THREE.Vector3(0, 3 * scale, 0));
    this.scene.add(light);
    this.flashLights.push({ light, life: 0.35, maxLife: 0.35, baseIntensity: 45 * scale });

    // Core shock spark
    this._spawnSprite(this.sparkTex, pos, new THREE.Vector3(0, 2, 0), {
      size: 10 * scale,
      endSize: 42 * scale,
      life: 0.24,
      color: 0xffe4a0,
      opacity: 1.0,
      additive: true,
    });

    // Fireballs
    for (let i = 0; i < 6; i++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 18 * scale,
        (4 + Math.random() * 14) * scale,
        (Math.random() - 0.5) * 18 * scale
      );
      this._spawnSprite(this.fireTex, pos, v, {
        size: 6 * scale,
        endSize: 22 * scale,
        life: 0.55 + Math.random() * 0.35,
        color: i % 2 === 0 ? 0xff7b22 : 0xffbe42,
        opacity: 0.95,
        additive: true,
        drag: 0.94,
      });
    }

    // Thick dark smoke plume
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 14 * scale,
        (7 + Math.random() * 16) * scale,
        (Math.random() - 0.5) * 14 * scale
      );
      this._spawnSprite(this.smokeTex, pos, v, {
        size: 8 * scale,
        endSize: 34 * scale,
        life: 2.2 + Math.random() * 1.4,
        color: 0x26282b,
        opacity: 0.72,
        additive: false,
        drag: 0.96,
      });
    }

    // Tumbling physical metal debris
    if (withDebris) {
      const count = Math.min(12, Math.floor(7 * scale));
      for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(this.debrisGeo, this.debrisMat);
        mesh.position.copy(pos);
        mesh.scale.setScalar(0.7 + Math.random() * 1.1 * scale);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.debris.push({
          mesh,
          vel: new THREE.Vector3(
            (Math.random() - 0.5) * 38 * scale,
            (12 + Math.random() * 28) * scale,
            (Math.random() - 0.5) * 38 * scale
          ),
          rot: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9),
          life: 3.5 + Math.random() * 1.5,
        });
      }
    }
  }

  spawnHitImpact(pos, normal = new THREE.Vector3(0, 1, 0), isArmor = false) {
    for (let i = 0; i < (isArmor ? 3 : 2); i++) {
      const v = normal.clone().multiplyScalar(8 + Math.random() * 10);
      v.x += (Math.random() - 0.5) * 8;
      v.z += (Math.random() - 0.5) * 8;
      this._spawnSprite(isArmor ? this.sparkTex : this.smokeTex, pos, v, {
        size: isArmor ? 2.2 : 3.2,
        endSize: isArmor ? 6.5 : 10,
        life: isArmor ? 0.25 : 0.75,
        color: isArmor ? 0xffc66d : 0x766e64,
        opacity: 0.8,
        additive: isArmor,
        drag: 0.92,
      });
    }
  }

  spawnSmokePuff(pos, size = 3.2, color = 0xbfc5cc, life = 1.8) {
    this._spawnSprite(this.smokeTex, pos, new THREE.Vector3(0, 1.2, 0), {
      size,
      endSize: size * 3.4,
      life,
      color,
      opacity: 0.42,
      drag: 0.99,
    });
  }

  spawnFlare(pos, vel) {
    this._spawnSprite(this.sparkTex, pos, vel, {
      size: 2.8,
      endSize: 0.8,
      life: 1.6,
      color: 0xffeb99,
      opacity: 1.0,
      additive: true,
      gravity: -8.0,
      drag: 0.96,
    });
  }

  addPersistentWreckFire(pos, duration = 18) {
    this.smokeColumns.push({ pos: pos.clone(), life: duration, timer: 0 });
  }

  update(dt, getTerrainHeight) {
    // Update sprite particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.sprite);
        p.mat.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      const progress = 1 - p.life / p.maxLife;
      p.vel.y += p.gravity * dt;
      p.vel.multiplyScalar(Math.pow(p.drag, dt * 60));
      p.sprite.position.addScaledVector(p.vel, dt);

      const s = THREE.MathUtils.lerp(p.size, p.endSize, progress);
      p.sprite.scale.set(s, s, 1);
      p.mat.opacity = p.opacity * (1 - progress * progress);
    }

    // Update debris
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vel.y -= 18 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.rot.x * dt;
      d.mesh.rotation.y += d.rot.y * dt;
      d.mesh.rotation.z += d.rot.z * dt;

      const ground = getTerrainHeight(d.mesh.position.x, d.mesh.position.z) + 0.15;
      if (d.mesh.position.y < ground) {
        d.mesh.position.y = ground;
        d.vel.y = Math.abs(d.vel.y) * 0.25;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
      }
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        this.debris.splice(i, 1);
      }
    }

    // Flash lights
    for (let i = this.flashLights.length - 1; i >= 0; i--) {
      const fl = this.flashLights[i];
      fl.life -= dt;
      if (fl.life <= 0) {
        this.scene.remove(fl.light);
        this.flashLights.splice(i, 1);
      } else {
        fl.light.intensity = fl.baseIntensity * (fl.life / fl.maxLife);
      }
    }

    // Persistent burning wrecks
    for (let i = this.smokeColumns.length - 1; i >= 0; i--) {
      const sc = this.smokeColumns[i];
      sc.life -= dt;
      sc.timer -= dt;
      if (sc.timer <= 0) {
        sc.timer = 0.22;
        this._spawnSprite(
          this.smokeTex,
          sc.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2)),
          new THREE.Vector3((Math.random() - 0.5) * 2.5, 6 + Math.random() * 4, (Math.random() - 0.5) * 2.5),
          { size: 4.5, endSize: 18, life: 2.8, color: 0x1d1f22, opacity: 0.62 }
        );
        if (Math.random() < 0.5) {
          this._spawnSprite(
            this.fireTex,
            sc.pos.clone().add(new THREE.Vector3(0, 0.8, 0)),
            new THREE.Vector3(0, 3.2, 0),
            { size: 3.2, endSize: 6.5, life: 0.45, color: 0xff6e1a, opacity: 0.85, additive: true }
          );
        }
      }
      if (sc.life <= 0) {
        this.smokeColumns.splice(i, 1);
      }
    }
  }
}
