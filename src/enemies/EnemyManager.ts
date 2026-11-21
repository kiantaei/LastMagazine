import * as THREE from 'three';
import type { Collider } from '../world/MapBuilder';
import { Enemy, type EnemyFx } from './Enemy';

export interface ManagerHooks {
  onKill?: (totalKills: number) => void;
  onWaveStart?: (wave: number, enemyCount: number) => void;
  onWaveClear?: (wave: number) => void;
  onPlayerHit: (damage: number, fromPos: THREE.Vector3) => void;
  onNearMiss: (pos: THREE.Vector3) => void;
}

export interface PlayerSnapshot {
  feet: THREE.Vector3;
  eye: THREE.Vector3;
  sprinting: boolean;
  crouching: boolean;
}

const MAX_ALIVE = 8;
const POOL_SIZE = 16;
const WAVE_CLEAR_DELAY = 3.2;

const TMP_SPAWN = new THREE.Vector3();

/**
 * Wave director + enemy pooling + squad separation.
 * Spawns hostiles at cover-blocked points away from the player, keeps
 * pressure with staggered inserts and escalates each wave.
 */
export class EnemyManager {
  wave = 0;
  kills = 0;
  aliveCount = 0;

  private pool: Enemy[] = [];
  private toSpawn = 0;
  private spawnTimer = 0;
  private waveClearTimer = -1;

  constructor(
    private scene: THREE.Scene,
    private fx: EnemyFx,
    private colliders: Collider[],
    /** world geometry — used for enemy LOS and spawn-cover checks */
    private hittables: THREE.Object3D[],
    /** world geometry + enemy hit zones — shared with the Weapon, mutated in place */
    private shootables: THREE.Object3D[],
    private spawnPoints: THREE.Vector3[],
    private hooks: ManagerHooks,
  ) {}

  start(): void {
    this.wave = 0;
    this.kills = 0;
    this.aliveCount = 0;
    this.toSpawn = 0;
    this.waveClearTimer = -1;
    for (const e of this.pool) e.deactivate();
    this.nextWave();
  }

  reset(): void {
    this.start();
  }

  private nextWave(): void {
    this.wave++;
    this.toSpawn = Math.min(3 + this.wave * 2, 16);
    this.spawnTimer = 0.6;
    this.waveClearTimer = -1;
    this.hooks.onWaveStart?.(this.wave, this.toSpawn);
  }

  update(dt: number, player: PlayerSnapshot): void {
    // --- spawning -----------------------------------------------------------
    if (this.toSpawn > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.aliveCount < MAX_ALIVE) {
        this.spawnOne(player);
        this.toSpawn--;
        this.spawnTimer = 1.1 + Math.random() * 1.4;
      }
    } else if (this.aliveCount === 0 && this.waveClearTimer < 0) {
      this.waveClearTimer = WAVE_CLEAR_DELAY;
      this.hooks.onWaveClear?.(this.wave);
    }
    if (this.waveClearTimer > 0) {
      this.waveClearTimer -= dt;
      if (this.waveClearTimer <= 0) this.nextWave();
    }

    // --- enemy updates -------------------------------------------------------
    const ctxBase = {
      dt,
      playerFeet: player.feet,
      playerEye: player.eye,
      playerSprinting: player.sprinting,
      playerCrouching: player.crouching,
      colliders: this.colliders,
      hittables: this.shootables,
      onPlayerHit: this.hooks.onPlayerHit,
      onNearMiss: this.hooks.onNearMiss,
      fx: this.fx,
    };
    let alive = 0;
    for (const e of this.pool) {
      if (!e.alive) continue;
      alive++;
      e.update({ ...ctxBase, dt });
    }
    this.aliveCount = alive;

    // pairwise separation (cheap at ≤8 hostiles)
    for (let i = 0; i < this.pool.length; i++) {
      const a = this.pool[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.pool.length; j++) {
        const b = this.pool[j];
        if (!b.alive) continue;
        const dx = b.group.position.x - a.group.position.x;
        const dz = b.group.position.z - a.group.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.81 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = ((0.9 - d) / d) * 0.5;
          a.nudge(-dx * push, -dz * push);
          b.nudge(dx * push, dz * push);
        }
      }
    }
  }

  private spawnOne(player: PlayerSnapshot): void {
    const pos = this.pickSpawn(player);
    // reuse a dead slot or grow the pool
    let enemy = this.pool.find((e) => !e.alive);
    if (!enemy) {
      if (this.pool.length >= POOL_SIZE) return; // pool exhausted, retry next tick
      enemy = new Enemy(this.scene);
      enemy.onKilled = () => {
        this.kills++;
        this.removeHitMeshes(enemy as Enemy);
        this.hooks.onKill?.(this.kills);
      };
      this.pool.push(enemy);
    }
    enemy.activate(pos);
    this.shootables.push(...enemy.hitMeshes);
  }

  private removeHitMeshes(enemy: Enemy): void {
    for (const m of enemy.hitMeshes) {
      const i = this.shootables.indexOf(m);
      if (i >= 0) this.shootables.splice(i, 1);
    }
  }

  private pickSpawn(player: PlayerSnapshot): THREE.Vector3 {
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    for (const p of this.spawnPoints) {
      const dist = p.distanceTo(player.feet);
      if (dist < 14) continue;
      // blocked spawns (behind cover) are strongly preferred
      const eye = TMP_SPAWN.set(p.x, 1.5, p.z);
      const dir = new THREE.Vector3().subVectors(player.eye, eye);
      const d = dir.length();
      dir.divideScalar(d);
      this.rayTmp.set(eye, dir);
      this.rayTmp.far = d - 0.5;
      const blocked = this.rayTmp.intersectObjects(this.shootables, false).length > 0;
      const score = (blocked ? 40 : 0) + dist;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) return best;
    // fallback: farthest point
    let far = this.spawnPoints[0];
    let fd = 0;
    for (const p of this.spawnPoints) {
      const d = p.distanceTo(player.feet);
      if (d > fd) {
        fd = d;
        far = p;
      }
    }
    return far;
  }

  private rayTmp = new THREE.Raycaster();
}
