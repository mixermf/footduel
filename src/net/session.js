// Клиентская сторона сетевого матча без привязки к браузеру и транспорту.
// Свой игрок предсказывается сразу; каждое состояние сервера восстанавливается целиком, и поверх него
// доигрывается ещё не подтверждённый ввод. Расхождение показанного и исправленного положения гасится плавно.
import { packInput, unpackInput, emptyInput } from '../sim/world.js';
import { INPUT_MASK, EDGE_BITS } from './protocol.js';

const MAX_PENDING = 360, SNAP_LIMIT = 1.2;

export class NetSession {
  // world — World в режиме дуэли; send(obj) — отправка сообщения серверу
  constructor(world, send) {
    this.world = world; this.send = send;
    this.me = -1; this.code = ''; this.token = '';
    this.lobby = null; this.lobbyAt = 0; this.error = null; this.closed = null;
    this.seq = 0; this.pending = []; this.out = [];
    this.snap = null; this.hasState = false; this.serverEvents = [];
    this.remote = emptyInput(); this._in = emptyInput();
    this.rtt = 0; this.replayed = 0;
    this.err = { p: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], b: { x: 0, y: 0, z: 0 } };
    this._before = {}; this._after = {};
  }

  get state() { return this.lobby ? this.lobby.state : 'connecting'; }
  get playing() { return this.state === 'play' && this.hasState; }

  handle(m, now = 0) {
    switch (m.t) {
      case 'joined': this.me = m.you; this.code = m.code; this.token = m.token; this.error = null; break;
      case 'lobby':
        this.lobby = m; this.lobbyAt = now;
        if (m.state !== 'play') { this.pending.length = 0; this.out.length = 0; }
        break;
      case 's':
        this.snap = m; // нужно только самое свежее состояние; события копятся все
        for (const e of m.e) this.serverEvents.push(e);
        break;
      case 'pong': this.rtt += ((now - m.c) - this.rtt) * (this.rtt ? 0.2 : 1); break;
      case 'error': this.error = m.code; break;
      case 'closed': this.closed = m.reason; break;
      default: break;
    }
  }

  // Один локальный шаг: ввод запоминается, уходит на сервер и сразу применяется к своему игроку.
  step(input) {
    const f = packInput(input);
    f[2] &= INPUT_MASK;
    this.seq++;
    this.pending.push({ s: this.seq, f });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    this.out.push(f);
    this._stepWorld(f);
  }

  flush() {
    if (!this.out.length) return;
    this.send({ t: 'in', s: this.seq - this.out.length + 1, f: this.out });
    this.out = [];
  }

  // Отпустить всё (окно скрыто, открыто меню): сервер не должен продолжать бег по последнему вводу.
  neutral() { this.step(emptyInput()); this.flush(); }

  _stepWorld(f) {
    unpackInput(f, this._in);
    if (this.me === 0) this.world.step(this._in, this.remote); else this.world.step(this.remote, this._in);
  }

  // Применить последнее полученное состояние. prevOut/curOut — снимки для интерполяции рендера.
  // Возвращает true, если состояние было применено.
  reconcile(prevOut, curOut) {
    const m = this.snap;
    if (!m || this.me < 0) return false;
    this.snap = null;
    const w = this.world, had = this.hasState;
    if (had) w.snapshot(this._before);
    w.loadState(m.w);
    this.hasState = true;
    // соперник до следующего состояния продолжает с последним известным вводом, без повторных нажатий
    const r = m.i[1 - this.me];
    unpackInput([r[0], r[1], r[2] & ~EDGE_BITS], this.remote);
    const p = this.pending;
    let k = 0;
    while (k < p.length && p[k].s <= m.a) k++;
    if (k) p.splice(0, k);
    this.replayed = p.length;
    if (p.length === 0) { w.snapshot(prevOut); w.snapshot(curOut); }
    for (let i = 0; i < p.length; i++) {
      if (i === p.length - 1) w.snapshot(prevOut);
      this._stepWorld(p[i].f);
    }
    if (p.length) w.snapshot(curOut);
    w.events.length = 0;
    if (had) {
      const a = w.snapshot(this._after), b = this._before, e = this.err;
      this._acc(e.p[0], b.px - a.px, b.py - a.py, b.pz - a.pz);
      this._acc(e.p[1], b.p2.px - a.p2.px, b.p2.py - a.p2.py, b.p2.pz - a.p2.pz);
      this._acc(e.b, b.bx - a.bx, b.by - a.by, b.bz - a.bz);
    } else this.clearError();
    return true;
  }

  _acc(o, dx, dy, dz) {
    o.x += dx; o.y += dy; o.z += dz;
    if (Math.hypot(o.x, o.y, o.z) > SNAP_LIMIT) o.x = o.y = o.z = 0; // большое расхождение (ввод мяча, гол) — без «резинки»
  }

  clearError() { for (const o of [this.err.p[0], this.err.p[1], this.err.b]) o.x = o.y = o.z = 0; }

  decayError(dt) {
    const k = Math.exp(-14 * dt);
    for (const o of [this.err.p[0], this.err.p[1], this.err.b]) { o.x *= k; o.y *= k; o.z *= k; }
  }

  // Сброс при переподключении: неподтверждённый ввод уже не дойдёт
  resetInput() { this.pending.length = 0; this.out.length = 0; this.snap = null; }
}
