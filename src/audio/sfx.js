// Звук матча, целиком синтезированный в WebAudio (записанных сэмплов в проекте нет).
// Палитра — как в футбольной трансляции: глухой удар по мячу со шлепком кожи, шелест сетки, звон штанги, стук борта,
// дребезг рабицы, свисток, шаги по газону, шорох подката, гул двора и реакция зрителей на гол и на штангу.
// События приходят только от физических контактов симуляции; k — сила 0..1, pan — положение по ширине кадра −1..1.
export class Sfx {
  constructor() { this.ctx = null; this._vol = 0.8; this.musicVolume = 0.5; this._amb = null; }

  get volume() { return this._vol; }
  set volume(v) { this._vol = v; if (this.master) this.master.gain.value = v; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC(), sr = c.sampleRate;
    // общий тракт: громкость → компрессор (громкий удар не клиппирует, тихие шаги слышны) → выход
    this.master = c.createGain(); this.master.gain.value = this._vol;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp).connect(c.destination);
    // белый шум — материал для шлепков, шороха и толпы
    const len = Math.floor(sr * 2), buf = c.createBuffer(1, len, sr), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // отзвук двора: короткое эхо от стен домов (затухающий шум вместо записанного импульса)
    const rl = Math.floor(sr * 0.9), ir = c.createBuffer(2, rl, sr);
    for (let ch = 0; ch < 2; ch++) { const x = ir.getChannelData(ch); for (let i = 0; i < rl; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2) * (i < sr * 0.012 ? 0.2 : 1); }
    this.rev = c.createConvolver(); this.rev.buffer = ir;
    const rg = c.createGain(); rg.gain.value = 0.5; this.rev.connect(rg).connect(this.master);
    this._ambience();
  }

  // выход одного звука: панорама и доля отзвука
  _out(pan = 0, wet = 0.15) {
    const c = this.ctx, g = c.createGain();
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p).connect(this.master); } else g.connect(this.master);
    if (wet > 0) { const s = c.createGain(); s.gain.value = wet; (p || g).connect(s).connect(this.rev); }
    return g;
  }

  // тон с падением (или подъёмом) частоты и затуханием
  _tone(out, f0, f1, dur, gain, type = 'sine', delay = 0, attack = 0.002) {
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.03);
  }

  // шум через фильтр; f1 — частота в конце (фильтр «едет»), attack — нарастание
  _noise(out, dur, gain, f0, q = 1, type = 'bandpass', delay = 0, f1 = 0, attack = 0.002) {
    const c = this.ctx, t = c.currentTime + delay, s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.Q.value = q;
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.03);
  }

  // голоса: шум через три форманты — «о-о-о» зрителей; rise и fall — нарастание и спад, с
  _crowd(out, dur, gain, rise, fall, bright = 1, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    for (const [f, q, a] of [[520, 1.6, 1], [1150 * bright, 2.2, 0.55], [2500 * bright, 2.5, 0.22]]) {
      const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(f * 0.85, t); bp.frequency.linearRampToValueAtTime(f, t + rise); bp.Q.value = q;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * a, t + rise);
      g.gain.setValueAtTime(gain * a, t + Math.max(rise, dur - fall)); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      s.connect(bp).connect(g).connect(out); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    }
  }

  // свисток: тон с быстрой трелью (горошина) и призвуком воздуха
  _whistle(out, dur, gain, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), l = c.createOscillator(), lg = c.createGain(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(2850, t); o.frequency.linearRampToValueAtTime(2950, t + 0.04);
    l.frequency.value = 38; lg.gain.value = 90; l.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.015); g.gain.setValueAtTime(gain, t + dur - 0.04); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out); o.start(t); l.start(t); o.stop(t + dur + 0.03); l.stop(t + dur + 0.03);
    this._noise(out, dur, gain * 0.25, 3200, 3, 'bandpass', delay, 0, 0.01);
  }

  // гул двора: далёкий город и негромкие голоса за сеткой; идёт всё время, пока есть звук
  _ambience() {
    const c = this.ctx, mk = (f, q, type, gain, lfoHz) => {
      const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const bq = c.createBiquadFilter(); bq.type = type; bq.frequency.value = f; bq.Q.value = q;
      const g = c.createGain(); g.gain.value = gain;
      if (lfoHz) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = lfoHz; lg.gain.value = gain * 0.45; l.connect(lg).connect(g.gain); l.start(); }
      s.connect(bq).connect(g).connect(this.master); s.start(0, Math.random());
    };
    mk(180, 0.5, 'lowpass', 0.07, 0.07); // город
    mk(600, 1.2, 'bandpass', 0.02, 0.11); mk(1300, 1.8, 'bandpass', 0.01, 0.17); // голоса
  }

  play(name, k = 0.5, pan = 0) {
    if (!this.ctx || this._vol <= 0) return;
    k = Math.max(0, Math.min(1, k));
    const N = (o, ...a) => this._noise(o, ...a), T = (o, ...a) => this._tone(o, ...a);
    switch (name) {
      case 'kick': { // глухой удар корпуса мяча, шлепок кожи, выдох воздуха; чем сильнее, тем ниже и длиннее
        const o = this._out(pan, 0.12 + 0.2 * k);
        T(o, 150 - 40 * k, 48, 0.13 + 0.07 * k, 0.55 + 0.45 * k);
        T(o, 300, 110, 0.035, 0.25 + 0.2 * k, 'triangle');
        N(o, 0.03 + 0.02 * k, 0.3 + 0.35 * k, 1500 + 700 * k, 0.9);
        N(o, 0.09, 0.05 + 0.1 * k, 4200, 0.7, 'highpass', 0.005);
        break;
      }
      case 'touch': { const o = this._out(pan, 0.05); T(o, 175, 105, 0.05, 0.22); N(o, 0.022, 0.1, 1100, 0.8, 'lowpass'); break; } // касание в ведении: мягкий тычок
      case 'receive': { const o = this._out(pan, 0.06); T(o, 120, 68, 0.1, 0.3); N(o, 0.06, 0.1, 480, 0.7, 'lowpass'); break; } // чистый приём: мяч «прилип»
      case 'receive_bad': { const o = this._out(pan, 0.08); T(o, 210, 120, 0.06, 0.28, 'triangle'); N(o, 0.035, 0.2, 1900, 1); break; } // жёсткий отскок от стопы
      case 'body': { const o = this._out(pan, 0.08); T(o, 105, 55, 0.11, 0.3 + 0.35 * k); N(o, 0.05, 0.06 + 0.12 * k, 380, 0.8, 'lowpass'); break; } // мяч в корпус
      case 'header': { const o = this._out(pan, 0.08); T(o, 260, 150, 0.04, 0.3); T(o, 120, 70, 0.09, 0.3); N(o, 0.03, 0.12, 900, 1); break; }
      case 'bounce': { const o = this._out(pan, 0.06); T(o, 135, 72, 0.06, 0.1 + 0.3 * k); N(o, 0.03, 0.04 + 0.1 * k, 650, 0.8, 'lowpass'); break; } // отскок от газона
      case 'wall': { // борт: короткий жёсткий стук с отзвуком двора
        const o = this._out(pan, 0.3);
        T(o, 190, 85, 0.1, 0.3 + 0.45 * k, 'triangle'); N(o, 0.07, 0.15 + 0.3 * k, 750, 2);
        N(o, 0.02, 0.1 + 0.15 * k, 2600, 1);
        break;
      }
      case 'fence': { // рабица: звяканье и затихающий дребезг
        const o = this._out(pan, 0.25);
        for (const [f, d] of [[1450, 0.25], [2180, 0.2], [3320, 0.14]]) T(o, f * (0.97 + Math.random() * 0.06), f * 0.985, d, (0.05 + 0.08 * k), 'triangle');
        for (let i = 0; i < 7; i++) N(o, 0.035, (0.1 + 0.2 * k) * Math.pow(0.72, i), 3500 + Math.random() * 2500, 1.5, 'bandpass', i * 0.04 + Math.random() * 0.015);
        break;
      }
      case 'net': { // сетка ворот: мягкий удар и шелест полотна, который «оседает»
        const o = this._out(pan, 0.12);
        T(o, 95, 50, 0.12, 0.12 + 0.25 * k);
        N(o, 0.32, 0.16 + 0.22 * k, 3000, 0.6, 'bandpass', 0, 650, 0.012);
        N(o, 0.18, 0.05 + 0.08 * k, 6000, 0.7, 'highpass', 0.02);
        break;
      }
      case 'post': { // штанга: металлический звон из негармоничных призвуков, удар мяча и вздох зрителей
        const o = this._out(pan, 0.35), f = 430;
        for (const [m, d, a] of [[1, 0.9, 0.3], [2.76, 0.6, 0.2], [5.4, 0.35, 0.12], [8.93, 0.2, 0.07]]) T(o, f * m, f * m * 0.995, d * (0.6 + 0.4 * k), a * (0.5 + 0.6 * k));
        N(o, 0.02, 0.3, 2800, 1); T(o, 130, 60, 0.07, 0.3);
        this._crowd(this._out(0, 0.2), 0.9, 0.09 + 0.07 * k, 0.12, 0.6, 0.85, 0.08);
        break;
      }
      case 'slide': { const o = this._out(pan, 0.08); N(o, 0.45, 0.4, 2200, 0.6, 'bandpass', 0, 600, 0.03); N(o, 0.3, 0.2, 300, 0.7, 'lowpass', 0, 0, 0.04); break; } // шорох по газону
      case 'thud': { const o = this._out(pan, 0.1); T(o, 90, 45, 0.14, 0.25 + 0.35 * k); N(o, 0.08, 0.08 + 0.12 * k, 320, 0.7, 'lowpass'); break; } // тело на покрытие, приземление
      case 'step': { const o = this._out(pan, 0.03); N(o, 0.035, 0.025 + 0.05 * k, 900 + Math.random() * 500, 0.7, 'lowpass'); T(o, 85, 55, 0.04, 0.03 + 0.05 * k); break; } // шаг по газону
      case 'whistle': this._whistle(this._out(0, 0.3), 0.32, 0.24); break;
      case 'goal': { // гол: сетка уже прозвучала; двойной свисток и крик зрителей с долгим спадом
        const o = this._out(0, 0.35);
        this._crowd(o, 3.2, 0.45, 0.18, 2.2, 1.15);
        this._crowd(o, 2.4, 0.2, 0.5, 1.6, 1.5, 0.15);
        this._whistle(o, 0.22, 0.22, 0.25); this._whistle(o, 0.5, 0.22, 0.55);
        break;
      }
      case 'miss': this._crowd(this._out(0, 0.2), 1.1, 0.12, 0.15, 0.8, 0.8); break; // «у-у-у»: мимо, сорванный момент
      case 'cancel': { const o = this._out(0, 0); T(o, 200, 140, 0.09, 0.14, 'triangle'); break; }
      case 'ui': { const o = this._out(0, 0); T(o, 720, 700, 0.04, 0.08); N(o, 0.012, 0.04, 3000, 1); break; }
      default: break;
    }
  }
}
