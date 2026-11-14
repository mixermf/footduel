// Синтезированные эффекты (WebAudio): касание, удар, приём, борт, стойка, гол.
// События звука приходят только от физических контактов симуляции.
export class Sfx {
  constructor() { this.ctx = null; this.volume = 0.8; this.musicVolume = 0.5; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    const len = Math.floor(this.ctx.sampleRate * 0.4), buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  _tone(freq, dur, gain, type = 'sine', slide = 0.5, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(gain * this.volume, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(dur, gain, freq, q = 1, type = 'bandpass') {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain * this.volume, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + dur + 0.02);
  }

  play(name, k = 0.5) {
    if (!this.ctx || this.volume <= 0) return;
    k = Math.max(0, Math.min(1, k));
    switch (name) {
      case 'touch': this._tone(190, 0.06, 0.22, 'sine', 0.6); this._noise(0.03, 0.08, 1800, 0.8); break;
      case 'kick': this._tone(150 - 50 * k, 0.14, 0.5 + 0.4 * k, 'sine', 0.35); this._noise(0.07, 0.25 + 0.3 * k, 900, 0.7); break;
      case 'receive': this._tone(120, 0.12, 0.3, 'sine', 0.7); this._noise(0.08, 0.1, 500, 0.6, 'lowpass'); break;
      case 'receive_bad': this._tone(260, 0.07, 0.3, 'triangle', 0.5); this._noise(0.05, 0.2, 2200, 1); break;
      case 'body': this._tone(110, 0.1, 0.35 + 0.3 * k, 'sine', 0.5); break;
      case 'wall': this._tone(95, 0.16, 0.3 + 0.5 * k, 'triangle', 0.6); this._noise(0.1, 0.12 + 0.2 * k, 320, 0.8, 'lowpass'); break;
      case 'net': this._noise(0.18, 0.2, 2600, 0.5); break;
      case 'post': this._tone(880, 0.5, 0.35 + 0.3 * k, 'sine', 0.98); this._tone(1320, 0.35, 0.18, 'sine', 0.99); break;
      case 'bounce': this._tone(140, 0.07, 0.12 + 0.25 * k, 'sine', 0.6); break;
      case 'goal': [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.35, 0.3, 'triangle', 1, i * 0.09)); this._noise(0.4, 0.15, 3000, 0.4); break;
      case 'cancel': this._tone(220, 0.12, 0.2, 'square', 0.6); break;
      case 'ui': this._tone(660, 0.05, 0.12, 'sine', 1); break;
      default: break;
    }
  }
}
