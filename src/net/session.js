// Клиентская сторона сетевого матча без привязки к браузеру и транспорту.
// Свой игрок предсказывается сразу; каждое состояние сервера восстанавливается целиком, и поверх него
// доигрывается ещё не подтверждённый ввод. Расхождение показанного и исправленного положения гасится плавно.
import { packInput, unpackInput, emptyInput } from '../sim/world.js';
import { INPUT_MASK, EDGE_BITS, REMOTE_DELAY } from './protocol.js';

const MAX_PENDING = 360, SNAP_LIMIT = 1.2, BALL_SNAP_LIMIT = 6, REMOTE_KEEP = 10;
const angLerp = (a, b, t) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

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
    this.waitSync = 0; this._syncN = 0; this._fresh = false; // ждём подтверждения свежей синхронизации с этим номером
    this.err = { p: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], b: { x: 0, y: 0, z: 0 } };
    this._before = {}; this._after = {};
    // Соперник рисуется не по предсказанию, а по подтверждённым состояниям сервера с небольшим отставанием:
    // его нельзя угадать на время пинга вперёд, а интерполяция между настоящими положениями не дёргается.
    this.remoteBuf = []; this.renderTick = 0;
  }

  get state() { return this.lobby ? this.lobby.state : 'connecting'; }
  get playing() { return this.state === 'play' && this.hasState && !this.waitSync; }

  handle(m, now = 0) {
    switch (m.t) {
      case 'joined': this.me = m.you; this.code = m.code; this.token = m.token; this.error = null; break;
      case 'lobby':
        this.lobby = m; this.lobbyAt = now;
        if (m.state !== 'play') { this.pending.length = 0; this.out.length = 0; }
        break;
      case 'synced':
        if (m.n === this.waitSync) { this.waitSync = 0; this._fresh = true; }
        break;
      case 's':
        if (this.waitSync) break; // отправлено до синхронизации — устарело
        this.snap = m; // нужно только самое свежее состояние; события копятся все
        if (this.serverEvents.length > 256) this.serverEvents.length = 0; // кадры не идут — старые события не копятся
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
    const w = this.world, had = this.hasState && !this._fresh;
    this._fresh = false;
    if (had) w.snapshot(this._before);
    w.loadState(m.w);
    this.hasState = true;
    if (!had) this.remoteBuf.length = 0;
    const rb = this.remoteBuf, lastR = rb[rb.length - 1];
    if (!lastR || w.tick > lastR.tick) {
      const slot = rb.length >= REMOTE_KEEP ? rb.shift() : { tick: 0, v: {} };
      slot.tick = w.tick; w._snapPlayer(w.players[1 - this.me], slot.v);
      rb.push(slot);
    } else if (w.tick < lastR.tick) { rb.length = 0; } // новый матч: счёт шагов начался заново
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
      this._acc(e.b, b.bx - a.bx, b.by - a.by, b.bz - a.bz, BALL_SNAP_LIMIT);
    } else this.clearError();
    return true;
  }

  _acc(o, dx, dy, dz, limit = SNAP_LIMIT) {
    o.x += dx; o.y += dy; o.z += dz;
    if (Math.hypot(o.x, o.y, o.z) > limit) o.x = o.y = o.z = 0; // большое расхождение (ввод мяча, гол) — без «резинки»
  }

  // Положение соперника для рендера: интерполяция между подтверждёнными состояниями сервера.
  // out — снимок игрока (как World._snapPlayer); dt — время кадра, с. Возвращает false, если состояний ещё нет.
  remoteView(out, dt) {
    const rb = this.remoteBuf, n = rb.length;
    if (!n) return false;
    const target = rb[n - 1].tick - REMOTE_DELAY;
    this.renderTick += dt * this.world.P.simHz;
    const off = target - this.renderTick;
    if (Math.abs(off) > 24) this.renderTick = target; // после паузы, возврата в игру или начала матча
    else this.renderTick += off * Math.min(1, dt * 3); // мягкая подстройка под темп сервера
    const rt = this.renderTick;
    let i = n - 1;
    while (i > 0 && rb[i - 1].tick >= rt) i--;
    const b = rb[i], a = rb[Math.max(0, i - 1)];
    const k = b.tick > a.tick ? Math.max(0, Math.min(1, (rt - a.tick) / (b.tick - a.tick))) : 1;
    const A = a.v, B = b.v, L = (x, y) => x + (y - x) * k;
    out.px = L(A.px, B.px); out.pz = L(A.pz, B.pz); out.py = L(A.py, B.py); out.vx = L(A.vx, B.vx); out.vz = L(A.vz, B.vz);
    out.yaw = angLerp(A.yaw, B.yaw, k);
    out.feet = out.feet || [{}, {}];
    for (let j = 0; j < 2; j++) {
      const fa = A.feet[j], fb = B.feet[j], f = out.feet[j];
      f.x = L(fa.x, fb.x); f.z = L(fa.z, fb.z); f.h = L(fa.h, fb.h); f.yaw = angLerp(fa.yaw, fb.yaw, k);
      f.planted = fb.planted; f.u = fb.u; f.top = fb.top;
    }
    let dgp = B.gp - A.gp; if (dgp > 0.5) dgp -= 1; else if (dgp < -0.5) dgp += 1;
    out.gp = (((A.gp + dgp * k) % 1) + 1) % 1; out.gait = B.gait;
    return true;
  }

  clearError() { for (const o of [this.err.p[0], this.err.p[1], this.err.b]) o.x = o.y = o.z = 0; }

  decayError(dt) {
    const k = Math.exp(-14 * dt);
    for (const o of [this.err.p[0], this.err.p[1], this.err.b]) { o.x *= k; o.y *= k; o.z *= k; }
  }

  // Сброс при переподключении: неподтверждённый ввод уже не дойдёт
  resetInput() { this.pending.length = 0; this.out.length = 0; this.snap = null; this.waitSync = 0; this._fresh = true; }

  // Окно скрыто: сервер перестаёт слать состояния, ввод считается отпущенным
  hold() {
    this.pending.length = 0; this.out.length = 0; this.snap = null; this.serverEvents.length = 0;
    this.waitSync = -1;
    this.send({ t: 'hold' });
  }

  // Возврат в игру или длинный простой кадра: всё накопленное отбрасывается, клиент берёт только последнее
  // состояние сервера — без доигрывания пропущенного и без ускорения.
  resync() {
    this.pending.length = 0; this.out.length = 0; this.snap = null; this.serverEvents.length = 0;
    this.clearError(); this.remoteBuf.length = 0;
    this.waitSync = ++this._syncN;
    this.send({ t: 'sync', n: this.waitSync });
  }
}
