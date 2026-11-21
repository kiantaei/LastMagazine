const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

export interface HudFrame {
  mag: number;
  reserve: number;
  reloadProgress: number; // 0 when idle, 0..1 while reloading
  health: number;
}

/**
 * DOM overlay: bodycam chrome (REC, timestamp), ammo block, wave/kills,
 * hitmarkers, wave banners, kill feed and the damage flash.
 */
export class Hud {
  private hudRoot = $('hud');
  private magEl = $('hud-mag');
  private reserveEl = $('hud-reserve');
  private waveEl = $('hud-wave');
  private killsEl = $('hud-kills');
  private timestampEl = $('hud-timestamp');
  private hitmarkerEl = $('hud-hitmarker');
  private bannerEl = $('hud-banner');
  private feedEl = $('hud-feed');
  private reloadBar = $('hud-reload-bar');
  private reloadFill = $('hud-reload-fill');
  private damageOverlay = $('damage-overlay');
  private menuEl = $('menu');
  private pauseEl = $('pause');
  private deathEl = $('death');
  private deathStatsEl = $('death-stats');

  private tsAcc = 1;
  private hmTimer = 0;
  private bannerTimer = 0;
  private feedTimer = 0;
  private dmgOpacity = 0;

  constructor() {
    this.hudRoot.classList.add('hidden');
    this.menuEl.classList.remove('hidden');
    this.pauseEl.classList.add('hidden');
    this.deathEl.classList.add('hidden');
    this.setTimestamp();
  }

  // ---------------------------------------------------------------- setters
  setAmmo(mag: number, reserve: number): void {
    this.magEl.textContent = String(mag);
    this.reserveEl.textContent = `/ ${reserve}`;
    this.magEl.classList.toggle('empty', mag === 0);
  }

  setWave(wave: number): void {
    this.waveEl.textContent = `WAVE ${wave}`;
  }

  setKills(kills: number): void {
    this.killsEl.textContent = `KILLS ${kills}`;
  }

  hitmarker(killed: boolean): void {
    this.hitmarkerEl.style.color = killed ? '#ff4a3c' : '#ffffff';
    this.hitmarkerEl.classList.remove('pop');
    void this.hitmarkerEl.offsetWidth; // restart the CSS animation
    this.hitmarkerEl.classList.add('pop');
    this.hmTimer = 0.16;
  }

  waveBanner(wave: number, count: number): void {
    this.bannerEl.textContent = `WAVE ${wave} — ${count} HOSTILES INBOUND`;
    this.bannerEl.classList.add('show');
    this.bannerTimer = 2.6;
  }

  killFeed(): void {
    this.feedEl.textContent = '▸ HOSTILE DOWN';
    this.feedEl.classList.add('show');
    this.feedTimer = 1.3;
  }

  flashDamage(): void {
    this.dmgOpacity = Math.min(0.6, this.dmgOpacity + 0.38);
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
  }

  private setTimestamp(): void {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
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

  showDeath(kills: number, wave: number): void {
    this.deathStatsEl.textContent = `KILLS ${kills} · REACHED WAVE ${wave}`;
    this.deathEl.classList.remove('hidden');
  }

  hideAll(): void {
    this.hudRoot.classList.remove('hidden');
    this.menuEl.classList.add('hidden');
    this.pauseEl.classList.add('hidden');
    this.deathEl.classList.add('hidden');
  }
}
