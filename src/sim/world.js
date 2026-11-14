// Детерминированная симуляция песочницы: фиксированный шаг, ввод по шагам, события.
// Не зависит от рендера и Three.js. Оси: x — вдоль поля (ворота на ±length/2), z — поперёк, y — вверх.
// Экран: вправо = +x, вниз = +z. Игрок side=-1 защищает левые ворота и атакует правые.
import { createBall, stepBall, predictRoll, ballSpeed } from './ball.js';
import { createRng } from './rng.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

export function emptyInput() {
  return {
    mx: 0, mz: 0, digital: true,
    kickHeld: false, kickPressed: false,
    jumpPressed: false, receivePressed: false,
    controlHeld: false, faceGoalHeld: false, sprintHeld: false, guardHeld: false,
    feintPressed: false, superPressed: false,
    // команды песочницы — часть кадра ввода: попадают в журнал, и повтор записи остаётся точным
    cmdReturn: false, cmdServe: false, cmdWall: false,
  };
}

function createFoot(side) {
  return { side, x: 0, z: 0, h: 0, yaw: 0, planted: true, stance: 0, swing: null, ctl: null };
}

function createPlayer(side) {
  return {
    side, x: side * 4, z: 0, y: 0, vy: 0, vx: 0, vz: 0, yaw: side < 0 ? 0 : Math.PI,
    feet: [createFoot(-1), createFoot(1)],
    gait: false, gaitPhase: 0, lastStrike: 1,
    possession: false, behindTime: 0,
    kick: null, kickBuf: 0, jumpBuf: 0, receiveT: 0, flick: false,
    lastTouchTick: -1000, lastKickTick: -1000,
    gesture: null, mode: 'run', yawVel: 0, dragSign: 0, lastTouchKind: null,
    guard: false, lunge: null, lungeCd: 0, recvTick: -1000, juggle: null,
  };
}

export const SCENARIOS = {
  free: { label: 'Мяч в ногах' },
  motor: { label: 'Мотор без мяча' },
  low: { label: 'Низкая подача' },
  thigh: { label: 'Подача на бедро' },
  chest: { label: 'Подача на грудь' },
  high: { label: 'Высокая подача' },
  wall: { label: 'Рикошет от борта' },
};

export class World {
  // duel: два игрока, счёт матча, ввод мяча пропустившему; иначе — одиночная песочница с подачами
  constructor(profile, { seed = 1, duel = false } = {}) {
    this.duel = duel;
    this.P = profile;
    this.dt = 1 / profile.simHz;
    this.seed = seed;
    this.rng = createRng(seed);
    this.ball = createBall(profile);
    this.players = duel ? [createPlayer(-1), createPlayer(1)] : [createPlayer(-1)];
    this.player = this.players[0];
    this.goals = [0, 0]; this.winner = -1; this.kickTo = 0;
    this._ins = [emptyInput(), emptyInput()];
    this.events = [];
    this.inputLog = [];
    this.recording = true;
    this.score = { scored: 0, conceded: 0 };
    this.stats = null;
    this._tmp = { x: 0, z: 0 };
    this._in = emptyInput();
    this.reset(duel ? 'duel' : 'free');
  }

  // ---------- состояние ----------
  reset(scenario = 'free') {
    const P = this.P, p = this.player, b = this.ball;
    this.scenario = scenario;
    this.tick = 0;
    this.phase = 'play'; this.phaseT = 0; this.goalLatch = false; this.idleFar = 0; this.feedIndex = 0; this.serveIndex = 0;
    this.startWall = !!P.field.reboundWall; // состояние щита на момент сброса — для точного повтора
    this.rng.state = this.seed;
    this.inputLog.length = 0;
    this.events.length = 0;
    this.stats = { touches: 0, misses: 0, kicks: 0, kickMisses: 0, receives: 0, behindTime: 0, possessionTime: 0, lostControl: 0 };
    this.goals[0] = this.goals[1] = 0; this.winner = -1;
    Object.assign(b, createBall(P));
    if (this.duel) {
      this.score.scored = this.score.conceded = 0;
      this.kickTo = this.seed & 1;
      this._kickoff(this.kickTo, true);
    } else {
      Object.assign(p, createPlayer(-1));
      p.x = -4; p.z = 0;
      this._placeFeet(p);
      this._serve(scenario);
    }
    for (const q of this.players) this._possession(q);
    this.events.length = 0;
    this.events.push({ type: 'reset', scenario });
  }

  _placeFeet(p) {
    const rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
    for (const f of p.feet) {
      f.x = p.x + rx * f.side * this.P.player.footSpread; f.z = p.z + rz * f.side * this.P.player.footSpread;
      f.h = 0; f.yaw = p.yaw; f.planted = true; f.swing = null; f.ctl = null;
    }
  }

  // Дуэль: ввод мяча. Мяч ставится неподвижно перед игроком `to` на его половине.
  // fresh — начало матча: оба игрока возвращаются на исходные позиции.
  _kickoff(to, fresh) {
    const b = this.ball, P = this.P;
    if (fresh) {
      for (const q of this.players) {
        const side = q.side;
        Object.assign(q, createPlayer(side));
        q.feet = [createFoot(-1), createFoot(1)];
        this._placeFeet(q);
      }
    }
    const p = this.players[to];
    b.x = p.x - p.side * 0.55; b.z = p.z; b.y = P.ball.radius;
    if (b.x * p.side < 0.3) b.x = p.side * 0.3;
    b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0; b.inGoal = false;
    this.goalLatch = false; this.idleFar = 0;
    this.events.push({ type: 'kickoff', to });
  }

  _serve(kind) {
    const b = this.ball, p = this.player, r = this.P.ball.radius;
    b.wx = b.wy = b.wz = 0; b.vx = b.vy = b.vz = 0;
    // подача: приходит к игроку за время t на высоте hTarget (баллистика с небольшой поправкой на воздух)
    const aimAt = (x0, y0, z0, t, hTarget) => {
      b.x = x0; b.y = y0; b.z = z0;
      const dx = p.x - x0, dz = p.z - z0, d = Math.hypot(dx, dz) || 1;
      const sp = (d / t) * 1.07;
      b.vx = (dx / d) * sp; b.vz = (dz / d) * sp;
      b.vy = hTarget <= y0 ? 0 : ((hTarget - y0 + 0.5 * this.P.ball.gravity * t * t) / t) * 1.04;
    };
    switch (kind) {
      case 'motor': b.x = 5; b.y = r; b.z = 3; break;
      case 'low': aimAt(7, r, 0.5, 0.85, 0); break;
      case 'thigh': aimAt(7, 0.5, -0.5, 0.9, 0.7); break;
      case 'chest': aimAt(7, 0.6, 0.4, 0.9, 1.25); break;
      case 'high': aimAt(7, 0.8, 0, 1.1, 1.72); break;
      case 'wall': b.x = 6; b.y = r; b.z = 0; b.vx = -9; b.vz = -9.5; break;
      default: b.x = p.x + 0.55; b.y = r; b.z = p.z; break;
    }
    if (kind !== 'free' && kind !== 'motor') this.events.push({ type: 'feed', kind });
  }

  // Песочница: новая подача на игрока. Высоты чередуются по счётчику (без случайности — повтор записи точен).
  // fresh — новый мяч от чужих ворот после гола; иначе подача идёт с места, где мяч остановился.
  _feed(fresh) {
    const b = this.ball, p = this.player, P = this.P, r = P.ball.radius;
    const kinds = [['low', 0.8, 0], ['thigh', 0.9, 0.7], ['low', 0.7, 0], ['chest', 0.95, 1.2], ['high', 1.1, 1.7], ['thigh', 0.85, 0.8]];
    const [kind, t, h] = kinds[this.feedIndex++ % kinds.length];
    if (fresh) { b.x = -p.side * (P.field.length / 2 - P.field.goalInset - 1.2); b.z = ((this.feedIndex % 3) - 1) * 1.6; b.y = r; b.inGoal = false; }
    const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz) || 1;
    const tt = Math.max(0.5, t * d / 11), sp = (d / tt) * 1.07;
    b.vx = (dx / d) * sp; b.vz = (dz / d) * sp;
    b.vy = h <= b.y ? 0 : ((h - b.y + 0.5 * P.ball.gravity * tt * tt) / tt) * 1.04;
    b.wx = b.wy = b.wz = 0;
    this.events.push({ type: 'feed', kind });
  }

  returnBall() {
    const p = this.player, b = this.ball;
    if (p.kick) this._endKick(p, 'reset');
    b.x = p.x + Math.cos(p.yaw) * 0.6; b.z = p.z + Math.sin(p.yaw) * 0.6; b.y = this.P.ball.radius;
    b.x = Math.min(b.x, -0.3);
    b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0;
    this.goalLatch = false;
    this.events.push({ type: 'ball_return' });
  }

  serve(kind) { this._serve(kind); this.goalLatch = false; }

  clearActions() {
    for (const p of this.players) {
      p.kickBuf = 0; p.jumpBuf = 0; p.receiveT = 0; p.flick = false;
      if (p.kick) this._endKick(p, 'cleared');
    }
  }

  // Полное игровое состояние для сети: сервер рассылает его, клиент восстанавливает и доигрывает свой ввод.
  // Возвращает ссылки на живые объекты — сериализовать сразу (JSON), не хранить.
  saveState() {
    return {
      tick: this.tick, phase: this.phase, phaseT: this.phaseT, goalLatch: this.goalLatch, idleFar: this.idleFar,
      feedIndex: this.feedIndex, serveIndex: this.serveIndex, kickTo: this.kickTo, winner: this.winner,
      rng: this.rng.state, score: this.score, goals: this.goals, stats: this.stats, ball: this.ball, players: this.players,
    };
  }

  // Принимает объект, полученный из JSON, и забирает его во владение.
  loadState(s) {
    this.tick = s.tick; this.phase = s.phase; this.phaseT = s.phaseT; this.goalLatch = s.goalLatch; this.idleFar = s.idleFar;
    this.feedIndex = s.feedIndex; this.serveIndex = s.serveIndex; this.kickTo = s.kickTo; this.winner = s.winner;
    this.rng.state = s.rng;
    Object.assign(this.score, s.score); this.goals[0] = s.goals[0]; this.goals[1] = s.goals[1];
    if (s.stats) this.stats = s.stats;
    Object.assign(this.ball, s.ball);
    for (let i = 0; i < this.players.length; i++) this.players[i] = s.players[i];
    this.player = this.players[0];
    this.events.length = 0;
  }

  snapshot(out = {}) {
    const b = this.ball;
    this._snapPlayer(this.players[0], out);
    if (this.players[1]) out.p2 = this._snapPlayer(this.players[1], out.p2 || {});
    out.bx = b.x; out.by = b.y; out.bz = b.z; out.bqx = b.qx; out.bqy = b.qy; out.bqz = b.qz; out.bqw = b.qw;
    return out;
  }

  _snapPlayer(p, out) {
    out.px = p.x; out.pz = p.z; out.py = p.y; out.yaw = p.yaw; out.vx = p.vx; out.vz = p.vz;
    out.feet = out.feet || [{}, {}];
    for (let i = 0; i < 2; i++) {
      const f = p.feet[i], o = out.feet[i];
      o.x = f.x; o.z = f.z; o.h = f.h; o.yaw = f.yaw; o.planted = f.planted;
      o.u = f.swing ? Math.min(1, f.swing.t / f.swing.dur) : 0; o.top = !!(f.swing && f.swing.top && f.swing.armed);
    }
    out.gp = p.gaitPhase; out.gait = p.gait;
    return out;
  }

  hash() {
    const p = this.player, b = this.ball, r = (v) => Math.round(v * 1e6);
    const h = [this.tick, r(p.x), r(p.z), r(p.y), r(p.yaw), r(p.vx), r(p.vz), r(b.x), r(b.y), r(b.z), r(b.vx), r(b.vy), r(b.vz), r(b.wy),
      r(p.feet[0].x), r(p.feet[1].z), this.score.scored, this.score.conceded];
    const q = this.players[1];
    if (q) h.push(r(q.x), r(q.z), r(q.y), r(q.yaw), r(q.vx), r(q.vz), r(q.feet[0].x), r(q.feet[1].z), this.goals[0], this.goals[1], this.phase);
    return h.join(',');
  }

  // ---------- шаг ----------
  // input — ввод игрока 0, input1 — игрока 1 (только в дуэли). События игрока помечаются его номером в поле pi.
  step(input, input1) {
    const P = this.P, dt = this.dt, b = this.ball, ps = this.players, ins = this._ins, ev = this.events;
    this.tick++;
    ev.length = 0;
    // ввод квантуется так же, как в записи: повтор по журналу даёт тот же результат
    const packed = packInput(input);
    if (this.recording && !this.duel && this.inputLog.length < 120 * 600) this.inputLog.push(packed);
    input = unpackInput(packed, ins[0]);
    if (this.duel) {
      if (input1) unpackInput(packInput(input1), ins[1]); else Object.assign(ins[1], emptyInput());
    } else {
      if (input.cmdReturn) this.returnBall();
      if (input.cmdServe) {
        const kinds = ['low', 'thigh', 'chest', 'high', 'wall'];
        this.serve(kinds[this.serveIndex++ % kinds.length]);
      }
      if (input.cmdWall) { P.field.reboundWall = !P.field.reboundWall; ev.push({ type: 'wall_toggle', on: P.field.reboundWall }); }
    }

    const live = this.phase === 'play';
    if (this.phase === 'goal') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.phase = 'play'; this.goalLatch = false;
        if (this.duel) this._kickoff(this.kickTo, false); else this._feed(true);
      }
    }

    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], inp = ins[i], e0 = ev.length;
      this._actions(p, inp, live);
      const plan = live ? this._touchPlan(p, inp) : null;
      this._motor(p, inp, plan);
      this._feet(p, plan);
      if (p.kick) this._kickFoot(p);
      for (let j = e0; j < ev.length; j++) ev[j].pi = i;
    }

    stepBall(b, dt, P, ev, (ball) => {
      for (let i = 0; i < ps.length; i++) {
        const e0 = ev.length;
        this._bodyCollision(ps[i], ball);
        for (let j = e0; j < ev.length; j++) ev[j].pi = i;
      }
    });

    // гол: один раз за розыгрыш
    for (const e of ev) {
      if (e.type === 'goal_line' && live && !this.goalLatch) {
        this.goalLatch = true; this.phase = 'goal'; this.phaseT = P.match.goalPause;
        const scored = e.side !== ps[0].side; // правые ворота защищает игрок 1
        if (scored) this.score.scored++; else this.score.conceded++;
        this.clearActions();
        if (this.duel) {
          const by = scored ? 0 : 1;
          this.goals[by]++; this.kickTo = 1 - by; // мяч вводит пропустивший
          ev.push({ type: 'goal', scored, by });
          if (this.goals[by] >= P.match.goalsToWin) { this.phase = 'over'; this.winner = by; ev.push({ type: 'match_over', winner: by }); }
        } else ev.push({ type: 'goal', scored });
        break;
      }
    }

    for (const p of ps) this._possession(p);

    if (this.duel) {
      // дуэль: мяч, замерший без владения (например, в углу у центра), вводится заново тому, на чьей он половине
      if (live && ballSpeed(b) < 0.4 && !ps[0].possession && !ps[1].possession && !ps[0].kick && !ps[1].kick) {
        this.idleFar += dt;
        if (this.idleFar > P.match.idleRestart) this._kickoff(b.x < 0 ? 0 : 1, false);
      } else this.idleFar = 0;
    } else if (live && b.x > 0.2 && ballSpeed(b) < 0.4) {
      // песочница: мяч, замерший на чужой половине, возвращает подача
      this.idleFar += dt;
      if (this.idleFar > 1.0) {
        this.idleFar = 0;
        this._feed(false);
      }
    } else this.idleFar = 0;
  }

  // ---------- действия и буферы ----------
  _actions(p, input, live) {
    const P = this.P, dt = this.dt;
    p.kickBuf = Math.max(0, p.kickBuf - dt);
    p.jumpBuf = Math.max(0, p.jumpBuf - dt);
    p.receiveT = Math.max(0, p.receiveT - dt);
    if (p.gesture) { p.gesture.t += dt; if (p.gesture.t > 0.35) p.gesture = null; }
    p.lungeCd = Math.max(0, p.lungeCd - dt);
    if (!live) { p.kickBuf = p.jumpBuf = 0; p.guard = false; p.mode = input.sprintHeld ? 'sprint' : 'run'; if (p.juggle) this._endJuggle(p); return; }

    if (input.kickPressed && !p.kick) p.kickBuf = P.input.buffer;
    if (input.jumpPressed) p.jumpBuf = P.input.buffer;
    if (input.receivePressed) p.receiveT = P.receive.window;
    p.mode = (input.controlHeld || input.faceGoalHeld) ? 'control' : input.sprintHeld ? 'sprint' : 'run';

    if (p.kickBuf > 0 && !p.kick) { p.kickBuf = 0; this._startKick(p, input); }
    if (p.kick) this._kickLogic(p, input);

    // защитная стойка — только без мяча и вне удара; с мячом та же кнопка ничего не меняет
    p.guard = input.guardHeld && !p.possession && !p.kick && p.y <= 0 && !p.juggle;
    if (p.juggle) this._juggle(p, input);
    if (p.guard) {
      p.mode = 'guard';
      const m = Math.hypot(input.mx, input.mz);
      if (p.jumpBuf > 0 && m > 0.3) {
        // прыжок с направлением в стойке — рывок в сторону; без направления остаётся обычный прыжок
        p.jumpBuf = 0;
        if (!p.lunge && p.lungeCd <= 0) {
          p.lunge = { t: 0, dx: input.mx / m, dz: input.mz / m };
          this.events.push({ type: 'lunge' });
        }
      }
    }

    const kickWaiting = p.kick && (p.kick.phase === 'charge' || p.kick.phase === 'ready');
    if (p.jumpBuf > 0 && p.y <= 0 && (!p.kick || kickWaiting)) {
      p.jumpBuf = 0;
      const b = this.ball, since = (this.tick - p.lastTouchTick) * dt;
      const popped = (p.lastTouchKind === 'flick' || p.lastTouchKind === 'juggle') && since < 1.3 && b.y > 0.25 && this._ballDist(p) < P.juggle.maxDist;
      if (!p.kick && p.juggle) {
        p.juggle.high = true; // во время чеканки прыжок — высокий подбив: под удар головой или через себя
      } else if (!p.kick && popped) {
        // мяч подброшен и ещё в воздухе: повторное нажатие начинает чеканку
        p.juggle = { side: p.lastStrike ? -1 : 1, n: 0, high: false, swing: null, tc: 0, lx: b.x, lz: b.z };
        this.events.push({ type: 'juggle_start' });
      } else if (!p.kick && p.possession && this._ballDist(p) < P.player.legReach) {
        p.flick = true; // подброс: выполнит ближайшее реальное касание
      } else {
        p.vy = P.player.jumpSpeed; p.y = 1e-4;
        this.events.push({ type: 'jump' });
      }
    }
  }

  _ballDist(p) { return Math.hypot(this.ball.x - p.x, this.ball.z - p.z); }

  // Чеканка: мяч летает свободно; когда он опускается к высоте касания, стопа выходит под него и подбивает.
  // Подбив нацелен в точку перед игроком с учётом его движения. Не достал — серия кончается, мяч падает сам.
  _juggle(p, input) {
    const P = this.P, J = P.juggle, b = this.ball, dt = this.dt, j = p.juggle, g = P.ball.gravity;
    const foot = p.feet[j.side > 0 ? 1 : 0];
    const onGround = b.y <= P.ball.radius + 0.03 && Math.abs(b.vy) < 1;
    if (p.kick || p.y > 0 || input.sprintHeld || input.guardHeld || onGround || this._ballDist(p) > J.maxDist) { this._endJuggle(p); return; }
    p.mode = 'control';
    const hc = p.y + J.height;
    // время до высоты касания на спуске и точка, где мяч её пересечёт
    const disc = b.vy * b.vy + 2 * g * (b.y - hc);
    j.tc = disc > 0 ? (b.vy + Math.sqrt(disc)) / g : 0;
    j.lx = b.x + b.vx * j.tc; j.lz = b.z + b.vz * j.tc;
    if (!j.swing && b.vy < 0.5 && j.tc <= J.lead && !foot.swing) {
      j.swing = true;
      foot.swing = null; foot.planted = false; foot.ctl = { jug: true };
    }
    if (!j.swing) return;
    const rem = Math.max(j.tc, dt), a = Math.min(1, dt / rem);
    foot.x += (j.lx - foot.x) * a; foot.z += (j.lz - foot.z) * a; foot.h += (hc - 0.1 - foot.h) * a; foot.yaw = p.yaw;
    if (b.y > hc + 0.02 || b.vy > 0) return;
    if (Math.hypot(foot.x - b.x, foot.z - b.z) > J.reach) {
      this.events.push({ type: 'touch_miss', reason: 'чеканка: стопа не достала мяч' });
      this._endJuggle(p);
      return;
    }
    // подбив: вверх и к точке перед игроком, куда он придёт за время полёта; следующей работает другая нога
    const vy = j.high ? J.highPop : J.pop, tf = 2 * vy / g;
    const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw), rx = -fz, rz = fx, next = -j.side;
    let vx = (p.x + fx * J.front + rx * next * J.side + p.vx * tf * 0.9 - b.x) / tf;
    let vz = (p.z + fz * J.front + rz * next * J.side + p.vz * tf * 0.9 - b.z) / tf;
    const hv = Math.hypot(vx, vz); if (hv > 2.6) { vx *= 2.6 / hv; vz *= 2.6 / hv; }
    b.vx = vx; b.vz = vz; b.vy = vy; b.wx = b.wy = b.wz = 0;
    j.n++; j.high = false; j.swing = false; j.side = next;
    p.lastTouchTick = this.tick; p.lastTouchKind = 'juggle';
    foot.ctl = null; this._lift(foot, 0.18, 0.02, false);
    this.stats.touches++;
    this.events.push({ type: 'touch', kind: 'juggle', n: j.n, speed: vy });
  }

  _endJuggle(p) {
    const j = p.juggle;
    if (!j) return;
    for (const f of p.feet) if (f.ctl && f.ctl.jug) { f.ctl = null; this._lift(f, 0.16, 0.02, false); }
    if (j.n > 0) this.events.push({ type: 'juggle_end', n: j.n });
    p.juggle = null;
  }

  // ---------- план касания при владении ----------
  _touchPlan(p, input) {
    if (!p.possession || p.kick || p.y > 0 || p.juggle) return null;
    const P = this.P, b = this.ball;
    if (p.flick) return { kind: 'flick', dx: Math.cos(p.yaw), dz: Math.sin(p.yaw), speed: 0, urgent: true };
    const mag = Math.hypot(input.mx, input.mz);
    const bs = Math.hypot(b.vx, b.vz);
    if (mag > 0.1) {
      const dx = input.mx / mag, dz = input.mz / mag;
      const ms = this._modeSpeed(p) * Math.min(1, mag);
      const push = p.mode === 'sprint' ? P.dribble.pushSprint : p.mode === 'control' ? P.dribble.pushControl : P.dribble.pushRun;
      const along = b.vx * dx + b.vz * dz;
      const lat = Math.abs(-b.vx * dz + b.vz * dx);
      // сила толчка и потребность в нём привязаны к фактической скорости игрока: с места — мягче, на ходу — дальше
      const cur = Math.min(ms, Math.max(p.vx * dx + p.vz * dz + 2.0, ms * 0.7));
      if (along < cur + P.dribble.needMargin || lat > P.dribble.lateralTolerance) {
        // urgent: мяч идёт не туда — нужна внеочередная подработка, а не ожидание ритма шага
        const urgent = bs < 0.5 || lat > P.dribble.lateralTolerance || along < -0.2;
        // после срезки/убирания следующему касанию нужна пауза: один манёвр — одно понятное касание
        const since = (this.tick - p.lastTouchTick) * this.dt;
        if ((p.lastTouchKind === 'drag' || p.lastTouchKind === 'cut' || !urgent) && since < 0.16) return null;
        let kind = 'push', pdx = dx, pdz = dz, speed = cur + push * clamp(mag, 0.4, 1), faceYaw = Math.atan2(dz, dx);
        if (urgent && bs > 0.8) {
          const turn = Math.acos(clamp((b.vx * dx + b.vz * dz) / bs, -1, 1));
          if (turn > 2.1) {
            // разворот: подошва сверху, мяч убирается назад мимо опорной ноги, корпус открывается боком
            kind = 'drag';
            if (!p.dragSign) {
              const cand = [1, -1].map((s) => {
                const a = Math.atan2(dz, dx) + s * 0.62;
                return Math.abs((p.x - b.x) * Math.sin(a) - (p.z - b.z) * Math.cos(a));
              });
              p.dragSign = cand[0] >= cand[1] ? 1 : -1;
            }
            const a = Math.atan2(dz, dx) + p.dragSign * 0.62;
            pdx = Math.cos(a); pdz = Math.sin(a);
            speed = ms * 0.75 + 0.4;
            const old = Math.atan2(b.vz, b.vx);
            faceYaw = old + angDiff(a, old) * 0.5;
          } else if (turn > 0.85) {
            kind = 'cut'; speed = ms * 0.9 + push * 0.6; // срезка щёчкой или внешней стороной
          }
        }
        if (kind !== 'drag') p.dragSign = 0;
        return { kind, dx: pdx, dz: pdz, speed, urgent, faceYaw };
      }
      p.dragSign = 0;
      return null;
    }
    p.dragSign = 0;
    if (bs > 0.35) return { kind: 'trap', dx: 0, dz: 0, speed: 0, urgent: true };
    return null;
  }

  _modeSpeed(p) {
    const P = this.P.player;
    return p.mode === 'guard' ? this.P.guard.speed : p.mode === 'sprint' ? P.sprintSpeed : p.mode === 'control' ? P.controlSpeed : P.runSpeed;
  }

  // ---------- мотор ----------
  _motor(p, input, plan) {
    const P = this.P, PP = P.player, dt = this.dt, b = this.ball;
    const mag = Math.min(1, Math.hypot(input.mx, input.mz));
    let ix = 0, iz = 0;
    if (mag > 0.05) { const m = Math.hypot(input.mx, input.mz); ix = input.mx / m; iz = input.mz / m; }
    const ms = this._modeSpeed(p);
    let dvx = 0, dvz = 0, rateScale = 1, faceYaw = null, faceBall = false, ov = null;
    const k = p.kick;
    const toBall = () => (Math.hypot(b.x - p.x, b.z - p.z) > 0.25 ? Math.atan2(b.z - p.z, b.x - p.x) : null);
    // корпус при ударе — по линии удара; при ударе через себя — спиной к воротам
    const kickYaw = () => (k.bike ? Math.atan2(-k.az, -k.ax) : Math.atan2(k.az, k.ax));

    if (p.lunge && !k) {
      // рывок: короткий мощный толчок в сторону, затем быстрое торможение; корпус остаётся лицом к мячу
      const L = p.lunge, G = P.guard;
      L.t += dt;
      if (L.t < G.lungeTime && !p.possession) { dvx = L.dx * G.lungeSpeed; dvz = L.dz * G.lungeSpeed; ov = { a: G.lungeAccel, b: G.lungeAccel }; }
      else { if (L.t < G.lungeTime) L.t = G.lungeTime; ov = { a: G.brake, b: G.brake }; }
      faceYaw = toBall();
      if (L.t >= G.lungeTime + G.lungeRecover) { p.lunge = null; p.lungeCd = G.lungeCooldown; }
    } else if (p.juggle && !k) {
      // чеканка: медленное движение по команде плюс подстройка под точку, куда опускается мяч
      const J = P.juggle, j = p.juggle, fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);
      dvx = ix * J.speed * mag; dvz = iz * J.speed * mag;
      const ex = j.lx - fx * J.front + fz * j.side * J.side - p.x, ez = j.lz - fz * J.front - fx * j.side * J.side - p.z, el = Math.hypot(ex, ez);
      if (el > 0.03) { const sp = Math.min(1.6, el * 6); dvx += (ex / el) * sp; dvz += (ez / el) * sp; }
      if (mag > 0.05) faceYaw = Math.atan2(iz, ix);
      rateScale = 1.2;
    } else if (p.guard) {
      // стойка: приставной шаг в любую сторону, корпус всегда развёрнут к мячу
      const G = P.guard;
      dvx = ix * G.speed * mag; dvz = iz * G.speed * mag;
      if (mag <= 0.05 && (this.tick - p.recvTick) * dt < 1.2) {
        // сразу после приёма, если игрок ничего не жмёт, он сам делает шаг за опускающимся мячом — к точке следующего касания
        const ex = b.x + b.vx * 0.25 - Math.cos(p.yaw) * 0.45 - p.x, ez = b.z + b.vz * 0.25 - Math.sin(p.yaw) * 0.45 - p.z, el = Math.hypot(ex, ez);
        if (el > 0.08) { const sp = Math.min(G.speed, el * 6); dvx = (ex / el) * sp; dvz = (ez / el) * sp; }
      }
      ov = { a: G.accel, b: G.brake };
      faceYaw = toBall();
      rateScale = 1.3;
    } else if (k && k.plan && (k.phase === 'charge' || k.phase === 'ready' || (k.phase === 'windup' && k.dyn))) {
      // удар в касание: выйти в точку встречи к расчётному моменту, корпус — по линии удара
      const ex = k.plan.sx - p.x, ez = k.plan.sz - p.z, el = Math.hypot(ex, ez);
      const tl = k.phase === 'windup' ? k.windDur - k.t + P.kick.strikeSwing : k.plan.t;
      const sp = Math.min(P.kick.strikeSpeed, el / Math.max(tl - 0.03, 0.04));
      if (el > 0.02) { dvx = (ex / el) * sp; dvz = (ez / el) * sp; }
      k.bike = !!k.plan.bike;
      faceYaw = kickYaw();
      rateScale = 1.6;
    } else if (k && k.dyn) {
      dvx = p.vx; dvz = p.vz; faceYaw = kickYaw(); // удар с хода: инерция сохраняется
    } else if (k && (k.phase === 'charge' || k.phase === 'ready')) {
      // автоматическая подстройка под удар; направления управляют прицелом, а не движением
      const ax = k.ax, az = k.az, rx = -az, rz = ax;
      const relx = p.x - b.x, relz = p.z - b.z;
      const dist = Math.hypot(relx, relz);
      let tx, tz;
      if (dist > 2.6 || b.y > 0.5) { tx = p.x; tz = p.z; if (b.y > 0.5 && dist < 2.6) { tx = b.x + b.vx * 0.15 - ax * 0.3; tz = b.z + b.vz * 0.15 - az * 0.3; } }
      else {
        const bp = predictRoll(b, 0.08, P, this._tmp);
        tx = bp.x - ax * 0.3 - rx * k.footSide * 0.13; tz = bp.z - az * 0.3 - rz * k.footSide * 0.13;
        if (relx * ax + relz * az > -0.05 && dist < 0.9) {
          // игрок перед мячом относительно удара: обойти сбоку, не проходя сквозь мяч
          const s = (relx * rx + relz * rz) >= 0 ? 1 : -1;
          tx = bp.x + rx * s * 0.45 - ax * 0.1; tz = bp.z + rz * s * 0.45 - az * 0.1;
        }
      }
      let ex = tx - p.x, ez = tz - p.z;
      const el = Math.hypot(ex, ez);
      const sp = Math.min(P.kick.approachSpeed, el * 9);
      if (el > 1e-4) { dvx = (ex / el) * sp + b.vx * 0.6; dvz = (ez / el) * sp + b.vz * 0.6; }
      faceYaw = Math.atan2(az, ax);
      rateScale = 1.2;
    } else if (k) {
      rateScale = 0.6; faceYaw = kickYaw(); // замах/контакт/окно подкрутки: короткая опорная фаза
    } else if (p.possession && p.y <= 0) {
      const relx = b.x - p.x, relz = b.z - p.z, dist = Math.hypot(relx, relz);
      rateScale = PP.ballAccelFactor;
      if (mag > 0.05) {
        const along = relx * ix + relz * iz;
        const lat = -relx * iz + relz * ix;
        if (plan && plan.urgent && Math.hypot(b.vx, b.vz) > 0.5) {
          // сначала подработать мяч: идём за ним, корпус уже разворачивается к новой команде
          if (dist > 0.5) {
            const ex = b.x + b.vx * 0.1 - p.x, ez = b.z + b.vz * 0.1 - p.z, el = Math.hypot(ex, ez) || 1;
            dvx = (ex / el) * ms; dvz = (ez / el) * ms;
          } else { dvx = b.vx * 0.9; dvz = b.vz * 0.9; }
          const l = Math.hypot(dvx, dvz); if (l > ms) { dvx *= ms / l; dvz *= ms / l; }
        } else if (dist > 0.85 || along < -0.15) {
          const tx = b.x + b.vx * 0.15 - ix * 0.3, tz = b.z + b.vz * 0.15 - iz * 0.3;
          const ex = tx - p.x, ez = tz - p.z, el = Math.hypot(ex, ez) || 1;
          const sp = ms * Math.max(mag, 0.6);
          dvx = (ex / el) * sp; dvz = (ez / el) * sp;
          if (along < -0.15) faceBall = true; // мяч позади команды: развернуться к нему и убрать под себя
        } else {
          const steer = clamp(lat * 3, -1.2, 1.2);
          dvx = ix * ms * mag + -iz * steer; dvz = iz * ms * mag + ix * steer;
        }
        faceYaw = faceBall ? Math.atan2(relz, relx) : plan && plan.kind === 'drag' ? plan.faceYaw : Math.atan2(iz, ix);
      } else if (plan && plan.kind === 'trap') {
        const tx = b.x + b.vx * 0.2, tz = b.z + b.vz * 0.2;
        const ex = tx - p.x, ez = tz - p.z, el = Math.hypot(ex, ez);
        if (el > 0.45) {
          const sp = Math.min(ms, (el - 0.35) * 6);
          dvx = b.vx * 0.8 + (ex / el) * sp; dvz = b.vz * 0.8 + (ez / el) * sp;
          const l = Math.hypot(dvx, dvz); if (l > ms) { dvx *= ms / l; dvz *= ms / l; }
        }
      } else if (Math.hypot(b.vx, b.vz) < 0.35 && dist < 1.0) {
        // мяч остановлен: короткий корректирующий шаг, чтобы встать за мячом, а не над ним
        const ex = b.x - Math.cos(p.yaw) * 0.4 - p.x, ez = b.z - Math.sin(p.yaw) * 0.4 - p.z, el = Math.hypot(ex, ez);
        if (el > 0.1) { const sp = Math.min(1.8, el * 5); dvx = (ex / el) * sp; dvz = (ez / el) * sp; }
        rateScale = 1.4;
      }
    } else {
      dvx = ix * ms * mag; dvz = iz * ms * mag;
      if (mag > 0.05) faceYaw = Math.atan2(iz, ix);
    }
    if (faceYaw === null && input.faceGoalHeld && !k) faceYaw = p.side < 0 ? 0 : Math.PI; // Q без направления: к атакуемым воротам

    if (p.y > 0) {
      // в воздухе — только слабая коррекция
      const ex = dvx - p.vx, ez = dvz - p.vz, el = Math.hypot(ex, ez);
      if (el > 1e-6) { const s = Math.min(el, PP.airControl * dt); p.vx += (ex / el) * s; p.vz += (ez / el) * s; }
      p.vy -= P.ball.gravity * dt; p.y += p.vy * dt;
      if (p.y <= 0) { p.y = 0; p.vy = 0; this.events.push({ type: 'land' }); }
    } else {
      const ex = dvx - p.vx, ez = dvz - p.vz, el = Math.hypot(ex, ez);
      if (el > 1e-6) {
        const stopping = Math.hypot(dvx, dvz) < 0.05;
        const opposing = p.vx * ex + p.vz * ez < 0;
        const rate = ov ? (stopping || opposing ? ov.b : ov.a) : (stopping ? PP.brake : opposing ? PP.reverseBrake : PP.accel) * rateScale;
        const s = Math.min(el, rate * dt);
        p.vx += (ex / el) * s; p.vz += (ez / el) * s;
      }
    }
    p.x += p.vx * dt; p.z += p.vz * dt;

    // ориентация корпуса — отдельно от намерения и скорости
    if (faceYaw !== null) {
      const d = angDiff(faceYaw, p.yaw), w0 = PP.turnSpring * (p.guard || p.lunge ? 1.3 : 1);
      p.yawVel += (w0 * w0 * d - 2 * w0 * p.yawVel) * dt;
      p.yawVel = clamp(p.yawVel, -PP.turnRate, PP.turnRate);
    } else p.yawVel *= Math.exp(-14 * dt);
    p.yaw += p.yawVel * dt;
    if (p.yaw > Math.PI) p.yaw -= TAU; else if (p.yaw < -Math.PI) p.yaw += TAU;

    // границы: своя половина по телу и борта — мягкий упор без рывка
    const F = P.field, R = PP.radius;
    const minX = p.side < 0 ? -F.length / 2 + R : R + 0.05, maxX = p.side < 0 ? -R - 0.05 : F.length / 2 - R;
    if (p.x < minX) { p.x = minX; if (p.vx < 0) p.vx = 0; }
    if (p.x > maxX) { p.x = maxX; if (p.vx > 0) p.vx = 0; }
    const maxZ = F.width / 2 - R;
    if (p.z < -maxZ) { p.z = -maxZ; if (p.vz < 0) p.vz = 0; }
    if (p.z > maxZ) { p.z = maxZ; if (p.vz > 0) p.vz = 0; }
    // ворота стоят в поле: игрок в них не заходит — упирается в раму спереди или в сетку сбоку
    const gX = F.length / 2 - F.goalInset - R, gZ = F.goalWidth / 2 + R;
    if (Math.abs(p.x) > gX && Math.abs(p.z) < gZ) {
      const sgx = p.x < 0 ? -1 : 1, sgz = p.z < 0 ? -1 : 1;
      if (Math.abs(p.x) - gX < gZ - Math.abs(p.z)) { p.x = sgx * gX; if (p.vx * sgx > 0) p.vx = 0; }
      else { p.z = sgz * gZ; if (p.vz * sgz < 0) p.vz = 0; }
    }
  }

  // Параметры цикла бега. Ориентиры из биомеханики: частота шагов ~2,7–3,3 Гц, доля опоры в цикле
  // 0,3–0,4 при беге 3–3,5 м/с (полёт ~0,1 с на шаг) и около 0,5 на малой скорости (полёта нет).
  // С мячом шаги короче и чаще, опора дольше: игрок ниже и «приземлённее», полёт короче.
  _gaitParams(speed, withBall) {
    return {
      T: clamp(0.40 - 0.025 * speed, 0.27, 0.38) * (withBall ? 0.9 : 1), // время одного шага, с
      D: clamp(0.64 - 0.09 * speed + (withBall ? 0.05 : 0), 0.3, 0.6), // доля опоры одной ноги в полном цикле (два шага)
    };
  }

  // ---------- стопы: единая фаза цикла, строгое чередование; опора закреплена в мире ----------
  _feet(p, plan) {
    const P = this.P, PP = P.player, dt = this.dt, b = this.ball;
    const speed = Math.hypot(p.vx, p.vz);
    const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw), rx = -fz, rz = fx;
    const feet = p.feet;
    const wide = p.guard || p.lunge;
    const spread = PP.footSpread * (wide ? P.guard.spread : 1);

    if (p.y > 0) {
      for (const f of feet) {
        if (f.ctl) continue;
        const hx = p.x + rx * f.side * spread, hz = p.z + rz * f.side * spread;
        const a = Math.min(1, 14 * dt);
        f.x += (hx - f.x) * a; f.z += (hz - f.z) * a;
        f.h = Math.max(f.h, 0) + (p.y - f.h) * Math.min(1, 20 * dt);
        f.yaw = p.yaw; f.planted = false; f.swing = null; f.air = true;
      }
      p.gait = false;
      return;
    }
    for (const f of feet) if (f.air) { f.air = false; f.planted = true; f.h = 0; }

    const moving = speed > 0.3;
    const { T, D } = this._gaitParams(speed, p.possession);
    const cycle = 2 * T, contact = D * cycle;
    const kicking = p.kick && (p.kick.phase === 'windup' || p.kick.phase === 'swing');
    const special = (f) => f.ctl || (f.swing && !f.swing.gait); // нога занята ударом или внеочередным шагом
    const psi = (i) => (((p.gaitPhase - i * 0.5) % 1) + 1) % 1; // фаза ноги: [0, D) — опора, [D, 1) — мах

    if (moving && !p.gait && !kicking && !feet[0].swing && !feet[1].swing && !feet[0].ctl && !feet[1].ctl) {
      // старт: первой идёт нога, оставшаяся позади по ходу движения; первый шаг укорочен
      p.gait = true;
      const d0 = (feet[0].x - p.x) * p.vx + (feet[0].z - p.z) * p.vz;
      const d1 = (feet[1].x - p.x) * p.vx + (feet[1].z - p.z) * p.vz;
      const first = d0 <= d1 ? 0 : 1;
      p.gaitPhase = (D + (1 - D) * 0.4 + first * 0.5) % 1;
    }
    if (!moving && !feet[0].swing && !feet[1].swing) p.gait = false;
    // фаза идёт только пока обе ноги в обычном цикле: внеочередной шаг её не сбивает, а перезапускает
    const phaseRuns = p.gait && moving && !kicking && !special(feet[0]) && !special(feet[1]);
    if (phaseRuns) p.gaitPhase = (p.gaitPhase + dt / cycle) % 1;

    for (let i = 0; i < 2; i++) {
      const f = feet[i], o = feet[1 - i];
      if (f.ctl) continue;
      const hx = p.x + rx * f.side * spread, hz = p.z + rz * f.side * spread;
      if (f.swing) {
        const s = f.swing;
        s.t += dt;
        if (s.gait && phaseRuns) {
          // постановка стопы определяется фазой цикла: шаги левой и правой строго равны по времени
          const ps = psi(i);
          s.dur = ps >= D ? s.t + Math.max((1 - ps) * cycle, 0) : s.t;
        }
        const remain = Math.max(s.dur - s.t, dt);
        let tx, tz;
        // касание: стопа идёт к прогнозной точке контакта, если мяч реально достижим
        if (plan && !s.hit) {
          const bp = predictRoll(b, remain, P, this._tmp);
          const ppx = p.x + p.vx * remain, ppz = p.z + p.vz * remain;
          const top = plan.kind === 'trap' || plan.kind === 'drag'; // подошва сверху на мяч
          const ox = top ? (p.x - b.x) : -plan.dx, oz = top ? (p.z - b.z) : -plan.dz;
          const ol = Math.hypot(ox, oz) || 1;
          const off = top ? 0.03 : 0.13;
          const cx = bp.x + (ox / ol) * off, cz = bp.z + (oz / ol) * off;
          s.top = top;
          const dxp = cx - ppx, dzp = cz - ppz, dp = Math.hypot(dxp, dzp);
          const front = dxp * fx + dzp * fz;
          s.armed = dp <= PP.legReach && front > -0.3 && b.y < 0.3 && !(o.swing && o.swing.armed && o.swing !== s);
          if (s.armed) { s.cx = cx; s.cz = cz; }
        } else s.armed = false;
        // срочная подработка, а эта стопа в махе и коснуться не может: короткий подшаг вместо полного шага
        if (plan && plan.urgent && s.gait && !s.armed && !(o.swing && o.swing.armed) && b.y < 0.3 && Math.hypot(b.x - p.x, b.z - p.z) < PP.legReach * 0.95) {
          s.gait = false; s.dur = Math.min(s.dur, s.t + 0.06);
        }
        // срочная подработка ногой, которая уже в махе: мах ускоряется, касание не ждёт конца обычного шага
        if (s.armed && plan.urgent && s.gait && s.dur - s.t > 0.1) { s.gait = false; s.dur = s.t + 0.1; }
        if (s.armed) { tx = s.cx; tz = s.cz; }
        else {
          // постановка ближе под себя — 36% пути опоры впереди, 64% позади: нога дольше толкается назад
          const lead = moving ? remain + contact * 0.36 : 0;
          tx = hx + p.vx * lead; tz = hz + p.vz * lead;
        }
        const u = Math.min(1, s.t / s.dur), u0 = Math.max(0, (s.t - dt) / s.dur);
        // обычный мах — с разгоном и торможением; к мячу стопа идёт равномерно и приходит со скоростью
        // в беге стопа сначала остаётся позади и поднимается (захлёст), потом быстро выносится вперёд;
        // короткие подшаги идут без задержки
        const S = s.gait
          ? (x) => { const y = clamp((x - 0.14) / 0.86, 0, 1); return Math.pow(y * y * (3 - 2 * y), 1.1); }
          : (x) => 0.35 * x + 0.65 * x * x * (3 - 2 * x);
        const a = s.armed ? Math.min(1, dt / remain) : Math.min(1, (S(u) - S(u0)) / Math.max(1e-6, 1 - S(u0)));
        f.x += (tx - f.x) * a; f.z += (tz - f.z) * a;
        s.hTop += ((s.armed && s.top ? 0.19 : 0) - s.hTop) * Math.min(1, dt / Math.max(remain, 0.03));
        f.h = s.lift * Math.sin(Math.PI * Math.pow(u, s.gait ? 0.66 : 0.8)) + s.h0 * (1 - u) * (1 - u) + s.hTop;
        f.yaw += angDiff(p.yaw, f.yaw) * Math.min(1, dt / remain);
        if (s.armed) {
          // обычное касание — стопа у поверхности мяча; подошвой — стопа над мячом
          const gap = Math.hypot(f.x - b.x, f.z - b.z) - (s.top ? 0.1 : P.ball.radius + PP.footRadius);
          s.gap = gap;
          if (gap <= 0 && b.y < 0.3 && (!s.top || f.h > 0.12)) {
            this._applyTouch(p, i, plan);
            if (s.top) this._lift(f, 0.16, 0.02, false); // убрать рабочую ногу с мяча
            else { s.hit = true; s.armed = false; }
            plan = null; // одно касание за шаг симуляции
          }
        }
        if (u >= 1) {
          if (f.swing !== s) continue; // стопа уже начала новый мах после касания подошвой
          if (s.armed && !s.hit) { this.stats.misses++; this.events.push({ type: 'touch_miss', foot: i, gap: s.gap, reason: 'не дотянулся' }); }
          f.swing = null; f.planted = true; f.h = 0; p.lastStrike = i;
          if (p.gait && !(s.gait && phaseRuns)) p.gaitPhase = (i * 0.5) % 1; // внеочередной шаг перезапускает цикл со своей постановки
        }
      } else {
        // пивот: опорная стопа доворачивается на носке, если корпус ушёл дальше анатомического предела
        const ye = angDiff(p.yaw, f.yaw);
        if (Math.abs(ye) > 0.75) f.yaw += ye - Math.sign(ye) * 0.75;
        const dHip = Math.hypot(f.x - p.x, f.z - p.z);
        // опора не может остаться далеко от таза: нога не резиновая. Удар с хода, выход из удара, резкая остановка —
        // стопа переставляется коротким подшагом под корпус (в ударе с хода получается подскок на опорной ноге)
        const tight = kicking || p.lunge;
        if (dHip > (tight ? 0.5 : 0.58) && (!o.swing || dHip > 0.85)) { this._lift(f, tight ? 0.09 : 0.11, 0.04, false); continue; }
        if (kicking) continue; // опорная нога удара стоит, пока корпус над ней
        // внеочередной шаг к мячу — только с двух опор: никаких прыжков на обеих ногах
        const oLanding = o.swing && o.swing.gait && !o.swing.armed && o.swing.dur - o.swing.t < 0.09; // вторая нога уже почти на покрытии
        const urgentNow = plan && plan.urgent && (!o.swing || oLanding) && !o.ctl && b.y < 0.3
          && Math.hypot(b.x - p.x, b.z - p.z) < PP.legReach * 0.95 && this._touchFoot(p, plan, rx, rz) === i;
        // манёвр застал вторую ногу в махе: она ставится коротким подшагом, а не дожидается полного шага
        if (plan && plan.urgent && o.swing && o.swing.gait && !o.swing.armed && !oLanding && b.y < 0.3
          && Math.hypot(b.x - p.x, b.z - p.z) < PP.legReach * 0.95 && this._touchFoot(p, plan, rx, rz) === i) {
          o.swing.gait = false; o.swing.dur = Math.min(o.swing.dur, o.swing.t + 0.06);
        }
        if (urgentNow) { this._lift(f, plan.kind === 'drag' || plan.kind === 'trap' ? 0.15 : 0.12, 0.06, false); continue; }
        if (moving && p.gait) {
          const ps = psi(i);
          if (ps >= D && !special(o)) {
            this._lift(f, Math.max(0.08, (1 - ps) * cycle), 0.05 + 0.07 * speed, true);
          } else if (dHip > 0.78 && !o.swing && !o.ctl) {
            this._lift(f, 0.14, 0.05, false); // опора осталась слишком далеко (резкий манёвр): короткий подшаг
          }
        } else if (!moving && !o.swing && !o.ctl) {
          const dHome = Math.hypot(f.x - hx, f.z - hz);
          const yawErr = Math.abs(angDiff(p.yaw, f.yaw));
          const reachable = plan && Math.hypot(b.x - p.x, b.z - p.z) < PP.legReach;
          if (reachable && this._touchFoot(p, plan, rx, rz) === i) this._lift(f, 0.15, 0.05, false);
          else if (dHome > (wide ? 0.05 : 0.13) || yawErr > 0.6) this._lift(f, wide ? 0.12 : 0.16, 0.04, false);
        }
      }
    }
  }

  _lift(f, dur, lift, gait = false) {
    f.planted = false;
    f.swing = { t: 0, dur, lift, h0: f.h, armed: false, hit: false, gap: 0, cx: 0, cz: 0, top: false, hTop: 0, gait };
  }

  // Какой ногой удобнее коснуться: срезка — ногой с той стороны, где окажется точка контакта;
  // остальное — ближней к мячу. Жёсткого чередования нет.
  _touchFoot(p, plan, rx, rz) {
    const b = this.ball, f = p.feet;
    if (plan.kind === 'cut' || plan.kind === 'push') {
      const lat = (b.x - plan.dx * 0.13 - p.x) * rx + (b.z - plan.dz * 0.13 - p.z) * rz;
      if (Math.abs(lat) > 0.06) return lat > 0 ? 1 : 0;
    }
    return Math.hypot(f[0].x - b.x, f[0].z - b.z) <= Math.hypot(f[1].x - b.x, f[1].z - b.z) ? 0 : 1;
  }

  _applyTouch(p, footIndex, plan) {
    const P = this.P, b = this.ball;
    let kind = plan.kind;
    if (kind === 'flick') {
      b.vx = p.vx + plan.dx * 0.5; b.vz = p.vz + plan.dz * 0.5; b.vy = P.dribble.flickUp;
      b.wx = b.wz = 0; p.flick = false;
    } else if (kind === 'trap') {
      b.vx = 0; b.vz = 0; b.wy = 0;
    } else {
      b.vx = plan.dx * plan.speed; b.vz = plan.dz * plan.speed; b.wy = 0;
    }
    p.lastTouchTick = this.tick; p.lastTouchKind = kind;
    this.stats.touches++;
    this.events.push({ type: 'touch', kind, foot: footIndex, speed: plan.speed });
  }

  // ---------- удар ----------
  _startKick(p, input) {
    const P = this.P, b = this.ball, F = P.field;
    const gx = -p.side * (F.length / 2 - F.goalInset); // центр атакуемых ворот на их линии
    let ax = gx - b.x, az = 0 - b.z;
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    const lat = (b.x - p.x) * -az + (b.z - p.z) * ax;
    p.kick = {
      phase: 'charge', t: 0, charge: 0, released: false, waitT: 0,
      ax, az, gx, aimLat: 0, aimHigh: 0,
      footSide: lat > -0.05 ? 1 : -1,
      e1: this.rng.signed(), e2: this.rng.signed(), // случайность — один раз на попытку
      startYaw: p.yaw, curlIn: 0, curlN: 0, hit: false, plan: null, dynamic: false, dyn: false, high: false, jumped: false, commitTick: 0, bike: false,
    };
    p.flick = false; p.lunge = null; p.guard = false;
    if (p.juggle) this._endJuggle(p);
    this.events.push({ type: 'kick_start' });
  }

  _kickLogic(p, input) {
    const P = this.P, K = P.kick, dt = this.dt, b = this.ball, k = p.kick;
    k.t += dt;
    const attack = -p.side; // +1: атакуем вправо
    if (k.phase === 'charge' || k.phase === 'ready' || k.phase === 'windup' || k.phase === 'swing') {
      // прицел в экранных осях: вверх/вниз — сторона ворот, к воротам — ниже, от ворот — выше
      const tLat = input.mz, tHigh = -input.mx * attack;
      if (input.digital) {
        k.aimLat = clamp(k.aimLat + tLat * K.aimRateDigital * dt, -1, 1);
        k.aimHigh = clamp(k.aimHigh + tHigh * K.aimRateDigital * dt, -1, 1);
      } else {
        const a = Math.min(1, K.aimRateAnalog * dt);
        k.aimLat += (clamp(tLat, -1, 1) - k.aimLat) * a; k.aimHigh += (clamp(tHigh, -1, 1) - k.aimHigh) * a;
      }
    }
    if (!input.kickHeld) k.released = true;
    // удар в касание: заряд продолжает расти и во время замаха, пока кнопка удержана — до самого контакта
    if (k.dyn && !k.released && (k.phase === 'windup' || k.phase === 'swing')) k.charge = Math.min(1, k.charge + dt / K.chargeTime);
    if (k.phase === 'charge') {
      k.charge = Math.min(1, k.charge + dt / K.chargeTime);
      if (!input.kickHeld || k.t > K.chargeTime + K.autoRelease) { k.phase = 'ready'; k.waitT = 0; }
    }
    if (k.phase === 'charge' || k.phase === 'ready') {
      // мяч в динамике: прогноз точки встречи, подстройка, замах заранее, удар в расчётный момент.
      // Заряд — сколько успели удержать к моменту контакта; отпускать кнопку заранее не требуется.
      k.plan = this._strikePlan(p, k);
      if (k.plan) {
        const pl = k.plan;
        if (pl.jump && p.y <= 0 && pl.jumpAt <= dt) {
          p.vy = pl.jump; p.y = 1e-4; k.jumped = true; k.commitTick = this.tick + Math.round(pl.t / dt); k.bike = !!pl.bike;
          this.events.push({ type: 'jump', strike: true });
        }
        if (pl.t <= K.strikeWindup + K.strikeSwing) {
          const rx = -k.az, rz = k.ax;
          k.phase = 'windup'; k.t = 0; k.dyn = true; k.offset = 0; k.high = pl.high; k.bike = !!pl.bike;
          k.windDur = Math.max(0.04, pl.t - K.strikeSwing);
          const foot = p.feet[k.footSide > 0 ? 1 : 0];
          foot.swing = null; foot.planted = false;
          // замах: низкий мяч — нога назад; мяч на весу — нога отводится в сторону и вверх
          // занос: низкий мяч — стопа уходит назад с согнутым коленом; мяч на весу — нога отводится назад-в сторону
          // и поднимается почти до высоты будущего контакта, чтобы пронос шёл по дуге, а не снизу вверх
          // через себя: колено подтянуто перед корпусом, дальше стопа идёт вверх к мячу
          const back = pl.bike ? 0.24 : pl.high ? 0.34 : 0.4, out = pl.bike ? 0.1 : pl.high ? 0.3 : 0.13;
          foot.ctl = {
            tx: p.x - k.ax * back + rx * k.footSide * out, tz: p.z - k.az * back + rz * k.footSide * out,
            th: p.y + (pl.bike ? 0.4 : pl.high ? Math.max(0.35, pl.hRel * 0.85) : 0.26 + 0.14 * k.charge), remain: k.windDur, rel: true, ease: true, t0: k.windDur,
          };
          this.events.push({ type: 'kick_windup', charge: k.charge, dynamic: true, high: pl.high, jump: p.y > 0 });
        }
        if (k.phase === 'ready') { k.waitT += dt; if (k.waitT > K.approachTimeout + K.strikeHorizon) { this.events.push({ type: 'kick_cancel', reason: 'мяч недостижим' }); this._endKick(p, 'timeout'); } }
        return;
      }
      if (k.dynamic && k.phase === 'ready') {
        // мяч летит, но точки встречи нет: короткое ожидание, затем понятная отмена
        k.waitT += dt;
        const away = (b.x - p.x) * (b.vx - p.vx) + (b.z - p.z) * (b.vz - p.vz) > 0;
        if (away && this._ballDist(p) > 2.6 && k.waitT > 0.05) { this.events.push({ type: 'kick_empty' }); this._endKick(p, 'empty'); }
        else if (k.waitT > K.approachTimeout) { this.events.push({ type: 'kick_cancel', reason: 'мяч недостижим' }); this._endKick(p, 'timeout'); }
        return;
      }
      if (k.dynamic) return;
    }
    if (k.phase === 'ready') {
      k.waitT += dt;
      const dist = this._ballDist(p);
      const rx = -k.az, rz = k.ax;
      const relx = b.x - p.x, relz = b.z - p.z;
      const along = relx * k.ax + relz * k.az;
      const lat = relx * rx + relz * rz - k.footSide * 0.12;
      const yawErr = Math.abs(angDiff(Math.atan2(k.az, k.ax), p.yaw));
      const plant = p.feet[k.footSide > 0 ? 0 : 1];
      let go = false;
      if (b.y <= 0.3) go = along > 0.12 && along < 0.55 && Math.abs(lat) < 0.16 && yawErr < 0.9 && !plant.swing;
      else go = b.y < 1.05 && along > -0.05 && along < 0.75 && Math.abs(lat) < 0.4; // воллей
      if (go) {
        k.phase = 'windup'; k.t = 0; k.offset = Math.abs(lat);
        k.windDur = b.y > 0.3 ? 0.05 : 0.08 + 0.06 * k.charge;
        const foot = p.feet[k.footSide > 0 ? 1 : 0];
        foot.swing = null; foot.planted = false;
        foot.ctl = { tx: p.x - k.ax * 0.36 + rx * k.footSide * 0.13, tz: p.z - k.az * 0.36 + rz * k.footSide * 0.13, th: 0.2 + 0.22 * k.charge, remain: k.windDur };
        this.events.push({ type: 'kick_windup', charge: k.charge });
      } else if (dist > 2.6 && k.waitT > 0.05) {
        this.events.push({ type: 'kick_empty' }); this._endKick(p, 'empty');
      } else if (k.waitT > K.approachTimeout) {
        this.events.push({ type: 'kick_cancel', reason: 'мяч недостижим' }); this._endKick(p, 'timeout');
      }
      return;
    }
    if (k.phase === 'windup' && k.t >= k.windDur) {
      k.phase = 'swing'; k.t = 0;
      const foot = p.feet[k.footSide > 0 ? 1 : 0];
      foot.ctl = { tx: b.x + k.ax * 0.1, tz: b.z + k.az * 0.1, th: Math.max(0.02, b.y - 0.1), remain: k.dyn ? K.strikeSwing : 0.075, track: true };
      return;
    }
    if (k.phase === 'swing' && k.t >= (k.dyn ? K.strikeSwing + 0.06 : 0.11) && !k.hit) {
      const foot = p.feet[k.footSide > 0 ? 1 : 0];
      this.stats.kickMisses++;
      this.events.push({ type: 'kick_miss', gap: k.gap ?? 0, reason: 'стопа не достала мяч' });
      this._endKick(p, 'miss');
      return;
    }
    if (k.phase === 'curl') {
      // окно после контакта: ввод добавляет ограниченную подкрутку, игрока не двигает
      k.curlIn += input.mz; k.curlN++;
      if (k.t >= K.curlWindow) {
        const c = clamp(k.curlN ? k.curlIn / k.curlN : 0, -1, 1);
        if (Math.abs(c) > 0.05 && Math.abs(b.vx) > 0.5) b.wy = -c * Math.sign(b.vx) * K.maxSpin;
        this.events.push({ type: 'kick_end', curl: c });
        this._endKick(p, 'done');
      }
    }
  }

  // Точка встречи с мячом, который движется сам: прогноз полёта и отскоков той же физикой,
  // выбор ближайшего момента, когда стопа реально достаёт мяч. Мяч к ноге не подтягивается.
  _strikePlan(p, k) {
    const P = this.P, K = P.kick, PP = P.player, F = P.field, b = this.ball, g = P.ball.gravity;
    const dist = this._ballDist(p);
    k.dynamic = b.y > 0.3 || Math.hypot(b.vx - p.vx, b.vz - p.vz) > 3 || (dist > 1.2 && Math.hypot(b.vx, b.vz) > 1.5);
    if (!k.dynamic) return null;
    if (k.commitTick) {
      // игрок уже выпрыгнул под этот мяч: план — та же встреча, только уточняется положение мяча
      const t = (k.commitTick - this.tick) * this.dt;
      if (t <= 0) { k.commitTick = 0; return null; }
      const q = this._predictBall(t), py = Math.max(0, p.y + p.vy * t - 0.5 * g * t * t), hRel = q.y - py;
      return { t, sx: p.x + p.vx * t, sz: p.z + p.vz * t, bx: q.x, by: q.y, bz: q.z, hRel, high: hRel > 0.35, jump: 0, jumpAt: 0, bike: k.bike };
    }
    const c = Object.assign(this._pred || (this._pred = {}), b);
    const ev = this._predEv || (this._predEv = []);
    const h = 1 / 60, n = Math.round(K.strikeHorizon / h);
    const rx = -k.az, rz = k.ax, air = p.y > 0;
    const R = PP.radius, minX = p.side < 0 ? -F.length / 2 + R : R + 0.05, maxX = p.side < 0 ? -R - 0.05 : F.length / 2 - R, maxZ = F.width / 2 - R;
    let best = null, bestCost = 1e9;
    // игрок спиной к воротам: мяч в воздухе рядом можно пробить через себя, не разворачиваясь
    const backToGoal = !air && Math.cos(p.yaw) * k.ax + Math.sin(p.yaw) * k.az < -0.3;
    for (let i = 1; i <= n; i++) {
      stepBall(c, h, P, ev, null); ev.length = 0;
      const t = i * h;
      if (t < 0.1) continue;
      if (t > bestCost) break;
      if (backToGoal && c.y >= K.bikeMin && t >= 0.16) {
        const pyB = Math.max(K.bikeHop, c.y - K.bikeReach);
        const vyB = Math.sqrt(2 * g * pyB), tUp = vyB / g;
        const jump = t >= tUp ? vyB : (pyB + 0.5 * g * t * t) / t, jumpAt = t >= tUp ? t - tUp : 0;
        // тело — чуть ближе к воротам, чем мяч: стопа приходит к мячу снизу-спереди и отправляет его назад через голову
        const sx0 = c.x + k.ax * 0.12, sz0 = c.z + k.az * 0.12;
        const sx = clamp(sx0, minX, maxX), sz = clamp(sz0, -maxZ, maxZ);
        const reachOk = jumpAt < 0.1
          ? Math.hypot(sx - (p.x + p.vx * t), sz - (p.z + p.vz * t)) <= 0.3
          : Math.hypot(sx - p.x, sz - p.z) <= 0.15 + K.strikeSpeed * Math.max(0, t - 0.04);
        if (pyB <= K.jumpReach && jump <= K.strikeJumpMax && Math.hypot(sx - sx0, sz - sz0) <= 0.12 && reachOk) {
          const cost = t - 0.12; // через себя быстрее, чем разворачиваться к воротам
          if (cost < bestCost) { bestCost = cost; best = { t, sx, sz, bx: c.x, by: c.y, bz: c.z, hRel: c.y - pyB, high: true, jump, jumpAt, bike: true }; }
          continue;
        }
      }
      let py = air ? Math.max(0, p.y + p.vy * t - 0.5 * g * t * t) : 0, jump = 0, jumpAt = 0;
      let hRel = c.y - py;
      if (hRel > K.standReach) {
        if (air) continue;
        const need = c.y - (K.standReach - 0.1);
        if (need > K.jumpReach) continue;
        const vy = Math.sqrt(2 * g * need), tUp = vy / g;
        if (t >= tUp) { jump = vy; jumpAt = t - tUp; }
        else { jump = (need + 0.5 * g * t * t) / t; jumpAt = 0; if (jump > K.strikeJumpMax) continue; }
        py = need; hRel = c.y - py;
      }
      const high = hRel > 0.35;
      // тело встаёт так, чтобы нога в момент контакта была почти выпрямлена с естественным сгибом колена:
      // чем выше мяч относительно таза, тем дальше от него по горизонтали стоит игрок
      const side = high ? 0.24 : 0.13, dyLeg = hRel + 0.02 - 0.9;
      const horiz = Math.sqrt(Math.max(0.32 * 0.32, K.legIdeal * K.legIdeal - dyLeg * dyLeg));
      const back = 0.12 + Math.sqrt(Math.max(0.03, horiz * horiz - (side - 0.09) * (side - 0.09)));
      let sx = c.x - k.ax * back - rx * k.footSide * side, sz = c.z - k.az * back - rz * k.footSide * side;
      const sx0 = sx, sz0 = sz;
      sx = clamp(sx, minX, maxX); sz = clamp(sz, -maxZ, maxZ);
      if (Math.hypot(sx - sx0, sz - sz0) > 0.12) continue; // точка удара за линией центра или за бортом — не достать
      {
        // расстояние таз — голеностоп в момент контакта должно быть естественным: без вытянутой и без сложенной ноги
        const hxj = sx + rx * k.footSide * 0.09, hzj = sz + rz * k.footSide * 0.09;
        const dl = Math.hypot(c.x - k.ax * 0.12 - hxj, c.y + 0.02 - (py + 0.9), c.z - k.az * 0.12 - hzj);
        if (dl > K.legMax || dl < K.legMin) continue;
      }
      if (air && py > 0.02) {
        if (Math.hypot(sx - (p.x + p.vx * t), sz - (p.z + p.vz * t)) > 0.3 + 0.5 * PP.airControl * t * t) continue;
      } else {
        if (jump && jumpAt < 0.1) {
          // прыгать нужно почти сразу: подстроиться уже некогда, игрок полетит с текущей скоростью
          if (Math.hypot(sx - (p.x + p.vx * t), sz - (p.z + p.vz * t)) > 0.25) continue;
        } else if (Math.hypot(sx - p.x, sz - p.z) > 0.15 + K.strikeSpeed * Math.max(0, t - 0.04)) continue;
      }
      // прыжок — почти наравне с ожиданием: эффектный удар раньше, чем мяч опустится; спиной к воротам обычный удар требует разворота
      const cost = t + (jump ? 0.06 : 0) + (backToGoal ? 0.3 : 0);
      if (cost < bestCost) { bestCost = cost; best = { t, sx, sz, bx: c.x, by: c.y, bz: c.z, hRel, high, jump, jumpAt, bike: false }; }
    }
    if (best) {
      // нога — с той стороны, где окажется мяч; без дёрганья при малой разнице
      const lat = (best.bx - p.x) * rx + (best.bz - p.z) * rz;
      if (Math.abs(lat) > 0.18) k.footSide = lat > 0 ? 1 : -1;
    }
    return best;
  }

  _predictBall(t) {
    const c = Object.assign(this._pred2 || (this._pred2 = {}), this.ball), ev = this._predEv || (this._predEv = []);
    const n = Math.round(t * 120);
    for (let i = 0; i < n; i++) { stepBall(c, 1 / 120, this.P, ev, null); ev.length = 0; }
    return c;
  }

  _kickFoot(p) {
    const P = this.P, dt = this.dt, b = this.ball, k = p.kick;
    const foot = p.feet[k.footSide > 0 ? 1 : 0];
    const c = foot.ctl;
    if (!c) return;
    if (c.track) {
      if (k.dyn) {
        // по летящему мячу стопа идёт в точку, где мяч окажется в конце проноса: нога летит по своей дуге
        // и встречает мяч, а не тянется за ним через всё поле
        const q = this._predictBall(Math.max(c.remain, 0));
        c.tx = q.x - k.ax * 0.12; c.tz = q.z - k.az * 0.12; c.th = Math.max(0.02, q.y - 0.08);
      } else { c.tx = b.x + b.vx * dt + k.ax * 0.1; c.tz = b.z + b.vz * dt + k.az * 0.1; c.th = Math.max(0.02, b.y + b.vy * dt - 0.08); }
    }
    if (c.rel) { c.tx += p.vx * dt; c.tz += p.vz * dt; c.th += p.vy * dt; } // замах идёт вместе с телом
    let a = Math.min(1, dt / Math.max(c.remain, dt));
    if (c.ease && c.t0 > 0) {
      // замах — плавно: разгон и торможение в крайней точке
      const S = (x) => x * x * (3 - 2 * x), u1 = 1 - Math.max(c.remain - dt, 0) / c.t0, u0 = 1 - c.remain / c.t0;
      a = Math.min(1, (S(u1) - S(u0)) / Math.max(1e-6, 1 - S(u0)));
    }
    // в проносе стопа сначала выходит на высоту мяча, затем проходит через него по горизонтали — маятником, а не сверху вниз
    const ah = c.track && k.dyn ? Math.min(1, 2.4 * dt / Math.max(c.remain, dt)) : a;
    foot.x += (c.tx - foot.x) * a; foot.z += (c.tz - foot.z) * a; foot.h += (c.th - foot.h) * ah;
    if (k.dyn) {
      // нога не растягивается и не складывается: голеностоп остаётся в анатомическом диапазоне от таза
      const K = P.kick, rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
      const hx = p.x + rx * k.footSide * 0.09, hz = p.z + rz * k.footSide * 0.09, hy = p.y + 0.9;
      const dx = foot.x - hx, dy = foot.h + 0.1 - hy, dz = foot.z - hz, d = Math.hypot(dx, dy, dz) || 1;
      const lim = clamp(d, K.legMin, K.legMax);
      if (lim !== d) { foot.x = hx + dx * lim / d; foot.z = hz + dz * lim / d; foot.h = Math.max(0, hy + dy * lim / d - 0.1); }
    }
    foot.yaw = p.yaw;
    c.remain -= dt;
    if (k.phase === 'swing' && !k.hit) {
      const gap = Math.hypot(foot.x - b.x, foot.h + 0.06 - b.y, foot.z - b.z) - (P.ball.radius + P.player.footRadius + (k.dyn ? 0.06 : 0.02));
      k.gap = gap;
      // по летящему мячу контакт засчитывается, только когда стопа на высоте мяча: без удара «сверху» согнутой ногой
      if (gap <= 0 && (!k.dyn || Math.abs(foot.h + 0.06 - b.y) < 0.15)) this._applyKick(p);
    }
  }

  _applyKick(p) {
    const P = this.P, K = P.kick, F = P.field, b = this.ball, k = p.kick;
    k.hit = true;
    const incoming = Math.hypot(b.vx - p.vx, b.vy - p.vy, b.vz - p.vz);
    const volley = b.y > 0.35, jumpKick = p.y > 0.05;
    let speed = lerp(K.minSpeed, K.maxSpeed, k.dyn ? Math.max(k.charge, K.volleyMinCharge) : k.charge);
    if (k.dyn) speed = Math.min(K.maxSpeed + K.volleyOverMax, speed + K.volleyBonus * incoming); // встречный мяч добавляет силы
    if (k.bike) speed *= K.bikeBonus;
    const tz = k.aimLat * (F.goalWidth / 2) * K.aimWidth;
    let dx = k.gx - b.x, dz = tz - b.z;
    let yaw = Math.atan2(dz, dx);
    let pitch;
    if (volley) {
      // мяч на весу: бьём в выбранную точку створа с поправкой на падение
      const yT = 0.35 + ((k.aimHigh + 1) / 2) * (F.goalHeight - 0.7), d = Math.hypot(dx, dz), tf = d / speed;
      pitch = clamp(Math.atan2(yT - b.y + 0.5 * P.ball.gravity * tf * tf, d) * 180 / Math.PI, -25, 40);
    } else pitch = k.aimHigh < 0 ? lerp(K.pitchMid, K.pitchLow, -k.aimHigh) : lerp(K.pitchMid, K.pitchHigh, k.aimHigh);
    const pSpeed = Math.hypot(p.vx, p.vz);
    const turn = k.bike ? 0 : Math.abs(angDiff(Math.atan2(k.az, k.ax), k.startYaw)) / Math.PI;
    const sigma = K.errBase + K.errSpeed * pSpeed + K.errTurn * turn + K.errCharge * k.charge + K.errOffset * (k.offset || 0)
      + (k.dyn ? K.errVolley + K.errIncoming * incoming : 0) + (k.bike ? K.errBike : 0);
    const errYaw = k.e1 * sigma, errPitch = k.e2 * sigma * 0.6;
    yaw += (errYaw * Math.PI) / 180;
    pitch = (volley ? pitch + errPitch : Math.max(0, pitch + errPitch)) * Math.PI / 180;
    const cp = Math.cos(pitch);
    b.vx = Math.cos(yaw) * cp * speed + p.vx * 0.3;
    b.vz = Math.sin(yaw) * cp * speed + p.vz * 0.3;
    b.vy = Math.sin(pitch) * speed;
    b.wx = b.wy = b.wz = 0;
    if (b.y <= P.ball.radius + 1e-3 && b.vy > 0) b.y = P.ball.radius + 2e-4;
    p.lastTouchTick = this.tick; p.lastKickTick = this.tick;
    k.phase = 'curl'; k.t = 0;
    const foot = p.feet[k.footSide > 0 ? 1 : 0];
    // проводка: стопа продолжает дугу удара дальше по линии и чуть вверх
    foot.ctl = { tx: foot.x + k.ax * 0.42, tz: foot.z + k.az * 0.42, th: volley ? Math.min(foot.h + 0.14, p.y + 0.85) : 0.35 + 0.3 * k.charge, remain: 0.14, rel: true };
    this.stats.kicks++;
    this.events.push({
      type: 'kick', charge: k.charge, speed, aimLat: k.aimLat, aimHigh: k.aimHigh,
      error: { sigma, yaw: errYaw, pitch: errPitch, playerSpeed: pSpeed, turn, offset: k.offset || 0 },
      volley, jump: jumpKick, firstTime: !!k.dyn, incoming, bike: !!k.bike,
    });
  }

  _endKick(p, why) {
    const k = p.kick;
    if (!k) return;
    const foot = p.feet[k.footSide > 0 ? 1 : 0];
    if (foot.ctl) { foot.ctl = null; this._lift(foot, 0.2, 0.03, false); }
    p.kick = null; p.kickBuf = 0; p.gait = false;
  }

  // ---------- корпус и приём ----------
  _bodyCollision(p, b) {
    const P = this.P, G = P.guard, r = P.ball.radius;
    const guarding = p.guard || !!p.lunge;
    // в стойке игрок закрывает больше места: стопы шире, в рывке нога вынесена в сторону
    const R = P.player.radius + (p.lunge ? G.lungeReach : p.guard ? G.reach : 0);
    const y0 = p.y + R, y1 = p.y + P.player.height - R;
    const cy = clamp(b.y, y0, y1);
    let nx = b.x - p.x, ny = b.y - cy, nz = b.z - p.z;
    const d = Math.hypot(nx, ny, nz);
    if (d >= R + r) return;
    const since = (this.tick - p.lastTouchTick) * this.dt;
    if (since < 0.25) return;
    if (p.kick && p.kick.dyn && (p.kick.phase === 'windup' || p.kick.phase === 'swing')) return; // мяч встречает стопа, а не корпус
    if (p.juggle && b.y - p.y < 1.0) return; // чеканка: мячом работают стопы, корпус его не отбивает
    if (d < 1e-6) { nx = Math.cos(p.yaw); nz = Math.sin(p.yaw); ny = 0; } else { nx /= d; ny /= d; nz /= d; }
    const rvx = b.vx - p.vx, rvy = b.vy - p.vy, rvz = b.vz - p.vz;
    const vn = -(rvx * nx + rvy * ny + rvz * nz);
    const relH = b.y - p.y;
    if (relH < 0.4 && vn < 2.5) return; // медленный мяч у ног — область стоп, не корпуса
    if (vn <= 0) return;
    // разрешаем пересечение без взрывного импульса
    const pen = R + r - d;
    b.x += nx * pen; b.y = Math.max(r, b.y + ny * pen); b.z += nz * pen;
    const zone = relH < 0.4 ? 'foot' : relH < 0.95 ? 'thigh' : relH < 1.45 ? 'chest' : 'head';
    const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);

    // качество приёма: точное нажатие по таймингу — лучшее; стойка гасит мяч и без нажатия, рывок — чуть хуже
    let q = 0;
    if (p.receiveT > 0) {
      const age = P.receive.window - p.receiveT;
      q = age >= P.receive.idealFrom && age <= P.receive.idealTo ? 1 : 0.5;
    }
    if (guarding) q = Math.max(q, p.lunge ? G.lungeQuality : G.quality);
    if (q > 0) {
      // мяч гасится телом и опускается перед игроком — в зону следующего касания; остаток скорости зависит от качества
      const leak = guarding ? Math.min(2, (1 - q) * vn * 0.2) : (1 - q) * vn * 0.3; // стойка гасит сильнее: мяч падает в зону контроля
      const carry = p.lunge ? 0.3 : 1; // в рывке мяч не уносится вместе с игроком
      const pvx = p.vx * carry, pvz = p.vz * carry;
      if (zone === 'foot') { b.vx = pvx * 0.6 + nx * (0.3 + leak); b.vz = pvz * 0.6 + nz * (0.3 + leak); b.vy = 0; }
      else if (zone === 'thigh') { b.vx = pvx + fx * (0.5 + leak); b.vz = pvz + fz * (0.5 + leak); b.vy = guarding ? 1.1 : 1.6; }
      else if (zone === 'chest') { b.vx = pvx + fx * (0.7 + leak); b.vz = pvz + fz * (0.7 + leak); b.vy = guarding ? 0.7 : 1.2; }
      else { b.vx = pvx + fx * (1.0 + leak); b.vz = pvz + fz * (1.0 + leak); b.vy = guarding ? 1.6 : 2.2; }
      p.recvTick = this.tick;
      b.wx = b.wy = b.wz = 0;
      p.receiveT = 0; p.gesture = { type: zone, t: 0 };
      p.lastTouchTick = this.tick - Math.round(0.15 / this.dt); // короткая защита от повторного контакта
      this.stats.receives++;
      this.events.push({ type: 'receive', zone, quality: q, speed: vn, guard: guarding });
      return;
    }
    if (zone === 'foot' && p.y <= 0 && !p.kick && nx * fx + nz * fz > -0.25) {
      // игрок повёрнут к мячу: медленный мяч останавливает, быстрый принимает на щёчку — он отскакивает недалеко
      const A = P.receive, stop = vn <= A.autoStop;
      const out = stop ? 0.25 : Math.min(A.cushionMax, A.cushionBase + A.cushionGain * (vn - A.autoStop));
      b.vx = p.vx * 0.6 + nx * out; b.vz = p.vz * 0.6 + nz * out; b.vy = stop ? 0 : 0.5;
      b.wx = b.wy = b.wz = 0;
      const lat = (b.x - p.x) * -fz + (b.z - p.z) * fx;
      p.gesture = { type: stop ? 'foot' : 'cushion', t: 0, foot: lat >= 0 ? 1 : 0 };
      p.lastTouchTick = this.tick - Math.round(0.15 / this.dt); p.recvTick = this.tick;
      this.stats.receives++;
      this.events.push({ type: 'receive', zone, quality: stop ? 0.8 : 0.4, speed: vn, auto: stop ? 'stop' : 'cushion' });
      return;
    }
    if (zone === 'head' && p.y > 0.05) {
      // игра головой в прыжке: направление по корпусу
      const out = 5 + vn * 0.35;
      b.vx = fx * out + p.vx * 0.5; b.vz = fz * out + p.vz * 0.5; b.vy = 2.0 + p.vy * 0.5;
      p.gesture = { type: 'head', t: 0 };
      p.lastTouchTick = this.tick - Math.round(0.15 / this.dt);
      this.events.push({ type: 'header', speed: vn });
      return;
    }
    // пассивное попадание в тело: физический отскок, не считается приёмом
    const e = P.receive.passiveRestitution;
    b.vx = p.vx + (rvx + (1 + e) * vn * nx) * 0.9;
    b.vy = p.vy + (rvy + (1 + e) * vn * ny) * 0.9;
    b.vz = p.vz + (rvz + (1 + e) * vn * nz) * 0.9;
    p.gesture = { type: 'hit', t: 0 };
    this.events.push({ type: 'body', zone, speed: vn });
  }

  _possession(p) {
    const P = this.P, D = P.dribble, b = this.ball, dt = this.dt;
    const dist = this._ballDist(p);
    const rel = Math.hypot(b.vx - p.vx, b.vz - p.vz);
    const was = p.possession;
    if (p.juggle) { p.possession = false; return; } // мяч в воздухе под контролем чеканки: наземное владение не считается
    const recent = (this.tick - p.lastTouchTick) * dt < 0.3;
    p.possession = this.phase === 'play' && b.y < 0.4 && Math.abs(b.vy) < 2 && dist < D.possessionRange && (rel < D.possessionRelSpeed || recent)
      && (this.tick - p.lastKickTick) * dt > 0.35 && b.x * p.side > -0.4;
    if (was && !p.possession && (this.tick - p.lastKickTick) * dt > 0.5 && this.phase === 'play') {
      this.stats.lostControl++;
      this.events.push({ type: 'control_lost', dist, rel });
    }
    if (p.possession) {
      this.stats.possessionTime += dt;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 1 && ((b.x - p.x) * p.vx + (b.z - p.z) * p.vz) / sp < -0.2) { this.stats.behindTime += dt; p.behindTime += dt; }
      else p.behindTime = 0;
    }
  }
}

// ---------- запись и повтор ввода ----------
export function packInput(i) {
  return [
    Math.round(i.mx * 1000), Math.round(i.mz * 1000),
    (i.digital ? 1 : 0) | (i.kickHeld ? 2 : 0) | (i.kickPressed ? 4 : 0) | (i.jumpPressed ? 8 : 0) | (i.receivePressed ? 16 : 0)
    | (i.controlHeld ? 32 : 0) | (i.faceGoalHeld ? 64 : 0) | (i.sprintHeld ? 128 : 0) | (i.feintPressed ? 256 : 0) | (i.superPressed ? 512 : 0)
    | (i.cmdReturn ? 1024 : 0) | (i.cmdServe ? 2048 : 0) | (i.cmdWall ? 4096 : 0) | (i.guardHeld ? 8192 : 0),
  ];
}

export function unpackInput(a, out = emptyInput()) {
  const f = a[2];
  out.mx = a[0] / 1000; out.mz = a[1] / 1000;
  out.digital = !!(f & 1); out.kickHeld = !!(f & 2); out.kickPressed = !!(f & 4); out.jumpPressed = !!(f & 8);
  out.receivePressed = !!(f & 16); out.controlHeld = !!(f & 32); out.faceGoalHeld = !!(f & 64); out.sprintHeld = !!(f & 128);
  out.feintPressed = !!(f & 256); out.superPressed = !!(f & 512);
  out.cmdReturn = !!(f & 1024); out.cmdServe = !!(f & 2048); out.cmdWall = !!(f & 4096); out.guardHeld = !!(f & 8192);
  return out;
}
