import { Hud } from '../ui/Hud';
import { SFX } from '../audio/SFX';

export type CrimeKind =
  | 'gunshotNear'
  | 'civShot'
  | 'civKilled'
  | 'civRunOver'
  | 'copCarShot'
  | 'copKilled'
  | 'robbery';

const HEAT: Record<CrimeKind, number> = {
  gunshotNear: 1.6,
  civShot: 6,
  civKilled: 22,
  civRunOver: 22,
  copCarShot: 3.5,
  copKilled: 34,
  robbery: 20,
};

const STAR_THRESHOLDS = [18, 38, 58, 78, 95]; // heat → stars 1..5
/** how many police cars hunt the player at each wanted level */
export const POLICE_BY_STAR = [0, 1, 2, 3, 4, 5];

/**
 * Classic five-star wanted system. Crimes raise the heat, heat decays when
 * the player stays quiet; the HUD stars and the police response follow.
 */
export class Wanted {
  heat = 0;
  kills = 0;
  private sinceCrime = 99;
  private copsAlive = 0;
  private sinceShotNoise = 99;

  constructor(
    private hud: Hud,
    private sfx: SFX,
  ) {}

  get stars(): number {
    let s = 0;
    for (const t of STAR_THRESHOLDS) if (this.heat >= t) s++;
    return s;
  }

  crime(kind: CrimeKind): void {
    this.sinceCrime = 0;
    const before = this.stars;
    this.heat = Math.min(100, this.heat + HEAT[kind]);
    const after = this.stars;
    if (after > before) {
      this.hud.setStars(after);
      this.hud.banner(`WANTED LEVEL ${after}`);
      this.sfx.starUp();
    } else if (kind === 'civKilled' || kind === 'civRunOver' || kind === 'copKilled') {
      this.hud.setStars(after);
    }
    if (kind === 'civKilled' || kind === 'civRunOver') {
      this.kills++;
      this.hud.killFeed('▸ CIVILIAN DOWN');
    } else if (kind === 'copKilled') {
      this.kills++;
      this.hud.killFeed('▸ OFFICER DOWN');
    }
    this.hud.setHeat(this.heat);
  }

  /** gunshot noise near civilians — throttled so sustained fire doesn't spam */
  shotNoise(now: number): void {
    if (now - this.sinceShotNoise < 0.5) return;
    this.sinceShotNoise = now;
    this.crime('gunshotNear');
  }

  update(dt: number, playerHidden: boolean): void {
    this.sinceCrime += dt;
    // heat cools when quiet — faster if no cops are on you
    const rate = this.copsAlive === 0 ? 3.2 : 1.1;
    if (this.sinceCrime > 9) {
      this.heat = Math.max(0, this.heat - rate * dt);
      this.hud.setHeat(this.heat);
      const before = this.stars;
      if (before < POLICE_BY_STAR.length) this.hud.setStars(before);
    }
    void playerHidden;
  }

  setCopsAlive(n: number): void {
    this.copsAlive = n;
  }

  reset(): void {
    this.heat = 0;
    this.kills = 0;
    this.sinceCrime = 99;
    this.copsAlive = 0;
    this.sinceShotNoise = 99;
    this.hud.setStars(0);
    this.hud.setHeat(0);
  }
}
