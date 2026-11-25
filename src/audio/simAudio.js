/**
 * Military Simulator Web Audio Engine
 * Synthesizes jet turbines, afterburner roar, supersonic shockwaves, helicopter rotor slap,
 * tank diesel/tracks, 20mm/30mm rotary cannons, 120mm smoothbore booms, IR seeker lock tones,
 * RWR missile alarms, and 3D spatialized battlefield explosions.
 */
export class SimAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.reverbBus = null;
    this.noiseBuffer = null;
    this.muted = false;

    // Continuous vehicle loops
    this.engineNodes = null;
    this.seekerNodes = null;
    this.mode = null; // 'jet' | 'heli' | 'tank' | null
    this.wasSupersonic = false;
    this.rwrCooldown = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 16;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    comp.release.value = 0.2;

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    // Outdoor canyon/valley impulse response
    const convolver = this.ctx.createConvolver();
    convolver.buffer = this._createOutdoorIR(2.2, 2.8);
    this.reverbBus = this.ctx.createGain();
    this.reverbBus.gain.value = 0.35;
    this.reverbBus.connect(convolver);
    convolver.connect(this.master);

    this.noiseBuffer = this._createNoiseBuffer(3.0);
  }

  _createNoiseBuffer(sec) {
    const len = Math.floor(this.ctx.sampleRate * sec);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _createOutdoorIR(dur, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * dur);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * 0.5;
      }
    }
    return buf;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.85;
    return this.muted;
  }

  startVehicleLoop(category) {
    this.init();
    this.stopVehicleLoop();
    this.mode = category;
    const now = this.ctx.currentTime;

    if (category === 'jet') {
      // Turbine compressor whine
      const whine = this.ctx.createOscillator();
      whine.type = 'sawtooth';
      whine.frequency.value = 1800;
      const whineBp = this.ctx.createBiquadFilter();
      whineBp.type = 'bandpass';
      whineBp.frequency.value = 2200;
      whineBp.Q.value = 4.0;
      const whineGain = this.ctx.createGain();
      whineGain.gain.value = 0.04;
      whine.connect(whineBp).connect(whineGain).connect(this.master);
      whine.start(now);

      // Broadband jet exhaust roar
      const jetNoise = this.ctx.createBufferSource();
      jetNoise.buffer = this.noiseBuffer;
      jetNoise.loop = true;
      const jetLp = this.ctx.createBiquadFilter();
      jetLp.type = 'lowpass';
      jetLp.frequency.value = 420;
      const jetGain = this.ctx.createGain();
      jetGain.gain.value = 0.16;
      jetNoise.connect(jetLp).connect(jetGain).connect(this.master);
      jetNoise.start(now);

      // Afterburner deep rumble
      const abNoise = this.ctx.createBufferSource();
      abNoise.buffer = this.noiseBuffer;
      abNoise.loop = true;
      const abLp = this.ctx.createBiquadFilter();
      abLp.type = 'lowpass';
      abLp.frequency.value = 150;
      const abGain = this.ctx.createGain();
      abGain.gain.value = 0.001;
      abNoise.connect(abLp).connect(abGain).connect(this.master);
      abNoise.start(now);

      this.engineNodes = { whine, whineBp, whineGain, jetNoise, jetLp, jetGain, abNoise, abLp, abGain };
    } else if (category === 'heli') {
      // Rotor blade-slap LFO modulating filtered noise
      const rotorNoise = this.ctx.createBufferSource();
      rotorNoise.buffer = this.noiseBuffer;
      rotorNoise.loop = true;
      const rotorLp = this.ctx.createBiquadFilter();
      rotorLp.type = 'lowpass';
      rotorLp.frequency.value = 240;
      const rotorGain = this.ctx.createGain();
      rotorGain.gain.value = 0.18;

      const lfo = this.ctx.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.value = 16;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 0.14;
      lfo.connect(lfoGain).connect(rotorGain.gain);

      rotorNoise.connect(rotorLp).connect(rotorGain).connect(this.master);
      rotorNoise.start(now);
      lfo.start(now);

      const shaft = this.ctx.createOscillator();
      shaft.type = 'sawtooth';
      shaft.frequency.value = 420;
      const shaftGain = this.ctx.createGain();
      shaftGain.gain.value = 0.025;
      shaft.connect(shaftGain).connect(this.master);
      shaft.start(now);

      this.engineNodes = { rotorNoise, rotorLp, rotorGain, lfo, lfoGain, shaft, shaftGain };
    } else if (category === 'tank') {
      const diesel = this.ctx.createOscillator();
      diesel.type = 'sawtooth';
      diesel.frequency.value = 46;
      const dieselLp = this.ctx.createBiquadFilter();
      dieselLp.type = 'lowpass';
      dieselLp.frequency.value = 170;
      const dieselGain = this.ctx.createGain();
      dieselGain.gain.value = 0.16;
      diesel.connect(dieselLp).connect(dieselGain).connect(this.master);
      diesel.start(now);

      const tracks = this.ctx.createBufferSource();
      tracks.buffer = this.noiseBuffer;
      tracks.loop = true;
      const tracksBp = this.ctx.createBiquadFilter();
      tracksBp.type = 'bandpass';
      tracksBp.frequency.value = 340;
      tracksBp.Q.value = 1.6;
      const tracksGain = this.ctx.createGain();
      tracksGain.gain.value = 0.001;
      tracks.connect(tracksBp).connect(tracksGain).connect(this.master);
      tracks.start(now);

      this.engineNodes = { diesel, dieselLp, dieselGain, tracks, tracksBp, tracksGain };
    }
  }

  stopVehicleLoop() {
    if (!this.engineNodes) return;
    for (const n of Object.values(this.engineNodes)) {
      try {
        if (n && typeof n.stop === 'function') n.stop();
        if (n && typeof n.disconnect === 'function') n.disconnect();
      } catch {}
    }
    this.engineNodes = null;
    this.stopSeeker();
    this.mode = null;
  }

  updateVehicleLoop(dt, state) {
    if (!this.ctx || !this.engineNodes) return;
    if (this.rwrCooldown > 0) this.rwrCooldown -= dt;

    if (this.mode === 'jet') {
      const { throttle = 0.5, mach = 0.4, afterburner = false, cockpitView = false } = state;
      const intScale = cockpitView ? 0.45 : 1.0;
      this.engineNodes.whine.frequency.value = 1450 + throttle * 1600;
      this.engineNodes.whineGain.gain.value = (0.025 + throttle * 0.04) * intScale;
      this.engineNodes.jetLp.frequency.value = 260 + throttle * 750 + mach * 220;
      this.engineNodes.jetGain.gain.value = (0.1 + throttle * 0.22) * intScale;
      this.engineNodes.abGain.gain.value = (afterburner ? 0.34 : 0.001) * intScale;

      const supersonic = mach >= 1.0;
      if (supersonic && !this.wasSupersonic) {
        this.playSonicBoom();
      }
      this.wasSupersonic = supersonic;
    } else if (this.mode === 'heli') {
      const { collective = 0.5, speedRatio = 0 } = state;
      this.engineNodes.lfo.frequency.value = 15 + collective * 5;
      this.engineNodes.rotorGain.gain.value = 0.14 + collective * 0.12 + speedRatio * 0.06;
      this.engineNodes.shaft.frequency.value = 390 + collective * 110;
    } else if (this.mode === 'tank') {
      const { throttle = 0, speedRatio = 0 } = state;
      this.engineNodes.diesel.frequency.value = 42 + Math.abs(throttle) * 34 + speedRatio * 18;
      this.engineNodes.dieselGain.gain.value = 0.12 + Math.abs(throttle) * 0.11;
      this.engineNodes.tracksGain.gain.value = speedRatio * 0.14;
    }
  }

  updateListener(pos, fwd, up) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x;
      l.forwardY.value = fwd.y;
      l.forwardZ.value = fwd.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    }
  }

  _makePanner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 35;
    p.maxDistance = 3200;
    p.rolloffFactor = 1.1;
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    }
    return p;
  }

  playSonicBoom() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.75, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.4);

    const crack = this.ctx.createBufferSource();
    crack.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    const cg = this.ctx.createGain();
    cg.gain.setValueAtTime(0.55, now);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    crack.connect(lp).connect(cg).connect(this.reverbBus);
    crack.start(now);
    crack.stop(now + 0.26);
  }

  playJetFlyby(worldPos) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const pan = this._makePanner(worldPos);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, now);
    bp.frequency.exponentialRampToValueAtTime(220, now + 0.9);
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.01, now);
    g.gain.linearRampToValueAtTime(0.55, now + 0.22);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
    src.connect(bp).connect(g).connect(pan).connect(this.master);
    src.start(now);
    src.stop(now + 1.0);
  }

  playRotaryCannonShot(heavy30mm = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(heavy30mm ? 115 : 175, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.045);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(heavy30mm ? 0.28 : 0.2, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.055);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = heavy30mm ? 900 : 1400;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.22, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    noise.connect(bp).connect(ng).connect(this.master);
    noise.start(now);
    noise.stop(now + 0.045);
  }

  playTankCannon(worldPos = null) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const dest = worldPos ? this._makePanner(worldPos) : null;
    if (dest) dest.connect(this.master);

    // 120mm sub boom
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(125, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + 0.42);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.95, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(og).connect(dest || this.master);
    osc.start(now);
    osc.stop(now + 0.46);

    // Propellant crack + canyon echo
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1600, now);
    lp.frequency.exponentialRampToValueAtTime(210, now + 0.55);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.9, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    src.connect(lp).connect(ng);
    ng.connect(dest || this.master);
    ng.connect(this.reverbBus);
    src.start(now);
    src.stop(now + 0.62);

    // Metallic breech clang if player shot
    if (!worldPos) {
      const clank = this.ctx.createOscillator();
      clank.type = 'triangle';
      clank.frequency.setValueAtTime(840, now + 0.08);
      clank.frequency.exponentialRampToValueAtTime(320, now + 0.16);
      const cg = this.ctx.createGain();
      cg.gain.setValueAtTime(0.2, now + 0.08);
      cg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      clank.connect(cg).connect(this.master);
      clank.start(now + 0.08);
      clank.stop(now + 0.19);
    }
  }

  playMissileLaunch() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(620, now);
    bp.frequency.exponentialRampToValueAtTime(1900, now + 0.35);
    bp.Q.value = 0.85;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.65, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.72);
    src.connect(bp).connect(g).connect(this.master);
    g.connect(this.reverbBus);
    src.start(now);
    src.stop(now + 0.75);
  }

  playFlareDeploy() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.07;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.32, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      src.connect(hp).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + 0.12);
    }
  }

  playExplosion(worldPos, large = true) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const pan = worldPos ? this._makePanner(worldPos) : null;
    if (pan) pan.connect(this.master);

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(large ? 85 : 130, now);
    osc.frequency.exponentialRampToValueAtTime(18, now + (large ? 0.9 : 0.45));
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(large ? 1.0 : 0.65, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + (large ? 0.95 : 0.48));
    osc.connect(og).connect(pan || this.master);
    osc.start(now);
    osc.stop(now + (large ? 1.0 : 0.5));

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(large ? 920 : 1200, now);
    lp.frequency.exponentialRampToValueAtTime(110, now + (large ? 1.2 : 0.55));
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(large ? 0.9 : 0.55, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + (large ? 1.25 : 0.6));
    src.connect(lp).connect(ng);
    ng.connect(pan || this.master);
    ng.connect(this.reverbBus);
    src.start(now);
    src.stop(now + (large ? 1.3 : 0.62));
  }

  setSeekerState(state) {
    // 'off' | 'growl' | 'locked'
    if (!this.ctx) return;
    if (state === 'off') {
      this.stopSeeker();
      return;
    }
    if (!this.seekerNodes) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 950;
      bp.Q.value = 3.0;
      const g = this.ctx.createGain();
      g.gain.value = 0.045;
      osc.connect(bp).connect(g).connect(this.master);
      osc.start();
      this.seekerNodes = { osc, bp, g };
    }
    if (state === 'locked') {
      this.seekerNodes.osc.frequency.value = 1280;
      this.seekerNodes.bp.frequency.value = 1280;
      this.seekerNodes.g.gain.value = 0.065;
    } else {
      this.seekerNodes.osc.frequency.value = 390 + Math.sin(performance.now() * 0.025) * 45;
      this.seekerNodes.bp.frequency.value = 600;
      this.seekerNodes.g.gain.value = 0.035;
    }
  }

  stopSeeker() {
    if (!this.seekerNodes) return;
    try {
      this.seekerNodes.osc.stop();
      this.seekerNodes.osc.disconnect();
    } catch {}
    this.seekerNodes = null;
  }

  playRWRAlert() {
    if (!this.ctx || this.rwrCooldown > 0) return;
    this.rwrCooldown = 0.42;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1650, now);
    osc.frequency.setValueAtTime(2150, now + 0.08);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.065, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.19);
  }
}
