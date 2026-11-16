// Комната матча: два места, авторитетная симуляция, очереди ввода, рассылка состояния.
// Не зависит от транспорта: соединение — любой объект с send(string) и close().
import { randomBytes } from 'node:crypto';
import { World, unpackInput, emptyInput } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';
import {
  NET_VERSION, SNAP_EVERY, MAX_BUF, STARVE_TICKS, EDGE_BITS, COUNTDOWN_MS, RESUME_MS, REJOIN_MS, WIRE_EVENTS, SHIRT_NUMBERS, sanitizeFrame,
} from '../src/net/protocol.js';

const MAX_QUEUE = 240, MAX_BATCH = 64, MAX_STEPS = 24, EMPTY_ROOM_MS = 60000;

function cleanName(v, fallback) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return s || fallback;
}

export class Room {
  constructor(code, seed = (randomBytes(2).readUInt16LE(0) || 1)) {
    this.code = code;
    this.world = new World(createProfile(), { seed, duel: true });
    this.world.recording = false;
    this.tickMs = 1000 / this.world.P.simHz;
    this.slots = [null, null];
    this.state = 'waiting'; // waiting → loading → countdown → play ⇄ paused → over
    this.timer = 0; this.acc = 0; this.emptyMs = 0; this.closed = false;
    this.events = [];
    this._in = [emptyInput(), emptyInput()];
  }

  get count() { return (this.slots[0] ? 1 : 0) + (this.slots[1] ? 1 : 0); }
  get inMatch() { return this.state === 'countdown' || this.state === 'play' || this.state === 'paused'; }

  // ---------- вход и выход ----------
  join(conn, name) {
    const i = this.slots[0] ? (this.slots[1] ? -1 : 1) : 0;
    if (i < 0 || this.inMatch) return -1;
    this.slots[i] = {
      conn, name: cleanName(name, i ? 'Гость' : 'Хозяин'), token: randomBytes(12).toString('hex'),
      num: 0, connected: true, ready: false, rematch: false, queue: [], seq: 0, recv: 0, last: [0, 0, 1], starve: 0, hold: false,
    };
    this._send(i, { t: 'joined', v: NET_VERSION, code: this.code, you: i, token: this.slots[i].token, hz: this.world.P.simHz });
    if (this.count === 2 && this.state === 'waiting') this.state = 'loading';
    this._lobby();
    return i;
  }

  rejoin(conn, token, seq) {
    const i = this.slots.findIndex((s) => s && s.token === token);
    if (i < 0) return -1;
    const s = this.slots[i];
    if (s.connected && s.conn) { try { s.conn.close(); } catch { /* уже закрыто */ } }
    s.conn = conn; s.connected = true; s.queue.length = 0; s.starve = 0; s.hold = false;
    s.seq = s.recv = Math.max(0, Number(seq) | 0);
    s.last = [0, 0, 1];
    this._send(i, { t: 'joined', v: NET_VERSION, code: this.code, you: i, token: s.token, hz: this.world.P.simHz });
    if (this.state === 'paused' && this.slots.every((x) => x && x.connected)) { this.intro = false; this._countdown(RESUME_MS); }
    else this._lobby();
    this._snapshot();
    return i;
  }

  // explicit — игрок сам вышел; иначе обрыв связи: в матче место держится до REJOIN_MS
  drop(i, conn, explicit) {
    const s = this.slots[i];
    if (!s || (conn && s.conn !== conn)) return;
    if (this.inMatch && !explicit) {
      s.connected = false; s.conn = null; s.queue.length = 0;
      this.state = 'paused'; this.timer = REJOIN_MS;
      this._lobby();
      return;
    }
    const wasMatch = this.inMatch;
    this.slots[i] = null;
    if (wasMatch) { this.close('opponent_left'); return; }
    if (this.count === 0) { this.closed = true; return; }
    this.state = 'waiting';
    for (const o of this.slots) if (o) o.rematch = false;
    this._lobby();
  }

  close(reason) {
    if (this.closed) return;
    this.closed = true;
    for (let i = 0; i < 2; i++) this._send(i, { t: 'closed', reason });
  }

  // ---------- сообщения ----------
  message(i, m) {
    const s = this.slots[i];
    if (!s) return;
    switch (m.t) {
      case 'ready':
        s.ready = true;
        if (this.state === 'loading' && this.slots.every((x) => x && x.ready)) this._startMatch();
        else this._lobby();
        break;
      case 'in': {
        if (this.state !== 'play' || !Array.isArray(m.f) || m.f.length > MAX_BATCH) break;
        let seq = Number(m.s) | 0;
        for (const raw of m.f) {
          const f = sanitizeFrame(raw);
          if (!f) return;
          if (seq > s.recv) { // повторно присланные кадры пропускаются
            s.recv = seq; s.queue.push(f);
            if (s.queue.length > MAX_QUEUE) { s.queue.shift(); s.seq++; }
          }
          seq++;
        }
        break;
      }
      case 'hold':
        // окно клиента скрыто: состояния ему не шлём (иначе они копятся и проигрываются потом разом), ввод отпущен
        s.hold = true; s.queue.length = 0; s.seq = s.recv; s.last = [0, 0, 1];
        break;
      case 'sync':
        // клиент вернулся или заметил длинный простой: всё прежнее забыто, дальше — только свежее состояние
        s.hold = false; s.queue.length = 0; s.seq = s.recv; s.last = [0, 0, 1]; s.starve = 0;
        this._send(i, { t: 'synced', n: Number(m.n) | 0 });
        this._snapshot(i);
        break;
      case 'rematch':
        if (this.state !== 'over') break;
        s.rematch = true;
        if (this.slots.every((x) => x && x.rematch)) this._startMatch(); else this._lobby();
        break;
      case 'ping': this._send(i, { t: 'pong', c: Number(m.c) || 0 }); break;
      case 'leave': this.drop(i, null, true); break;
      default: break;
    }
  }

  _startMatch() {
    const w = this.world;
    w.seed = this.fixedSeed || randomBytes(2).readUInt16LE(0) || 1; // fixedSeed — только для тестов: кто вводит мяч, зависит от seed
    w.reset('duel');
    for (const s of this.slots) { s.rematch = false; s.queue.length = 0; s.last = [0, 0, 1]; s.starve = 0; s.seq = s.recv; }
    // номера на спине: разные у двух игроков, одни и те же на весь матч и реванши
    if (!this.slots[0].num || !this.slots[1].num) {
      const pool = [...SHIRT_NUMBERS];
      for (const s of this.slots) s.num = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    }
    this.events.length = 0;
    this.intro = true; // перед началом матча клиенты показывают сцену выхода
    this._countdown(COUNTDOWN_MS);
    this._snapshot();
  }

  _countdown(ms) { this.state = 'countdown'; this.timer = ms; this.acc = 0; this._lobby(); }

  // ---------- время ----------
  update(dtMs) {
    if (this.closed) return;
    if (!this.slots.some((s) => s && s.connected)) {
      this.emptyMs += dtMs;
      if (this.emptyMs > EMPTY_ROOM_MS) { this.closed = true; return; }
    } else this.emptyMs = 0;

    if (this.state === 'countdown') {
      this.timer -= dtMs;
      if (this.timer <= 0) { this.state = 'play'; this.acc = 0; this._lobby(); }
    } else if (this.state === 'paused') {
      this.timer -= dtMs;
      if (this.timer <= 0) this.close('opponent_timeout');
    } else if (this.state === 'play') {
      this.acc += dtMs;
      let n = 0;
      while (this.acc >= this.tickMs && n < MAX_STEPS && this.state === 'play') { this._step(); this.acc -= this.tickMs; n++; }
      if (n === MAX_STEPS) this.acc = 0; // сервер не успевал: время теряется, симуляция не догоняет рывком
    }
  }

  _take(s, out) {
    const q = s.queue;
    if (s.hold) { s.last = [0, 0, 1]; return unpackInput(s.last, out); }
    if (q.length) {
      let f = q.shift(); s.seq++;
      while (q.length > MAX_BUF) { const n = q.shift(); s.seq++; n[2] |= f[2] & EDGE_BITS; f = n; } // сжатие очереди без потери нажатий
      s.last = f; s.starve = 0;
    } else {
      // ввод не пришёл вовремя: удержания сохраняются, нажатия не повторяются; долгий простой — всё отпущено
      s.starve++;
      s.last = s.starve > STARVE_TICKS ? [0, 0, 1] : [s.last[0], s.last[1], s.last[2] & ~EDGE_BITS];
    }
    return unpackInput(s.last, out);
  }

  _step() {
    const w = this.world;
    w.step(this._take(this.slots[0], this._in[0]), this._take(this.slots[1], this._in[1]));
    for (const e of w.events) {
      if (!WIRE_EVENTS.has(e.type)) continue;
      if (e.error) e.error = undefined;
      this.events.push(e);
    }
    if (w.phase === 'over') { this.state = 'over'; this._snapshot(); this._lobby(); }
    else if (w.tick % SNAP_EVERY === 0) this._snapshot();
  }

  // ---------- рассылка ----------
  // only — номер места для внеочередной отправки одному клиенту (без событий: они уйдут в общей рассылке)
  _snapshot(only = -1) {
    const w = this.world, st = w.saveState();
    st.stats = undefined;
    const body = '"i":' + JSON.stringify([this.slots[0]?.last ?? [0, 0, 1], this.slots[1]?.last ?? [0, 0, 1]])
      + ',"e":' + (only < 0 ? JSON.stringify(this.events) : '[]') + ',"w":' + JSON.stringify(st) + '}';
    if (only < 0) this.events.length = 0;
    this.slots.forEach((s, i) => {
      if (s && s.connected && !s.hold && (only < 0 || only === i)) s.conn.send('{"t":"s","a":' + s.seq + ',' + body);
    });
  }

  _lobby() {
    const w = this.world;
    const base = {
      t: 'lobby', code: this.code, state: this.state, timer: Math.max(0, Math.round(this.timer)),
      goals: w.goals, winner: w.winner, goalsToWin: w.P.match.goalsToWin, intro: !!this.intro && this.state === 'countdown',
      players: this.slots.map((s) => (s ? { name: s.name, num: s.num, connected: s.connected, ready: s.ready, rematch: s.rematch } : null)),
    };
    const str = JSON.stringify(base);
    for (const s of this.slots) if (s && s.connected) s.conn.send(str);
  }

  _send(i, obj) {
    const s = this.slots[i];
    if (s && s.connected && s.conn) s.conn.send(JSON.stringify(obj));
  }
}
