// Компьютерный соперник для матча 1×1. Чистая логика без DOM и графики: читает мир и заполняет кадр ввода тем же
// способом, что и человек (стрелки, удар с зарядом, стойка, рывок, подкат). Никаких поблажек от симуляции бот не получает.
//
// Правила дуэли, под которые он играет: каждый игрок держится своей половины (тело не переходит центральную линию),
// мяч — нет. Поэтому игра — это перестрелка: взять мяч на своей половине, вывести его к удобной точке и пробить,
// а когда мяч у соперника или летит к своим воротам — встать между мячом и воротами в стойку и принять удар.
//
// Уровни сложности — один и тот же мозг с разными параметрами (BOT_LEVELS). Все случайные решения — из собственного
// генератора с зерном: матч бота повторяется при том же зерне.
import { createRng } from '../sim/rng.js';
import { emptyInput } from '../sim/world.js';
import { stepBall } from '../sim/ball.js';

// react — через сколько секунд бот замечает новое положение мяча и соперника (до этого действует по старой картине);
// speed — доля скорости бега; sprint — доля решений «с ускорением» в погоне и на ведении;
// line — где бот бьёт: расстояние от центральной линии до точки удара на своей половине, м (меньше — ближе к чужим воротам);
// carry — сколько бот готов вести мяч до удара, с (дольше — выбирает момент, обводит);
// charge — заряд удара (мин..макс); aimErr — разброс прицела (доля полуширины ворот); corner — насколько точно выбирает угол
// дальше от соперника (0 — случайно, 1 — всегда); low — доля низовых ударов;
// keep — где бот стоит в обороне, м от своих ворот (дальше — меньше угол для удара, но выше риск навеса); guard — держит стойку, когда соперник бьёт; lunge — рывок в стойке
// к мячу, идущему мимо; firstTime — бьёт ли в касание по мячу, катящемуся на свою половину; superShot — пользуется суперударом;
// predict — просчитывает полёт мяча с отскоками от покрытия и бортов (та же физика, что в игре) и бежит к точке, где
// мяч можно взять на своей половине, а не за мячом; strike — доля решений отбить летящий мяч сразу ударом в касание;
// jumpStrike — бьёт ли по высокому мячу в прыжке; jumpBlock — прыгает ли, чтобы корпусом перекрыть высокий удар;
// lob — навес через соперника, стоящего далеко от своих ворот (выключен на всех уровнях: по замеру навес бота заходит в 5 %
// случаев против 55 % у обычного удара — прицел навеса для бота ещё не подобран); hesitate — доля «картин», на которых бот на миг теряется
export const BOT_LEVELS = {
  easy: { label: 'Лёгкий', react: 0.36, speed: 0.72, sprint: 0.1, line: 3.2, carry: [0.4, 1.2], charge: [0.25, 0.6], aimErr: 0.6, corner: 0.2, low: 0.3,
    keep: 1.6, guard: 0.35, lunge: 0.1, firstTime: 0, superShot: false, lob: 0, hesitate: 0.3,
    predict: false, strike: 0, jumpStrike: false, jumpBlock: 0 },
  medium: { label: 'Средний', react: 0.2, speed: 0.88, sprint: 0.5, line: 1.8, carry: [0.6, 1.8], charge: [0.5, 0.85], aimErr: 0.35, corner: 0.6, low: 0.5,
    keep: 2.4, guard: 0.75, lunge: 0.5, firstTime: 0.3, superShot: false, lob: 0, hesitate: 0.12,
    predict: false, strike: 0, jumpStrike: false, jumpBlock: 0 },
  hard: { label: 'Сложный', react: 0.1, speed: 1, sprint: 0.95, line: 0.9, carry: [0.8, 2.4], charge: [0.7, 1], aimErr: 0.15, corner: 0.95, low: 0.7,
    keep: 3.2, guard: 1, lunge: 0.9, firstTime: 0.7, superShot: true, lob: 0, hesitate: 0.02,
    predict: true, strike: 0.8, jumpStrike: true, jumpBlock: 0.95 },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Bot {
  // me — номер игрока бота в мире дуэли (0 или 1); level — ключ BOT_LEVELS или объект с теми же полями
  constructor(me, level = 'medium', seed = 1) {
    this.me = me;
    this.setLevel(level);
    this.rng = createRng((seed * 2654435761) >>> 0 || 1);
    this.out = emptyInput();
    this.reset();
  }

  setLevel(level) { this.L = typeof level === 'string' ? { ...BOT_LEVELS[level] } : { ...level }; this.level = level; }

  reset() {
    this.seen = null; this.seenT = 1e9; this.roll = 0; this.hes = 0;
    this.shot = null; this.ft = null; this.carryT = 0; this.carryMax = 1; this.spot = null;
    this.lungeCd = 0; this.dir = { x: 0, z: 0 }; this.path = null; this.jumpCd = 0; this.roll2 = 0;
  }

  // Один шаг симуляции (1/120 с). Возвращает кадр ввода (тот же объект каждый раз).
  think(w) {
    const L = this.L, dt = w.dt, o = this.out, p = w.players[this.me], q = w.players[1 - this.me], b = w.ball;
    Object.assign(o, emptyInput());
    o.digital = false; // аналоговый стик: прицел следует за направлением, а не накапливается
    if (w.phase !== 'play' || !p || !q) { this.shot = this.ft = this.spot = null; this.seen = null; this.carryT = 0; return o; }
    const F = w.P.field, side = p.side, att = -side;
    const gx = att * (F.length / 2 - F.goalInset), ownX = -gx; // линии атакуемых и своих ворот
    // ---------- восприятие с задержкой: картина обновляется раз в react секунд (с разбросом)
    this.seenT += dt; this.lungeCd = Math.max(0, this.lungeCd - dt); this.jumpCd = Math.max(0, this.jumpCd - dt);
    if (!this.seen || this.seenT >= L.react * (0.75 + 0.5 * this.rng.next())) {
      this.seenT = 0;
      this.seen = { bx: b.x, bz: b.z, by: b.y, bvx: b.vx, bvz: b.vz, bvy: b.vy, qx: q.x, qz: q.z, qkick: !!q.kick };
      this.roll = this.rng.next(); // одно решение на картину: ускорение и стойка не мигают каждый шаг
      this.roll2 = this.rng.next();
      this.path = L.predict ? this._path(w, b) : null;
      this.hes = this.rng.next() < L.hesitate ? L.react * 0.8 : 0;
    }
    const S = this.seen, age = this.seenT;

    // ---------- идёт свой удар или удар в касание: кнопка держится до нужного заряда
    if (this.shot) return this._shoot(w, p, o);
    if (this.ft) return this._firstTime(w, p, o);
    if (p.kick || p.slide || p.fall) return o;
    if (this.hes > 0) { this.hes -= dt; this._move(o, this.dir.x * 0.3, this.dir.z * 0.3, false); return o; }

    // ---------- с мячом: ведение к точке удара и удар
    if (p.possession && !p.juggle) return this._attack(w, p, q, o, gx, att, side);
    this.carryT = 0; this.spot = null;

    // где мяч в голове бота: увиденное положение плюс снос по увиденной скорости
    const ex = S.bx + S.bvx * age, ez = S.bz + S.bvz * age, evx = S.bvx, evz = S.bvz;
    // ---------- мяч летит к боту и его можно встретить ударом: отбить сразу (в прыжке, если высоко)
    if (this.path && this.roll2 < L.strike && this.seenT < w.dt * 1.5) {
      const hit = this._strikeChance(w, p, side, age);
      if (hit) { this.ft = { t: 0, hold: 0.2 + 0.3 * L.charge[1], lat: this._aimLat(w, w.players[1 - this.me], gx), jump: hit.high }; return this._firstTime(w, p, o); }
    }
    const mine = ex * side > -0.1; // мяч на своей половине
    const incoming = evx * side > 2.5; // мяч летит к своим воротам
    // ---------- мяч летит к своим воротам: встать на его линию у своих ворот, стойка, рывок
    if (incoming && (S.bx - ownX) * att > 1.2) return this._keep(w, p, o, ownX, att, side, S, age);
    // ---------- свободный мяч на своей половине: перехват
    if (mine) return this._chase(w, p, o, gx, ownX, att, side, S, age);
    // ---------- мяч на чужой половине: оборона у своих ворот, напротив мяча
    return this._hold(w, p, q, o, ownX, att, side, S);
  }

  // ---------- перехват свободного мяча на своей половине
  _chase(w, p, o, gx, ownX, att, side, S, age) {
    const L = this.L, F = w.P.field, b = w.ball, sp = w.P.player.sprintSpeed * L.speed;
    let tx = S.bx, tz = S.bz;
    const catchAt = this.path ? this._catchPoint(w, p, side, age, sp) : null;
    if (catchAt) { tx = catchAt.x; tz = catchAt.z; } // где мяч окажется низко и в досягаемости — с учётом отскоков
    else for (let i = 0; i < 4; i++) { const t = Math.min(1.5, Math.hypot(tx - p.x, tz - p.z) / sp + age); tx = S.bx + S.bvx * t * 0.75; tz = S.bz + S.bvz * t * 0.75; }
    // подходить со стороны своих ворот: тогда первое касание сразу ведёт мяч вперёд
    const dB = Math.hypot(b.x - p.x, b.z - p.z);
    if ((p.x - b.x) * att > -0.1 && dB < 2.5) { tx -= att * 0.45; tz += (p.z > b.z ? 0.35 : -0.35); }
    tx = clamp(tx, side < 0 ? -F.length / 2 + 0.35 : 0.3, side < 0 ? -0.3 : F.length / 2 - 0.35);
    tz = clamp(tz, -F.width / 2 + 0.35, F.width / 2 - 0.35);
    // удар в касание: мяч катится по своей половине, рядом, не к своим воротам
    const roll = Math.hypot(b.vx, b.vz), toOwn = b.vx * -att > 2;
    const rvx = b.vx - p.vx, rvz = b.vz - p.vz, rv = Math.hypot(rvx, rvz) || 1;
    const comes = ((p.x - b.x) * rvx + (p.z - b.z) * rvz) / rv > 0.3 && Math.abs(((p.x - b.x) * rvz - (p.z - b.z) * rvx) / rv) < 0.9; // идёт к боту и пройдёт рядом
    if (roll > 2.5 && b.y < 0.6 && !toOwn && dB < 2 && comes && this.roll < L.firstTime) {
      this.ft = { t: 0, hold: 0.25 + 0.35 * L.charge[1], lat: this._aimLat(w, w.players[1 - this.me], gx) };
      return this._firstTime(w, p, o);
    }
    this._goto(o, p, tx, tz, dB > 2.5 && this.roll < L.sprint);
    return o;
  }

  // ---------- оборона, пока мяч на чужой половине: у своих ворот, между мячом и центром ворот
  _hold(w, p, q, o, ownX, att, side, S) {
    const L = this.L, b = w.ball;
    const kx = ownX + att * L.keep, lz = S.bz * (L.keep / Math.max(2, Math.abs(S.bx - ownX)));
    const tz = clamp(lz + (S.bz - lz) * 0.15, -1.3, 1.3);
    // соперник замахнулся — стойка (приём телом и ближней ногой)
    if ((S.qkick || q.kick) && this.roll < L.guard) o.guardHeld = true;
    this._goto(o, p, kx, tz, Math.abs(p.x - kx) > 2.5 && this.roll < L.sprint);
    return o;
  }

  // ---------- мяч летит к своим воротам: на его линию, стойка, рывок
  _keep(w, p, o, ownX, att, side, S, age) {
    const L = this.L, b = w.ball, F = w.P.field;
    const lineX = ownX + att * L.keep;
    let t = (lineX - S.bx) / (S.bvx || 1e-6); // когда мяч пересечёт линию, где стоит бот
    let tz = S.bz + S.bvz * Math.max(0, t);
    let onTarget = Math.abs(S.bz + S.bvz * Math.max(0, (ownX - S.bx) / (S.bvx || 1e-6))) < F.goalWidth / 2 + 0.4;
    if (this.path) {
      // по прогнозу полёта: с подкруткой и отскоком мяч приходит не туда, куда смотрит его скорость сейчас
      const c = this._crossingX(lineX), g = this._crossingX(ownX);
      if (c) { t = c.t; tz = c.z; }
      if (g) onTarget = Math.abs(g.z) < F.goalWidth / 2 + 0.4;
    }
    tz = clamp(tz, -F.goalWidth / 2 - 0.3, F.goalWidth / 2 + 0.3);
    if (this.roll < L.guard) o.guardHeld = true;
    const dz = tz - p.z, dx = lineX - p.x;
    const tLeft = t - age;
    // высокий мяч идёт в корпус выше головы: прыжок без направления, корпус перекрывает удар
    if (this.path && this.jumpCd <= 0 && p.y <= 0 && this.roll < L.jumpBlock) {
      const c = this._crossing(p, age);
      if (c && c.y > 1.5 && c.y < 2.65 && Math.abs(c.z - p.z) < 0.6 && c.t > 0.22 && c.t < 0.36) {
        o.guardHeld = false; o.jumpPressed = true; this.jumpCd = 1;
        return o;
      }
    }
    // мяч идёт мимо корпуса в створ: рывок в его сторону
    if (o.guardHeld && p.guard && onTarget && Math.abs(dz) > 0.55 && tLeft < 0.45 && tLeft > 0.05 && this.lungeCd <= 0 && this.roll < L.lunge) {
      o.mx = 0; o.mz = Math.sign(dz); o.jumpPressed = true; this.lungeCd = 1.2;
      return o;
    }
    this._goto(o, p, lineX, tz, false, Math.abs(dx) > 0.5 || Math.abs(dz) > 0.3 ? 1 : 0.6);
    return o;
  }

  // ---------- с мячом: вывести к точке удара и пробить
  _attack(w, p, q, o, gx, att, side) {
    const L = this.L, F = w.P.field, b = w.ball, dt = w.dt;
    if (!this.spot) {
      // точка удара: на своей половине, line м от центра; по ширине — туда, где удобнее бить мимо соперника
      const [c0, c1] = L.carry;
      this.carryMax = c0 + (c1 - c0) * this.rng.next();
      const zs = (this.rng.next() * 2 - 1) * 2.2;
      this.spot = { x: -att * (L.line + 0.4 * this.rng.next()), z: clamp(zs, -F.width / 2 + 1.2, F.width / 2 - 1.2) };
    }
    this.carryT += dt;
    const sp = this.spot, dS = Math.hypot(sp.x - p.x, sp.z - p.z);
    const dGoal = Math.hypot(gx - b.x, b.z);
    // ведение у центральной линии опасно: тело не перейдёт, а мяч уйдёт к сопернику
    const nearLine = p.x * -att < 0.9 && p.vx * att > 0.5;
    const ready = dS < 0.6 || this.carryT > this.carryMax || nearLine;
    // бить, только когда мяч у ноги и не уходит от неё: иначе за время заряда он укатится (у центральной линии — к сопернику)
    const away = Math.hypot(b.vx - p.vx, b.vz - p.vz), roomX = b.x * side;
    if (ready && b.y < 0.4 && Math.hypot(b.x - p.x, b.z - p.z) < 0.85 && away < 1.6 && roomX > 0.5) {
      const keeperFar = Math.abs(q.x - gx) > 3.2;
      const lob = keeperFar && dGoal > 6 && dGoal < w.P.kick.lobMax - 1 && this.rng.next() < L.lob;
      const sup = L.superShot && p.superCharge >= 1 && !lob;
      const [c0, c1] = L.charge;
      const low = this.rng.next() < L.low;
      let hold = (c0 + (c1 - c0) * this.rng.next()) * w.P.kick.chargeTime;
      if (lob) { // у навеса заряд задаёт дальность: мяч должен опуститься под перекладину, а не за воротами
        const K = w.P.kick, want = clamp((dGoal - 0.6 - K.lobMin) / (K.lobMax - K.lobMin), 0, 1);
        hold = clamp(want + (this.rng.next() * 2 - 1) * L.aimErr * 0.15, 0, 1) * K.chargeTime;
      }
      this.shot = { t: 0, hold, lat: this._aimLat(w, q, gx), high: lob ? 0.2 : low ? -0.6 : 0.1 + 0.3 * this.rng.next(), lob, sup };
      this.spot = null; this.carryT = 0;
      return this._shoot(w, p, o);
    }
    this._goto(o, p, sp.x, sp.z, this.roll < L.sprint * 0.6 && dS > 2, 0.85);
    return o;
  }

  // боковая цель: угол дальше от соперника (с вероятностью corner), с разбросом по уровню
  _aimLat(w, q, gx) {
    const L = this.L, far = q.z > 0 ? -1 : 1, side = this.rng.next() < L.corner ? far : (this.rng.next() < 0.5 ? -1 : 1);
    return clamp(side * (0.55 + 0.4 * this.rng.next()) + (this.rng.next() * 2 - 1) * L.aimErr, -1, 1);
  }

  _shoot(w, p, o) {
    const sh = this.shot, att = -p.side, first = sh.t === 0;
    sh.t += w.dt;
    if (sh.sup) o.superPressed = first;
    else if (sh.lob) { o.lobPressed = first; o.lobHeld = sh.t < sh.hold; }
    else { o.kickPressed = first; o.kickHeld = sh.t < sh.hold; }
    // прицел: вверх/вниз по экрану — сторона ворот, к воротам — выше (стик держится, пока идёт удар)
    o.mz = sh.lat; o.mx = sh.high * att;
    if ((sh.t > sh.hold + 0.1 && !p.kick) || sh.t > 2.5) this.shot = null; // удар ушёл или отменён
    return o;
  }

  // удар в касание по катящемуся мячу: симуляция сама выводит стопу на мяч, бот держит кнопку и целится
  _firstTime(w, p, o) {
    const f = this.ft, first = f.t === 0;
    f.t += w.dt;
    o.kickPressed = first; o.kickHeld = f.t < f.hold || (!!p.kick && (p.kick.phase === 'ready' || p.kick.phase === 'charge') && f.t < 0.9);
    if (f.jump && f.t > w.dt * 1.5 && f.t < w.dt * 3) o.jumpPressed = true; // при зажатом ударе прыжок разрешает удар по высокому мячу
    o.mz = f.lat; o.mx = -0.2 * p.side;
    if ((f.t > f.hold + 0.1 && !p.kick) || f.t > 1.5) this.ft = null;
    return o;
  }

  // Полёт мяча на 2,5 с вперёд той же физикой, что в игре (отскоки от покрытия и бортов): точки раз в 1/30 с
  _path(w, b) {
    const c = Object.assign(this._pb || (this._pb = {}), b), ev = this._pev || (this._pev = []), pts = this._pts || (this._pts = []);
    const h = 1 / 120; let n = 0;
    for (let i = 1; i <= 300; i++) {
      stepBall(c, h, w.P, ev, null); ev.length = 0;
      if (i % 4 === 0) { const q = pts[n] || (pts[n] = {}); q.t = i * h; q.x = c.x; q.y = c.y; q.z = c.z; q.vx = c.vx; q.vy = c.vy; q.vz = c.vz; n++; }
      if (c.inGoal) break;
    }
    pts.length = n;
    return pts;
  }

  // ближайшая точка пути на своей половине, где мяч низко и бот успевает туда добежать
  _catchPoint(w, p, side, age, sp) {
    for (const q of this.path) {
      const tt = q.t - age;
      if (tt < 0.05 || q.x * side < 0.35 || q.y > 0.55) continue;
      if (Math.hypot(q.x - p.x, q.z - p.z) <= 0.35 + sp * tt) return q;
    }
    return null;
  }

  // можно ли встретить летящий мяч ударом в касание. Ответ даёт сам планировщик удара симуляции (тот же, что ведёт
  // игрока при зажатой кнопке): бот спрашивает его заранее и жмёт удар, только если точка встречи действительно есть —
  // иначе зажатый удар кончился бы пустым замахом. Сначала — без прыжка, затем (если умеет) — с прыжком.
  _strikeChance(w, p, side, age) {
    const L = this.L, b = w.ball, F = w.P.field;
    if (Math.hypot(b.vx, b.vz) < 2 || Math.hypot(b.x - p.x, b.z - p.z) > 7 || p.y > 0) return null;
    const gx = -side * (F.length / 2 - F.goalInset);
    let ax = gx - b.x, az = -b.z; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    const k = this._fk || (this._fk = {});
    // удар в прыжке — только по мячу медленнее 13 м/с (навес, отскок, пас): быстрый высокий удар в створ по замеру надёжнее перекрыть
    // прыжком корпусом (упражнение «высокий удар»: прыжок-блок брал 13 из 13, удар в прыжке пропускал каждый второй)
    const jumpOk2 = L.jumpStrike && Math.hypot(b.vx, b.vz) < 13;
    for (const jumpOk of jumpOk2 ? [false, true] : [false]) {
      Object.assign(k, { type: 'shot', ax, az, jumpOk, commitTick: 0, bike: false, fly: 0, footSide: 1, dynamic: false });
      const pl = w._strikePlan(p, k);
      if (pl && pl.bx * side > 0.3 && pl.t > 0.12) return { t: pl.t, high: jumpOk };
    }
    return null;
  }

  // где мяч по прогнозу пересечёт поперечную линию x (время — от момента прогноза)
  _crossingX(x) {
    const P = this.path;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], q = P[i];
      if ((a.x - x) * (q.x - x) <= 0) { const k = (x - a.x) / ((q.x - a.x) || 1e-6); return { t: a.t + (q.t - a.t) * k, y: a.y + (q.y - a.y) * k, z: a.z + (q.z - a.z) * k }; }
    }
    return null;
  }

  // где мяч пройдёт линию, на которой стоит бот (по длине поля), и через сколько секунд
  _crossing(p, age) {
    const P = this.path;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], q = P[i];
      if ((a.x - p.x) * (q.x - p.x) <= 0) { const k = (p.x - a.x) / ((q.x - a.x) || 1e-6); return { t: a.t + (q.t - a.t) * k - age, y: a.y + (q.y - a.y) * k, z: a.z + (q.z - a.z) * k }; }
    }
    return null;
  }

  _goto(o, p, tx, tz, sprint, scale = 1) {
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.1) { this._move(o, 0, 0, false); return; }
    const mag = Math.min(1, d / 0.5) * this.L.speed * scale;
    this._move(o, (dx / d) * mag, (dz / d) * mag, sprint && d > 1);
  }

  _move(o, mx, mz, sprint) {
    // направление сглажено: бот не дёргает стик каждый шаг
    this.dir.x += (mx - this.dir.x) * 0.3; this.dir.z += (mz - this.dir.z) * 0.3;
    o.mx = this.dir.x; o.mz = this.dir.z; o.sprintHeld = !!sprint;
  }
}
