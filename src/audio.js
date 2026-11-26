// All sounds are synthesized with Web Audio, so there are no files to load.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastKnock = 0;
  }

  // Must be called from a tap: iOS only starts audio inside a user gesture.
  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    // White noise for knocks.
    const len = Math.floor(ctx.sampleRate * 0.25);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;

    // Looping brown noise for the rolling rumble.
    const rlen = ctx.sampleRate * 2;
    const rb = ctx.createBuffer(1, rlen, ctx.sampleRate);
    const rd = rb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < rlen; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      rd[i] = last * 3.5;
    }
    const roll = ctx.createBufferSource();
    roll.buffer = rb;
    roll.loop = true;
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass';
    this.rollFilter.frequency.value = 300;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    roll.connect(this.rollFilter).connect(this.rollGain).connect(this.master);
    roll.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }

  setRoll(speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const amt = Math.min(speed / 12, 1);
    this.rollGain.gain.setTargetAtTime(amt * 0.32, t, 0.06);
    this.rollFilter.frequency.setTargetAtTime(180 + amt * 700, t, 0.06);
  }

  knock(impact) {
    if (!this.ctx || impact < 1.2) return;
    const now = performance.now();
    if (now - this.lastKnock < 45) return;
    this.lastKnock = now;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const vol = Math.min(impact / 9, 1);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100 + Math.random() * 300;
    bp.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.08);

    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.11);
  }

  tone(freq, start, dur, type = 'sine', vol = 0.25, endFreq) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + start;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  drop() {
    this.tone(520, 0, 0.45, 'sine', 0.3, 70);
    this.tone(260, 0.05, 0.4, 'triangle', 0.12, 50);
  }

  blip(high = false) {
    this.tone(high ? 880 : 520, 0, 0.12, 'square', 0.08);
  }

  flag() {
    this.tone(660, 0, 0.12, 'triangle', 0.18);
    this.tone(990, 0.08, 0.18, 'triangle', 0.18);
  }

  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, i * 0.09, 0.35, 'triangle', 0.22));
  }
}
