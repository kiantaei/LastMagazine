import * as THREE from 'three';
import type { Player } from '../player/Player';
import type { Wanted } from './Wanted';
import type { Hud } from '../ui/Hud';
import type { StorePoint } from '../world/City';

const HUNGER_RATE = 0.42; // per second — a full bar lasts ~4 minutes
const STARVING_HP_DRAIN = 2.2; // hp/s below the hunger floor
const HUNGER_FLOOR = 25;
const MEAL_COST = 5;
const MEAL_RESTORE = 55;
const ROB_COOLDOWN = 75; // seconds per store
const ROB_PAY_MIN = 140;
const ROB_PAY_MAX = 320;

export interface RobberyTarget {
  index: number;
  pos: THREE.Vector3;
  name: string;
  available: boolean;
}

/**
 * City survival loop: hunger that has to be kept down with hot-dog carts,
 * cash in the pocket, and robbable market registers that pay out and call
 * the cops.
 */
export class CityLife {
  hunger = 100;
  cash = 50;
  robbedTotal = 0;
  starving = false;

  private storeCd: number[];
  private hurtFlashAcc = 0;

  constructor(
    private stores: StorePoint[],
    private carts: THREE.Vector3[],
  ) {
    this.storeCd = stores.map(() => 0);
  }

  update(dt: number, player: Player, wanted: Wanted, hud: Hud): void {
    this.hunger = Math.max(0, this.hunger - HUNGER_RATE * dt);
    this.starving = this.hunger < HUNGER_FLOOR;

    if (this.starving && !player.dead) {
      // routed through damage() so passive regen stays blocked while starving
      player.damage(STARVING_HP_DRAIN * dt, {});
      this.hurtFlashAcc += dt;
      if (this.hurtFlashAcc > 1.2) {
        this.hurtFlashAcc = 0;
        hud.flashDamage();
      }
    }

    for (let i = 0; i < this.storeCd.length; i++) {
      if (this.storeCd[i] > 0) this.storeCd[i] = Math.max(0, this.storeCd[i] - dt);
    }
    void wanted;
  }

  // ------------------------------------------------------------- interact
  nearestCart(pos: THREE.Vector3, maxDist = 2.8): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestD = maxDist;
    for (const c of this.carts) {
      const d = c.distanceTo(pos);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  nearestStore(pos: THREE.Vector3, maxDist = 3.2): RobberyTarget | null {
    let best: RobberyTarget | null = null;
    let bestD = maxDist;
    this.stores.forEach((s, i) => {
      const d = s.register.distanceTo(pos);
      if (d < bestD) {
        bestD = d;
        best = { index: i, pos: s.register, name: s.name, available: this.storeCd[i] <= 0 };
      }
    });
    return best;
  }

  /** buy a hot dog — false when broke */
  eat(player: Player): boolean {
    if (this.cash < MEAL_COST) return false;
    this.cash -= MEAL_COST;
    this.hunger = Math.min(100, this.hunger + MEAL_RESTORE);
    void player;
    return true;
  }

  /** empty a register — pays out and raises hell */
  rob(index: number, player: Player, wanted: Wanted, hud: Hud): number {
    const take = Math.round(ROB_PAY_MIN + Math.random() * (ROB_PAY_MAX - ROB_PAY_MIN));
    this.cash += take;
    this.robbedTotal++;
    this.storeCd[index] = ROB_COOLDOWN;
    wanted.crime('robbery');
    hud.killFeed(`▸ ${this.stores[index].name} ROBBED +$${take}`);
    void player;
    return take;
  }

  reset(): void {
    this.hunger = 100;
    this.cash = 50;
    this.robbedTotal = 0;
    this.starving = false;
    this.storeCd = this.storeCd.map(() => 0);
  }
}
