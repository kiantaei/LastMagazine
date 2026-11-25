const TIPS = [
  'TIP: USE [V] TO CYCLE CAMERA MODES MID-SORTIE',
  'TIP: FLARES BREAK MISSILE LOCK — BUT YOU ONLY CARRY SO MANY',
  'TIP: TANK GUNNERS — [F] FOR OPTICS, LEAD YOUR TARGETS',
  'TIP: HELI PILOTS — EASE THE COLLECTIVE, TORQUE WILL SPIN YOU',
  'TIP: LOW AND FAST BEATS HIGH AND SLOW AGAINST SAM COVERAGE',
];

export class LoadingScreen {
  constructor() {
    this.root = document.getElementById('loading-screen');
    this.fill = document.getElementById('boot-fill');
    this.track = document.querySelector('.boot-track');
    this.status = document.getElementById('boot-status');
    this.percent = document.getElementById('boot-percent');
    this.log = document.getElementById('boot-log');
    this.tip = document.getElementById('boot-tip');

    this.target = 0;
    this.shown = 0;
    this._raf = null;

    // Rotate the tip line a few times while anything might be loading
    this._tipTimer = setInterval(() => {
      if (this._hidden()) return;
      this.tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    }, 4200);

    this._animate();
  }

  _hidden() {
    return this.root.classList.contains('is-hidden');
  }

  _animate = () => {
    // Ease the visible bar toward the latest reported progress
    this.shown += (this.target - this.shown) * 0.12;
    if (Math.abs(this.target - this.shown) < 0.2) this.shown = this.target;
    const pct = Math.round(this.shown);
    this.fill.style.width = `${pct}%`;
    this.percent.textContent = `${pct}%`;
    this.track.setAttribute('aria-valuenow', String(pct));
    this._raf = requestAnimationFrame(this._animate);
  };

  show(title = 'INITIALIZING SYSTEMS') {
    this.root.classList.remove('is-hidden');
    this.status.textContent = title;
  }

  setProgress(pct, label) {
    this.target = Math.max(0, Math.min(100, pct));
    if (label) this.status.textContent = label;
  }

  logLine(text) {
    const row = document.createElement('div');
    row.textContent = text;
    this.log.appendChild(row);
    while (this.log.childElementCount > 3) this.log.firstElementChild.remove();
  }

  hide() {
    this.root.classList.add('is-hidden');
  }
}
