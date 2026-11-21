import * as THREE from 'three';
import type { Collider } from '../world/City';

export interface PlayerEvents {
  onFootstep?: (sprinting: boolean) => void;
  onLand?: (impactSpeed: number) => void;
  onDamage?: (amount: number) => void;
}

const GRAVITY = 15;
const WALK = 4.4;
const SPRINT = 6.7;
const CROUCH_SPEED = 2.1;
const JUMP_V = 5.0;

/**
 * First-person body: quake-lite acceleration, crouch/sprint/jump,
 * axis-separated AABB collision with auto step-up, footstep and
 * landing events, health with COD-style out-of-combat regen.
 */
export class Player {
  pos = new THREE.Vector3(0, 0, 24);
  vel = new THREE.Vector3();
  readonly radius = 0.35;
  readonly eyeStand = 1.62;
  readonly eyeCrouch = 1.06;
  height = 1.7;
  eyeHeight = this.eyeStand;
  grounded = true;
  crouching = false;
  sprinting = false;
  health = 100;
  readonly maxHealth = 100;
  dead = false;

  private lastDamageT = 99;
  private stepAccum = 0;

  reset(pos: THREE.Vector3): void {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.health = this.maxHealth;
    this.dead = false;
    this.crouching = false;
    this.sprinting = false;
    this.grounded = true;
    this.eyeHeight = this.eyeStand;
    this.lastDamageT = 99;
    this.stepAccum = 0;
  }

  update(
    dt: number,
    keys: Set<string>,
    jumpPressed: boolean,
    yaw: number,
    colliders: Collider[],
    events: PlayerEvents,
  ): void {
    const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);

    this.crouching = keys.has('KeyC') || keys.has('ControlLeft');
    this.sprinting = keys.has('ShiftLeft') && fwd > 0 && !this.crouching;

    const speed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT : WALK;

    // wish direction in the yaw plane
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    let wx = fx * fwd + rx * side;
    let wz = fz * fwd + rz * side;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) {
      wx /= wl;
      wz /= wl;
    }

    // friction + exponential approach toward wish velocity
    if (this.grounded) {
      const damp = Math.max(0, 1 - 9.5 * dt);
      this.vel.x *= damp;
      this.vel.z *= damp;
    }
    const approach = Math.min(1, dt * (this.grounded ? 11 : 2.2));
    this.vel.x += (wx * speed - this.vel.x) * approach;
    this.vel.z += (wz * speed - this.vel.z) * approach;

    if (jumpPressed && this.grounded && !this.crouching) {
      this.vel.y = JUMP_V;
      this.grounded = false;
    }

    // integrate with collisions, axis by axis
    this.moveAxis('x', this.vel.x * dt, colliders);
    this.moveAxis('z', this.vel.z * dt, colliders);

    const wasGrounded = this.grounded;
    this.grounded = false;
    this.vel.y -= GRAVITY * dt;
    this.moveAxis('y', this.vel.y * dt, colliders);

    if (this.pos.y <= 0) {
      this.pos.y = 0;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    }
    if (this.grounded && !wasGrounded) {
      events.onLand?.(-this.vel.y);
    }

    // crouch eye-height spring
    const wantEye = this.crouching ? this.eyeCrouch : this.eyeStand;
    this.eyeHeight += (wantEye - this.eyeHeight) * Math.min(1, dt * 9);
    this.height = this.eyeHeight + 0.08;

    // footsteps by stride distance
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && hSpeed > 0.5) {
      this.stepAccum += hSpeed * dt;
      const stride = this.sprinting ? 2.6 : this.crouching ? 2.6 : 2.0;
      if (this.stepAccum >= stride) {
        this.stepAccum = 0;
        events.onFootstep?.(this.sprinting);
      }
    }

    // health regen out of combat
    this.lastDamageT += dt;
    if (!this.dead && this.lastDamageT > 5.5 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + 14 * dt);
    }
  }

  damage(amount: number, events: PlayerEvents): void {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.lastDamageT = 0;
    events.onDamage?.(amount);
    if (this.health <= 0) this.dead = true;
  }

  private moveAxis(axis: 'x' | 'y' | 'z', delta: number, colliders: Collider[]): void {
    if (delta === 0) return;
    this.pos[axis] += delta;
    const r = this.radius;
    const h = this.height;

    for (const c of colliders) {
      if (this.pos.x + r <= c.min.x || this.pos.x - r >= c.max.x) continue;
      if (this.pos.z + r <= c.min.z || this.pos.z - r >= c.max.z) continue;
      if (this.pos.y + h <= c.min.y || this.pos.y >= c.max.y) continue;

      if (axis === 'y') {
        if (delta <= 0) {
          this.pos.y = c.max.y;
          this.vel.y = 0;
          this.grounded = true;
        } else {
          this.pos.y = c.min.y - h;
          this.vel.y = 0;
        }
        continue;
      }

      // low obstacle while grounded → auto step-up
      const stepUp = c.max.y - this.pos.y;
      if (this.grounded && stepUp > 0 && stepUp <= 0.55) {
        this.pos.y = c.max.y + 0.001;
        continue;
      }

      if (axis === 'x') {
        this.pos.x = delta > 0 ? c.min.x - r : c.max.x + r;
        this.vel.x = 0;
      } else {
        this.pos.z = delta > 0 ? c.min.z - r : c.max.z + r;
        this.vel.z = 0;
      }
    }
  }
}
