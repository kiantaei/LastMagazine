import * as THREE from 'three';

/**
 * Fully procedural sound engine — zero audio assets.
 *
 * Every buffer is synthesized at boot with raw sample math (noise shaping,
 * exponential envelopes, frequency sweeps), routed through a compressor and
 * a generated convolution reverb. World sounds play through HRTF panners
 * spatialised from the camera listener each frame.
 */
export class SFX {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private convolver: GainNode | null = null;
  private started = false;
  private buffers = new Map<string, AudioBuffer>();

  // ------------------------------------------------------------- lifecycle
  /** Must be called from a user gesture (AudioContext policy). */
  start(): void {
    if (this.started) return;
    this.started = true;

    const ctx = new AudioContext();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    // generated impulse response for the yard reverb
    const conv = ctx.createConvolver();
    conv.buffer = this.makeIR(ctx, 1.7);
    const wetBus = ctx.createGain();
    wetBus.gain.value = 1;
    wetBus.connect(conv);
    conv.connect(master);
    this.convolver = wetBus;

    this.generateAll(ctx);
    this.playLoop(this.buffers.get('ambience') as AudioBuffer, { gain: 0.17, wet: 0.12 });
  }

  private get audio(): AudioContext {
    return this.ctx as AudioContext;
  }

  // ------------------------------------------------------------- synthesis
  private makeIR(ctx: AudioContext, seconds: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.exp(-3.4 * t * seconds);
        lp += ((Math.random() * 2 - 1) - lp) * 0.18;
        d[i] = lp * env * (1 - t * 0.25);
      }
    }
    return buf;
  }

  private mk(
    name: string,
    seconds: number,
    fn: (t: number, i: number, sr: number, rnd: () => number) => number,
  ): void {
    const ctx = this.audio;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < len; i++) {
      d[i] = fn(i / sr, i, sr, Math.random);
      peak = Math.max(peak, Math.abs(d[i]));
    }
    if (peak > 0) {
      const norm = Math.min(1 / peak, 4);
      for (let i = 0; i < len; i++) d[i] *= norm;
    }
    this.buffers.set(name, buf);
  }

  private generateAll(ctx: AudioContext): void {
    void ctx;

    // --- player gunshot (3 variants) --------------------------------------
    for (let v = 0; v < 3; v++) {
      this.mk(`shot${v}`, 0.42, (t) => {
        const crack = (Math.random() * 2 - 1) * Math.exp(-t * 115) * 0.75;
        const bodyLp = Math.exp(-t * (22 + v * 3));
        const body = bodyLp * Math.exp(-t * 26) * 0.9;
        const sweep = Math.max(30, 68 - t * 240);
        const thump = Math.sin(Math.PI * 2 * sweep * t) * Math.exp(-t * 17) * 1.05;
        return Math.tanh((crack + body + thump) * 1.5) * 0.8;
      });
    }

    // --- distant / enemy gunshot (3 variants) -----------------------------
    for (let v = 0; v < 3; v++) {
      this.mk(`dshot${v}`, 1.05, (t) => {
        const snap = (Math.random() * 2 - 1) * Math.exp(-t * 46) * 0.35;
        let lp = 0;
        lp += ((Math.random() * 2 - 1) - lp) * 0.045;
        const body = lp * Math.exp(-t * 6.5) * 1.4;
        const sweep = Math.max(26, 52 - t * 70);
        const thump = Math.sin(Math.PI * 2 * sweep * t) * Math.exp(-t * 7) * 0.8;
        return Math.tanh((snap + body + thump) * 1.2) * 0.85;
      });
    }

    // --- footsteps (4 variants) -------------------------------------------
    for (let v = 0; v < 4; v++) {
      this.mk(`step${v}`, 0.14, (t) => {
        const heel = (Math.random() * 2 - 1) * Math.exp(-t * 95) * 0.6;
        let lp = 0;
        lp += ((Math.random() * 2 - 1) - lp) * (0.09 + v * 0.012);
        const scrape = lp * Math.exp(-t * 26) * 0.85;
        return (heel + scrape) * 0.7;
      });
    }

    // --- reload foley ------------------------------------------------------
    this.mk('magRelease', 0.06, (t) => {
      const click = (Math.random() * 2 - 1) * Math.exp(-t * 170) * 0.5;
      const ping = Math.sin(Math.PI * 2 * 1900 * t) * Math.exp(-t * 90) * 0.25;
      return (click + ping) * 0.8;
    });
    this.mk('magOut', 0.16, (t) => {
      const slideIn = Math.min(1, t / 0.03);
      let lp = 0;
      lp += ((Math.random() * 2 - 1) - lp) * 0.11;
      return lp * slideIn * Math.exp(-t * 19) * 0.8;
    });
    this.mk('magIn', 0.1, (t) => {
      const slap = (Math.random() * 2 - 1) * Math.exp(-t * 55) * 0.8;
      const thump = Math.sin(Math.PI * 2 * 130 * t) * Math.exp(-t * 42) * 0.5;
      return (slap + thump) * 0.85;
    });
    this.mk('bolt1', 0.07, (t) => {
      const metal = Math.sin(Math.PI * 2 * 2500 * t) * Math.exp(-t * 100) * 0.4;
      const clack = (Math.random() * 2 - 1) * Math.exp(-t * 150) * 0.7;
      return (metal + clack) * 0.8;
    });
    this.mk('bolt2', 0.08, (t) => {
      const metal = Math.sin(Math.PI * 2 * 1650 * t) * Math.exp(-t * 70) * 0.5;
      const clack = (Math.random() * 2 - 1) * Math.exp(-t * 110) * 0.65;
      return (metal + clack) * 0.9;
    });
    this.mk('dryFire', 0.05, (t) => {
      return ((Math.random() * 2 - 1) * Math.exp(-t * 210) * 0.5 +
        Math.sin(Math.PI * 2 * 1250 * t) * Math.exp(-t * 160) * 0.3) * 0.7;
    });

    // --- feedback ----------------------------------------------------------
    this.mk('hitmark', 0.08, (t) => {
      const a = Math.sin(Math.PI * 2 * 1780 * t) * Math.exp(-t * 60) * 0.5;
      const b = t > 0.028 ? Math.sin(Math.PI * 2 * 2400 * (t - 0.028)) * Math.exp(-(t - 0.028) * 70) * 0.45 : 0;
      return a + b;
    });
    this.mk('kill', 0.16, (t) => {
      const f = t < 0.08 ? 920 : 690;
      const tt = t < 0.08 ? t : t - 0.08;
      return Math.sin(Math.PI * 2 * f * tt) * Math.exp(-tt * 26) * 0.42;
    });
    this.mk('whiz', 0.24, (t) => {
      let hp = 0;
      let lp = 0;
      const w = Math.random() * 2 - 1;
      hp = w - hp * 0.72; // crude band shaping
      lp += (hp - lp) * 0.28;
      const env = Math.pow(Math.sin((Math.PI * t) / 0.24), 2);
      return lp * env * 0.9;
    });
    this.mk('shellTink', 0.16, (t) => {
      return (Math.sin(Math.PI * 2 * 5300 * t) * Math.exp(-t * 85) * 0.3 +
        Math.sin(Math.PI * 2 * 6700 * t) * Math.exp(-t * 110) * 0.2) * 0.55;
    });
    this.mk('impact', 0.2, (t) => {
      let lp = 0;
      lp += ((Math.random() * 2 - 1) - lp) * 0.09;
      const grit = lp * Math.exp(-t * 30) * 0.9;
      const thump = Math.sin(Math.PI * 2 * 150 * t) * Math.exp(-t * 48) * 0.45;
      return (grit + thump) * 0.8;
    });
    this.mk('hurt', 0.3, (t) => {
      const thump = Math.sin(Math.PI * 2 * 78 * t) * Math.exp(-t * 20) * 0.9;
      let lp = 0;
      lp += ((Math.random() * 2 - 1) - lp) * 0.05;
      const rush = lp * Math.exp(-t * 22) * 0.7;
      const saw = (2 * (((110 - t * 140) * t) % 1) - 1) * Math.exp(-t * 16) * 0.22;
      return Math.tanh((thump + rush + saw) * 1.3) * 0.8;
    });
    this.mk('heart', 0.62, (t) => {
      const lub = Math.sin(Math.PI * 2 * 54 * t) * Math.exp(-t * 26) * 1.0;
      let dub = 0;
      if (t > 0.24) {
        const tt = t - 0.24;
        dub = Math.sin(Math.PI * 2 * 48 * tt) * Math.exp(-tt * 30) * 0.7;
      }
      return (lub + dub) * 0.9;
    });
    this.mk('rumble', 2.6, (t) => {
      const env = Math.pow(Math.sin((Math.PI * t) / 2.6), 2);
      const drone = Math.sin(Math.PI * 2 * 37 * t) * 0.6;
      let lp = 0;
      lp += ((Math.random() * 2 - 1) - lp) * 0.02;
      return (drone + lp * 0.8) * env * 0.6;
    });
    this.mk('blip', 0.09, (t) => {
      return Math.sin(Math.PI * 2 * 1400 * t) * Math.exp(-t * 55) * 0.3;
    });

    // --- ambience loop -------------------------------------------------------
    this.mk('ambience', 6, (t, _i, _sr) => {
      let lp = 0;
      lp += ((Math.random() * 2 - 1) - lp) * 0.012;
      const gust = 0.55 + 0.45 * Math.sin((Math.PI * 2 * t) / 6 * 1.3 + 1.2);
      return lp * gust;
    });

    // --- bodycam chrome ------------------------------------------------------
    this.mk('recBeep', 0.55, (t) => {
      const b1 = t < 0.1 ? Math.sin(Math.PI * 2 * 920 * t) * Math.exp(-t * 30) : 0;
      const t2 = t - 0.22;
      const b2 = t2 > 0 && t2 < 0.1 ? Math.sin(Math.PI * 2 * 1240 * t2) * Math.exp(-t2 * 30) : 0;
      const hiss = (Math.random() * 2 - 1) * 0.05 * Math.min(1, t * 14) * Math.exp(-t * 4);
      return (b1 + b2) * 0.5 + hiss;
    });
    this.mk('static', 0.5, (t) => {
      // telecom dropout: gated white noise with sparse pops
      const gate = Math.sin(Math.PI * 2 * 23 * t) > -0.25 ? 1 : 0.12;
      const n = Math.random() * 2 - 1;
      const pop = Math.random() < 0.003 ? (Math.random() * 2 - 1) * 0.8 : 0;
      return (n * 0.55 * gate + pop) * Math.exp(-Math.max(0, t - 0.44) * 30);
    });
    this.mk('torchClick', 0.08, (t) => {
      const down = (Math.random() * 2 - 1) * Math.exp(-t * 190) * 0.8;
      const up = t > 0.032 ? (Math.random() * 2 - 1) * Math.exp(-(t - 0.032) * 170) * 0.5 : 0;
      return (down + up) * 0.8;
    });

    // --- fire crackle loop (stateful synthesis, bypasses mk) ------------------
    const sr = ctx.sampleRate;
    const fireLen = Math.floor(sr * 3.2);
    const fireBuf = ctx.createBuffer(1, fireLen, sr);
    const fd = fireBuf.getChannelData(0);
    let flp = 0;
    let popV = 0;
    let popDecay = 0.9;
    let popLen = 0;
    let nextPop = 0.04;
    for (let i = 0; i < fireLen; i++) {
      const t = i / sr;
      flp += ((Math.random() * 2 - 1) - flp) * 0.014;
      let v = flp * 1.5;
      if (t >= nextPop) {
        popV = (Math.random() * 2 - 1) * (0.5 + Math.random() * 0.8);
        popDecay = Math.exp(-(Math.random() * 6 + 3));
        popLen = 0.012 + Math.random() * 0.05;
        nextPop = t + 0.02 + Math.random() * 0.16;
      }
      if (popLen > 0) {
        v += popV * (Math.random() * 2 - 1) * 0.9;
        popV *= popDecay;
        popLen -= 1 / sr;
      }
      const seam = Math.min(1, t / 0.02) * Math.min(1, (3.2 - t) / 0.02);
      fd[i] = Math.tanh(v * 0.9) * seam * 0.6;
    }
    this.buffers.set('fire', fireBuf);
  }

  // --------------------------------------------------------------- playback
  private playBuffer(
    buf: AudioBuffer,
    opts: { gain?: number; rate?: number; pan?: number; wet?: number; pos?: THREE.Vector3; loop?: boolean } = {},
  ): AudioBufferSourceNode | null {
    if (!this.ctx || !this.master) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = opts.loop === true;
    src.playbackRate.value = opts.rate ?? 1;

    const g = ctx.createGain();
    g.gain.value = opts.gain ?? 1;

    let out: AudioNode = g;
    if (opts.pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 2.5;
      p.rolloffFactor = 1.35;
      p.maxDistance = 75;
      if (p.positionX) {
        p.positionX.value = opts.pos.x;
        p.positionY.value = opts.pos.y;
        p.positionZ.value = opts.pos.z;
      } else {
        (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(opts.pos.x, opts.pos.y, opts.pos.z);
      }
      g.connect(p);
      out = p;
    } else if (opts.pan !== undefined) {
      const sp = ctx.createStereoPanner();
      sp.pan.value = opts.pan;
      g.connect(sp);
      out = sp;
    }
    out.connect(this.master);
    if (opts.wet && this.convolver) {
      const wg = ctx.createGain();
      wg.gain.value = opts.wet;
      g.connect(wg);
      wg.connect(this.convolver);
    }
    src.connect(g);
    src.onended = () => {
      try {
        src.disconnect();
        g.disconnect();
      } catch {
        /* already torn down */
      }
    };
    src.start();
    return src;
  }

  private playLoop(buf: AudioBuffer, opts: Parameters<SFX['playBuffer']>[1]): void {
    this.playBuffer(buf, { ...opts, loop: true });
  }

  private randBuf(prefix: string, count: number): AudioBuffer {
    return this.buffers.get(`${prefix}${Math.floor(Math.random() * count)}`) as AudioBuffer;
  }

  // ------------------------------------------------------------ world hooks
  shot(): void {
    this.playBuffer(this.randBuf('shot', 3), { gain: 0.5, rate: 0.96 + Math.random() * 0.08, wet: 0.34 });
  }

  distantShot(pos: THREE.Vector3): void {
    this.playBuffer(this.randBuf('dshot', 3), {
      gain: 0.85,
      rate: 0.94 + Math.random() * 0.1,
      pos,
    });
  }

  footstep(sprinting: boolean): void {
    this.playBuffer(this.randBuf('step', 4), {
      gain: sprinting ? 0.4 : 0.28,
      rate: 0.9 + Math.random() * 0.2,
      wet: 0.08,
    });
  }

  reload(stage: 'release' | 'out' | 'in' | 'bolt1' | 'bolt2'): void {
    const gains = { release: 0.42, out: 0.4, in: 0.52, bolt1: 0.4, bolt2: 0.48 } as const;
    const key = { release: 'magRelease', out: 'magOut', in: 'magIn', bolt1: 'bolt1', bolt2: 'bolt2' } as const;
    this.playBuffer(this.buffers.get(key[stage]) as AudioBuffer, { gain: gains[stage], wet: 0.18 });
  }

  dryFire(): void {
    this.playBuffer(this.buffers.get('dryFire') as AudioBuffer, { gain: 0.5 });
  }

  hitmarker(): void {
    this.playBuffer(this.buffers.get('hitmark') as AudioBuffer, { gain: 0.5 });
  }

  killConfirm(): void {
    this.playBuffer(this.buffers.get('kill') as AudioBuffer, { gain: 0.42 });
  }

  whiz(pos: THREE.Vector3): void {
    const src = this.playBuffer(this.buffers.get('whiz') as AudioBuffer, {
      gain: 0.5,
      pos,
    });
    if (src) {
      const now = this.audio.currentTime;
      src.playbackRate.setValueAtTime(1.5, now);
      src.playbackRate.linearRampToValueAtTime(0.65, now + 0.22);
    }
  }

  shellTink(pos: THREE.Vector3): void {
    this.playBuffer(this.buffers.get('shellTink') as AudioBuffer, { gain: 0.28, pos });
  }

  impact(pos: THREE.Vector3): void {
    this.playBuffer(this.buffers.get('impact') as AudioBuffer, { gain: 0.5, pos });
  }

  hurt(): void {
    this.playBuffer(this.buffers.get('hurt') as AudioBuffer, { gain: 0.75, wet: 0.2 });
  }

  heartbeat(): void {
    this.playBuffer(this.buffers.get('heart') as AudioBuffer, { gain: 0.85 });
  }

  rumble(): void {
    this.playBuffer(this.buffers.get('rumble') as AudioBuffer, { gain: 0.5, wet: 0.5 });
  }

  blip(): void {
    this.playBuffer(this.buffers.get('blip') as AudioBuffer, { gain: 0.4 });
  }

  /** recording starts: double beep + a burst of camera static */
  recStart(): void {
    this.playBuffer(this.buffers.get('recBeep') as AudioBuffer, { gain: 0.55 });
    this.playBuffer(this.buffers.get('static') as AudioBuffer, { gain: 0.3 });
  }

  staticBurst(): void {
    this.playBuffer(this.buffers.get('static') as AudioBuffer, { gain: 0.55, wet: 0.15 });
  }

  torchClick(): void {
    this.playBuffer(this.buffers.get('torchClick') as AudioBuffer, { gain: 0.45 });
  }

  /** spatialised crackle loops for every fire in the yard (once) */
  startFireLoops(positions: THREE.Vector3[]): void {
    if (this.fireLoopsStarted) return;
    this.fireLoopsStarted = true;
    const buf = this.buffers.get('fire') as AudioBuffer;
    if (!buf) return;
    for (const p of positions) {
      this.playLoop(buf, { gain: 0.42, wet: 0.2, pos: p, rate: 0.9 + Math.random() * 0.25 });
    }
  }
  private fireLoopsStarted = false;

  // -------------------------------------------------------------- listener
  private tmpPos = new THREE.Vector3();
  private tmpFwd = new THREE.Vector3();
  private tmpUp = new THREE.Vector3();

  updateListener(camera: THREE.Camera): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    camera.getWorldPosition(this.tmpPos);
    this.tmpFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.tmpUp.set(0, 1, 0).applyQuaternion(camera.quaternion);

    if (l.positionX) {
      const now = this.audio.currentTime;
      l.positionX.linearRampToValueAtTime(this.tmpPos.x, now + 0.02);
      l.positionY.linearRampToValueAtTime(this.tmpPos.y, now + 0.02);
      l.positionZ.linearRampToValueAtTime(this.tmpPos.z, now + 0.02);
      l.forwardX.value = this.tmpFwd.x;
      l.forwardY.value = this.tmpFwd.y;
      l.forwardZ.value = this.tmpFwd.z;
      l.upX.value = this.tmpUp.x;
      l.upY.value = this.tmpUp.y;
      l.upZ.value = this.tmpUp.z;
    } else {
      const legacy = l as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void;
      };
      legacy.setPosition(this.tmpPos.x, this.tmpPos.y, this.tmpPos.z);
      legacy.setOrientation(this.tmpFwd.x, this.tmpFwd.y, this.tmpFwd.z, this.tmpUp.x, this.tmpUp.y, this.tmpUp.z);
    }
  }
}
