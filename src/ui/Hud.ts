const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

export interface HudFrame {
  mag: number;
  reserve: number;
  reloadProgress: number; // 0 when idle, 0..1 while reloading
  health: number;
  stars: number;
  driving: boolean;
  speed: number;
  hunger: number;
  cash: number;
}

/**
 * DOM overlay: bodycam chrome (REC, timestamp, battery), the LastMagazine
 * watermark, 5-star wanted display, health + ammo, interaction hints,
 * hitmarkers, banners, crime feed and the damage flash.
 */
export class Hud {
  private hudRoot = $('hud');
  private magEl = $('hud-mag');
  private reserveEl = $('hud-reserve');
  private timestampEl = $('hud-timestamp');
  private hitmarkerEl = $('hud-hitmarker');
  private bannerEl = $('hud-banner');
  private feedEl = $('hud-feed');
  private reloadBar = $('hud-reload-bar');
  private reloadFill = $('hud-reload-fill');
  private damageOverlay = $('damage-overlay');
  private torchEl = $('hud-torch');
  private battEl = $('hud-batt');
  private starsEl = $('hud-stars');
  private starEls: HTMLElement[] = [];
  private hpFill = $('hud-hp-fill');
  private hungerFill = $('hud-hunger-fill');
  private cashEl = $('hud-cash');
  private personaEl = $('hud-persona');
  private interactEl = $('hud-interact');
  private speedEl = $('hud-speed');
  private menuEl = $('menu');
  private pauseEl = $('pause');
  private deathEl = $('death');
  private deathStatsEl = $('death-stats');
  private menuCta = $('menu-cta');

  private tsAcc = 1;
  private hmTimer = 0;
  private bannerTimer = 0;
  private feedTimer = 0;
  private dmgOpacity = 0;
  private recGlitchT = 0;
  private batt = 100;
  private battAcc = 0;
  private personaFlashT = 0;

  constructor() {
    this.hudRoot.classList.add('hidden');
    this.menuEl.classList.remove('hidden');
    this.pauseEl.classList.add('hidden');
    this.deathEl.classList.add('hidden');
    this.setTimestamp();
    // build the five wanted stars
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('span');
      s.className = 'star';
      s.textContent = '★';
      this.starsEl.appendChild(s);
      this.starEls.push(s);
    }
    this.setStars(0);
  }

  // ---------------------------------------------------------------- setters
  setAmmo(mag: number, reserve: number): void {
    this.magEl.textContent = String(mag);
    this.reserveEl.textContent = `/ ${reserve}`;
    this.magEl.classList.toggle('empty', mag === 0);
  }

  setStars(n: number): void {
    this.starEls.forEach((s, i) => s.classList.toggle('lit', i < n));
    this.starsEl.classList.toggle('hot', n > 0);
  }

  setHeat(heat: number): void {
    // half-star flicker: the partial star underlines progress to the next level
    const frac = heat / 100;
    this.starsEl.style.setProperty('--heat', frac.toFixed(3));
  }

  setPersona(label: string): void {
    this.personaEl.textContent = label;
    this.personaFlashT = 2.2;
    this.personaEl.classList.add('flash');
  }

  setInteract(text: string | null): void {
    if (text) {
      this.interactEl.textContent = text;
      this.interactEl.classList.add('show');
    } else {
      this.interactEl.classList.remove('show');
    }
  }

  setTorch(on: boolean): void {
    this.torchEl.textContent = on ? 'TORCH ON' : 'TORCH OFF';
    this.torchEl.classList.toggle('off', !on);
  }

  /** brief REC chrome flicker synced with the visual glitch pass */
  recGlitch(): void {
    this.recGlitchT = 0.35;
    this.hudRoot.classList.add('rec-glitch');
  }

  hitmarker(killed: boolean): void {
    this.hitmarkerEl.style.color = killed ? '#ff4a3c' : '#ffffff';
    this.hitmarkerEl.classList.remove('pop');
    void this.hitmarkerEl.offsetWidth; // restart the CSS animation
    this.hitmarkerEl.classList.add('pop');
    this.hmTimer = 0.16;
  }

  banner(text: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('show');
    this.bannerTimer = 2.6;
  }

  killFeed(text: string): void {
    this.feedEl.textContent = text;
    this.feedEl.classList.add('show');
    this.feedTimer = 1.3;
  }

  flashDamage(): void {
    this.dmgOpacity = Math.min(0.6, this.dmgOpacity + 0.38);
  }

  setMenuLoading(ratio: number): void {
    this.menuCta.textContent = `LOADING MODELS … ${Math.round(ratio * 100)}%`;
    this.menuCta.style.opacity = '0.55';
  }

  setMenuReady(): void {
    this.menuCta.textContent = '▸ CLICK TO HIT THE STREETS ◂';
    this.menuCta.style.opacity = '1';
  }

  setMenuError(): void {
    this.menuCta.textContent = 'MODEL LOAD FAILED — CHECK CONSOLE';
    this.menuCta.style.opacity = '1';
    this.menuCta.style.color = '#ff5040';
  }

  // ------------------------------------------------------------------ frame
  frame(dt: number, data: HudFrame): void {
    this.tsAcc += dt;
    if (this.tsAcc > 0.25) {
      this.tsAcc = 0;
      this.setTimestamp();
    }

    if (data.reloadProgress > 0) {
      this.reloadBar.classList.add('show');
      this.reloadFill.style.width = `${Math.min(100, data.reloadProgress * 100)}%`;
    } else {
      this.reloadBar.classList.remove('show');
    }

    if (this.hmTimer > 0) {
      this.hmTimer -= dt;
      if (this.hmTimer <= 0) this.hitmarkerEl.classList.remove('pop');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('show');
    }
    if (this.feedTimer > 0) {
      this.feedTimer -= dt;
      if (this.feedTimer <= 0) this.feedEl.classList.remove('show');
    }

    this.dmgOpacity = Math.max(0, this.dmgOpacity - dt * 1.7);
    this.damageOverlay.style.opacity = this.dmgOpacity.toFixed(3);

    // health bar
    const hp = Math.max(0, Math.min(1, data.health / 100));
    this.hpFill.style.width = `${hp * 100}%`;
    this.hpFill.classList.toggle('low', hp < 0.35);

    // hunger bar
    const hunger = Math.max(0, Math.min(1, data.hunger / 100));
    this.hungerFill.style.width = `${hunger * 100}%`;
    this.hungerFill.classList.toggle('low', hunger < 0.25);

    // cash
    this.cashEl.textContent = `$${data.cash}`;

    // speed readout while driving
    if (data.driving) {
      this.speedEl.textContent = `${Math.round(Math.abs(data.speed) * 3.6)} KM/H`;
      this.speedEl.classList.add('show');
    } else {
      this.speedEl.classList.remove('show');
    }

    if (this.personaFlashT > 0) {
      this.personaFlashT -= dt;
      if (this.personaFlashT <= 0) this.personaEl.classList.remove('flash');
    }

    // bodycam battery drains slowly while recording
    this.battAcc += dt;
    if (this.battAcc >= 9 && this.batt > 18) {
      this.batt--;
      this.battAcc = 0;
      this.battEl.textContent = `BATT ${this.batt}%`;
      this.battEl.classList.toggle('low', this.batt < 30);
    }

    if (this.recGlitchT > 0) {
      this.recGlitchT -= dt;
      if (this.recGlitchT <= 0) this.hudRoot.classList.remove('rec-glitch');
    }
  }

  private setTimestamp(): void {
    const d = new Date();
    const p = (n: string | number) => String(n).padStart(2, '0');
    this.timestampEl.textContent =
      `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
      `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  // ------------------------------------------------------------------ views
  showMenu(): void {
    this.hudRoot.classList.add('hidden');
    this.menuEl.classList.remove('hidden');
    this.pauseEl.classList.add('hidden');
    this.deathEl.classList.add('hidden');
  }

  showPause(): void {
    this.pauseEl.classList.remove('hidden');
  }

  hidePause(): void {
    this.pauseEl.classList.add('hidden');
  }

  showDeath(kills: number, stars: number): void {
    this.deathStatsEl.textContent = `KILLS ${kills} · WANTED LEVEL ${stars}`;
    this.deathEl.classList.remove('hidden');
  }

  hideAll(): void {
    this.hudRoot.classList.remove('hidden');
    this.menuEl.classList.add('hidden');
    this.pauseEl.classList.add('hidden');
    this.deathEl.classList.add('hidden');
  }
}
