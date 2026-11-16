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
    feintPressed: false, superPressed: false, superHeld: false, // вторая кнопка силы: с мячом — суперудар, без мяча — дотянуться
    lobPressed: false, lobHeld: false, // с мячом — навес, без мяча — подкат
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
    kick: null, recover: null, turnRun: false, kickBuf: 0, jumpBuf: 0, receiveT: 0, flick: false,
    lastTouchTick: -1000, lastKickTick: -1000,
    gesture: null, mode: 'run', yawVel: 0, dragSign: 0, lastTouchKind: null,
    guard: false, lunge: null, lungeCd: 0, recvTick: -1000, juggle: null,
    slide: null, slideCd: 0, reach: null, reachCd: 0, superCharge: 0, fall: null, inX: 0, inZ: 0, crouch: 0, jumpPrep: 0, airWide: false,
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
      // насколько игрок сел в стойку: по этому числу опускается и наклоняется коллайдер тела — вслед за моделью
      if (p.jumpPrep > 0) {
        p.jumpPrep -= dt;
        const kw = p.kick && (p.kick.phase === 'charge' || p.kick.phase === 'ready');
        if (p.slide && p.y <= 0) { p.jumpPrep = 0; p.vy = P.player.jumpSpeed * P.tackle.hop; p.y = 1e-4; ev.push({ type: 'jump' }); } // jump, then tackle at once: a flying tackle
        else if (p.y > 0 || p.fall || (p.kick && !kw)) p.jumpPrep = 0; // a planned strike takes off by itself
        else if (p.jumpPrep <= 0) { p.jumpPrep = 0; p.vy = P.player.jumpSpeed; p.y = 1e-4; p.airWide = p.guard || p.crouch > 0.5; ev.push({ type: 'jump' }); }
      }
      p.crouch += ((p.guard || p.lunge ? 1 : 0) - p.crouch) * (1 - Math.exp(-P.guard.crouchRate * dt));
      const plan = live ? this._touchPlan(p, inp) : null;
      this._motor(p, inp, plan);
      this._feet(p, plan);
      if (p.kick) this._kickFoot(p);
      if (p.slide) this._slideFeet(p);
      if (p.fall) this._fallStep(p);
      this._clampFeet(p);
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
    p.slideCd = Math.max(0, p.slideCd - dt);
    p.inX = input.mx; p.inZ = input.mz; // направление команды: по нему корпус отбивает мяч при приёме
    p.reachCd = Math.max(0, p.reachCd - dt);
    if (!live) {
      p.kickBuf = p.jumpBuf = 0; p.guard = false; p.mode = input.sprintHeld ? 'sprint' : 'run';
      if (p.juggle) this._endJuggle(p);
      if (p.reach) this._endReach(p);
      return;
    }
    p.superCharge = Math.min(1, p.superCharge + dt / P.kick.superFill);
    // после удара через себя игрок падает и встаёт: до конца подъёма действия недоступны
    if (p.fall && !p.kick) {
      // после удара сбоку в полёте управление возвращается с приземлением: любая команда прерывает посадку в низкую стойку
      const fl = p.fall, back = fl.kind === 'side' && fl.phase === 'land'
        && (Math.hypot(input.mx, input.mz) > 0.15 || input.kickPressed || input.jumpPressed || input.lobPressed || input.guardHeld);
      if (back) this._endFall(p);
      else { p.kickBuf = p.jumpBuf = 0; p.guard = false; p.mode = 'run'; if (p.reach) this._endReach(p); return; }
    }

    if (input.kickPressed && !p.kick) p.kickBuf = P.input.buffer;
    if (input.jumpPressed) p.jumpBuf = P.input.buffer;
    if (input.receivePressed) p.receiveT = P.receive.window;
    p.mode = (input.controlHeld || input.faceGoalHeld) ? 'control' : input.sprintHeld ? 'sprint' : 'run';

    // Две кнопки действия зависят от того, у игрока ли мяч: с мячом — навес и суперудар, без мяча — подкат и дотянуться ногой
    const hasBall = this._hasBall(p);
    if (p.kickBuf > 0 && !p.kick && !p.slide) { p.kickBuf = 0; this._startKick(p, input); }
    if (input.lobPressed && !p.kick && !p.slide) {
      // в чеканке та же кнопка — прокидывание себе на ход: мяч вверх и чуть вперёд, под удар в прыжке
      if (p.juggle) { if (!p.juggle.toss) { p.juggle.toss = true; this.events.push({ type: 'toss_ready' }); } }
      else if (hasBall) this._startKick(p, input, 'lob'); else this._startSlide(p, input);
    }
    if (input.superPressed && !p.kick && !p.slide && hasBall) {
      if (p.superCharge >= 1) this._startKick(p, input, 'super');
      else this.events.push({ type: 'super_empty', charge: p.superCharge });
    }
    if (p.kick) this._kickLogic(p, input);

    // защитная стойка — только без мяча и вне удара; с мячом та же кнопка ничего не меняет
    p.guard = input.guardHeld && !p.possession && !p.kick && p.y <= 0 && !p.juggle && !p.slide;
    this._reachLogic(p, input, hasBall);
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
    if (P.kick.jumpKicks && p.jumpBuf > 0 && kickWaiting && !p.kick.jumpOk) {
      // прыжок при зажатом ударе разрешает удары по высокому мячу. Если мяч уже идёт высоко, игрок не прыгает сразу:
      // толчок произойдёт в расчётный момент, под удар; иначе это обычный прыжок, и бить можно уже из него
      p.kick.jumpOk = true;
      if (p.y <= 0 && p.kick.dynamic && this.ball.y > 1.0) { p.jumpBuf = 0; this.events.push({ type: 'kick_armed' }); }
    }
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
        // из подката прыжок ниже: игрок отрывается от покрытия и летит дальше с вынесенной ногой
        if (p.slide) { p.vy = P.player.jumpSpeed * P.tackle.hop; p.y = 1e-4; this.events.push({ type: 'jump' }); }
        else if (!(p.jumpPrep > 0)) p.jumpPrep = P.player.jumpPrep; // short crouch first: the push-off must be seen

      }
    }
  }

  _ballDist(p) { return Math.hypot(this.ball.x - p.x, this.ball.z - p.z); }

  // «С мячом»: мяч под контролем на покрытии, в чеканке или только что подброшен и ещё в воздухе рядом
  _hasBall(p) {
    if (p.possession || p.juggle) return true;
    const b = this.ball, since = (this.tick - p.lastTouchTick) * this.dt;
    const dist = this._ballDist(p);
    if ((p.lastTouchKind === 'flick' || p.lastTouchKind === 'juggle' || p.lastTouchKind === 'toss') && since < 1.6 && b.y > 0.25 && dist < this.P.juggle.maxDist) return true;
    // the ball is in the air right by the player (after a receive, a bounce, a lofted pass): it is his ball as well -
    // close now, or coming within reach in under half a second
    // a low ball further away is still a tackle target (sliding or in the air), and so is any ball once the player has jumped
    if (p.y > 0 || b.y <= 0.3 || b.y > 2.8 || b.x * p.side < -0.4 || (b.y < 0.75 && dist > 0.9)) return false;
    const rvx = b.vx - p.vx, rvz = b.vz - p.vz;
    if (dist < 1.6 && Math.hypot(rvx, rvz) < 6) return true;
    return Math.hypot(b.x + rvx * 0.45 - p.x, b.z + rvz * 0.45 - p.z) < 1.2 && dist < 3.2;
  }

  // ---------- подкат ----------
  // Направление — по команде движения; без команды — к мячу, если он рядом, иначе по корпусу. Можно начать и в прыжке.
  _startSlide(p, input) {
    const b = this.ball;
    if (p.slideCd > 0 || p.lunge || p.juggle) return;
    const m = Math.hypot(input.mx, input.mz);
    let dx = Math.cos(p.yaw), dz = Math.sin(p.yaw);
    if (m > 0.3) { dx = input.mx / m; dz = input.mz / m; }
    else {
      const bx = b.x - p.x, bz = b.z - p.z, bd = Math.hypot(bx, bz);
      if (bd > 0.3 && bd < 4) { dx = bx / bd; dz = bz / bd; }
    }
    // ведущая нога — правая; левая — только когда мяч рядом и явно слева по ходу подката. Иначе нога зависела бы от того,
    // с какой стороны лежит далёкий мяч, то есть от направления подката на площадке
    const fwdB = (b.x - p.x) * dx + (b.z - p.z) * dz, latB = (b.x - p.x) * -dz + (b.z - p.z) * dx;
    const lat = fwdB > -0.3 && fwdB < 3 && latB < -0.12 && latB > -1.2 ? -1 : 1;
    if (p.reach) this._endReach(p);
    p.slide = { t: 0, dx, dz, foot: lat >= 0 ? 1 : 0, hit: false, ext: 0 };
    p.guard = false; p.gait = false; p.recover = null;
    for (const f of p.feet) { f.swing = null; f.planted = false; f.ctl = { slide: true }; }
    this.events.push({ type: 'slide' });
  }

  _endSlide(p) {
    for (const f of p.feet) if (f.ctl && f.ctl.slide) { f.ctl = null; this._lift(f, 0.14, 0.03, false, true); }
    p.slide = null; p.slideCd = this.P.tackle.cooldown;
  }

  // Стопы в подкате: ведущая выносится вперёд по ходу и идёт у самого покрытия, вторая подогнута под корпус.
  // Мяч, которого коснулась ведущая стопа, выбивается по ходу подката.
  _slideFeet(p) {
    const P = this.P, T = P.tackle, b = this.ball, dt = this.dt, S = p.slide;
    const e = S.t < T.time ? clamp(S.t / T.extend, 0, 1) : clamp(1 - (S.t - T.time) / T.recover, 0, 1);
    S.ext = e * e * (3 - 2 * e);
    const rx = -S.dz, rz = S.dx, side = S.foot ? 1 : -1, a = Math.min(1, 28 * dt);
    const lead = p.feet[S.foot], trail = p.feet[1 - S.foot];
    const la = 0.12 + (T.reach - 0.12) * S.ext;
    lead.x += (p.x + S.dx * la + rx * side * 0.06 - lead.x) * a; lead.z += (p.z + S.dz * la + rz * side * 0.06 - lead.z) * a;
    lead.h += (p.y + 0.02 + 0.06 * S.ext - lead.h) * a;
    trail.x += (p.x - S.dx * 0.16 * S.ext - rx * side * 0.17 - trail.x) * a; trail.z += (p.z - S.dz * 0.16 * S.ext - rz * side * 0.17 - trail.z) * a;
    trail.h += (p.y + 0.03 * S.ext - trail.h) * a;
    lead.yaw = trail.yaw = Math.atan2(S.dz, S.dx);
    if (!S.hit && S.ext > 0.5 && S.t < T.time + 0.08 && this.phase === 'play') {
      const gap = Math.hypot(lead.x - b.x, lead.h + 0.06 - b.y, lead.z - b.z) - (P.ball.radius + P.player.footRadius + T.hit);
      if (gap <= 0) {
        const sp = Math.max(Math.hypot(p.vx, p.vz), 2.5) + T.knock;
        b.vx = S.dx * sp; b.vz = S.dz * sp; b.vy = Math.max(b.vy * 0.3, T.pop); b.wx = b.wy = b.wz = 0;
        if (b.y <= P.ball.radius + 1e-3) b.y = P.ball.radius + 2e-4;
        S.hit = true;
        p.lastTouchTick = this.tick; p.lastTouchKind = 'tackle';
        p.superCharge = Math.min(1, p.superCharge + P.kick.superTackle);
        this.stats.touches++;
        this.events.push({ type: 'tackle', speed: sp, air: p.y > 0.05 });
      }
    }
  }

  // Толчок под удар через себя или сбоку в полёте: с этого момента игрок летит и после удара упадёт
  // launch = false — игрок уже в прыжке: толчка нет, начинается только полёт под удар
  _takeoff(p, k, pl, launch = true) {
    if (launch) { p.vy = pl.jump; p.y = 1e-4; }
    k.jumped = true; k.bike = !!pl.bike; k.fly = pl.fly || 0;
    if (k.fly) k.footSide = k.fly;
    if (k.bike) p.fall = { kind: 'back', phase: 'air', t: 0, k: 0, roll: 0, yaw: Math.atan2(-k.az, -k.ax), ux: -k.ax, uz: -k.az, kickFoot: k.footSide > 0 ? 1 : 0 };
    // сбоку в полёте: корпус ложится поперёк линии удара головой от бьющей ноги
    else if (k.fly) p.fall = { kind: 'side', phase: 'air', t: 0, k: 0, roll: 0, side: k.fly, spinT: 0, spinDur: this.P.fall.pose, yaw: Math.atan2(k.az, k.ax), yaw0: Math.atan2(k.az, k.ax), ax0: k.ax, az0: k.az, ux: -k.az * k.fly, uz: k.ax * k.fly, kickFoot: k.fly > 0 ? 1 : 0 };
    if (launch) this.events.push({ type: 'jump', strike: true });
  }

  // ---------- падение после удара через себя ----------
  // В воздухе — «ножницы»: свободная нога идёт вверх первой, на проносе бьющей уходит вниз. После удара игрок падает на спину
  // (fall.roll ≠ 0 — набок), лежит с согнутыми коленями и встаёт, выходя корпусом к стопам. fall.k: 0 — стоит, 1 — лежит.
  _fallStep(p) {
    const F = this.P.fall, dt = this.dt, fl = p.fall, k = p.kick;
    if (fl.kind === 'side') { this._flyStep(p); return; }
    // оси позы лёжа: u — от таза к стопам (по корпусу), поперёк — разводит стопы
    const fx = fl.ux, fz = fl.uz, rx = -fz, rz = fx;
    if (k) fl.kickFoot = k.footSide > 0 ? 1 : 0;
    if (fl.phase === 'air') {
      if (p.y <= 0 && !k) { fl.phase = 'down'; fl.t = 0; fl.v0 = Math.max(1.5, fl.vy || 0); this.events.push({ type: 'fall', roll: fl.roll }); }
      else fl.vy = -p.vy; // скорость снижения: с ней тело продолжает опускаться, когда уровень стоп дошёл до покрытия
    } else {
      fl.t += dt;
      if (fl.phase === 'down') { fl.k = Math.min(1, (fl.v0 * fl.t + 0.5 * this.P.ball.gravity * fl.t * fl.t) / F.height); if (fl.t >= F.down) { fl.phase = 'rise'; fl.t = 0; } }
      else {
        const u = Math.min(1, fl.t / F.rise); fl.k = 1 - u;
        if (u >= 1) { this._endFall(p); return; }
      }
    }
    const phase = fl.phase, kp = k ? k.phase : null;
    for (let i = 0; i < 2; i++) {
      const f = p.feet[i], sgn = i ? 1 : -1, isKick = i === fl.kickFoot;
      f.air = false; f.planted = false;
      if (f.ctl && !f.ctl.fall) continue; // ногу ведёт удар
      if (!f.ctl) {
        if (isKick && k && phase === 'air') continue; // бьющая нога до замаха — обычная нога в прыжке
        f.swing = null; f.ctl = { fall: true };
      }
      let fo, lo = sgn * 0.1, h, rate;
      if (phase === 'air') {
        if (k && (kp === 'charge' || kp === 'ready')) { fo = 0.35; h = p.y + 0.5; rate = 9; } // взлёт: свободная нога начинает мах
        else if (k && kp === 'windup') { fo = 0.5; h = p.y + 1.15; rate = 13; } // замах бьющей: свободная уже наверху
        else if (k) { fo = 0.62; h = p.y + 0.45; rate = 16; } // пронос и контакт: ноги меняются местами
        else if (isKick) { fo = 0.5; lo = sgn * 0.12; h = p.y + 0.7; rate = 8; } // после удара ноги опускаются над точками приземления
        else { fo = 0.5; lo = sgn * 0.12; h = p.y + 0.3; rate = 8; }
      } else if (phase === 'down') { fo = 0.5; lo = sgn * 0.12; h = 0; rate = 11; }
      else continue; // подъём: стопы стоят, корпус выходит к ним
      const a = Math.min(1, rate * dt);
      // стопа, вставшая на покрытие, больше не едет: дальше к ней подходит корпус
      const still = phase === 'down' && (f.ctl.set || (f.h < 0.03 && fl.t > 0.08));
      if (still) f.ctl.set = true;
      else { f.x += (p.x + fx * fo + rx * lo - f.x) * a; f.z += (p.z + fz * fo + rz * lo - f.z) * a; }
      f.h += (h - f.h) * a;
      f.yaw = fl.yaw;
    }
    if (phase === 'rise') for (const f of p.feet) if (f.ctl && f.ctl.fall) { f.h = Math.max(0, f.h - 2 * dt); f.yaw = fl.yaw; }
  }

  _endFall(p) {
    for (const f of p.feet) if (f.ctl && f.ctl.fall) {
      f.ctl = null;
      if (f.h > 0.05) this._lift(f, 0.16, 0, false, true); else { f.planted = true; f.h = 0; } // нога, ещё не вставшая, доопускается шагом, а не рывком
    }
    p.fall = null; p.gait = false;
  }

  // Удар сбоку в полёте: падения нет. После контакта бьющая нога по инерции идёт дальше через корпус, тело разворачивается
  // следом вокруг своей оси и выпрямляется, игрок приходит на вторую ногу, бьющая встаёт рядом чуть позже.
  // Стопы заданы в осях исходной линии удара: вперёд (ax0, az0) и в сторону бьющей ноги (ux, uz).
  _flyStep(p) {
    const F = this.P.fall, dt = this.dt, fl = p.fall, k = p.kick, kp = k ? k.phase : null;
    if (k) fl.kickFoot = k.footSide > 0 ? 1 : 0;
    const after = !k || kp === 'curl';
    let s = 0, sp = 0; // доля разворота и доля смены поз
    if (after) {
      // the strike takes the upward speed out of the jump: the player does not hang in the air after it
      if (!fl.spinT && p.y > 0) p.vy = Math.min(p.vy, F.hang);
      fl.spinT += dt;
      s = clamp(fl.spinT / F.spin, 0, 1); sp = clamp(fl.spinT / F.pose, 0, 1);
      // винт начинается рывком — нога после удара тянет тело за собой — и гаснет к приземлению
      fl.yaw = fl.yaw0 - fl.side * F.turn * (1 - (1 - s) * (1 - s));
    }
    if (fl.phase === 'air') { if (p.y <= 0 && !k) { fl.phase = 'land'; fl.t = 0; } }
    else {
      fl.t += dt;
      // посадка: быстро вниз, в низкую стойку, и медленнее вверх
      const d = 0.09, u = fl.t < d ? fl.t / d : 1 - (fl.t - d) / (F.land - d);
      fl.k = clamp(u, 0, 1); fl.k = fl.k * fl.k * (3 - 2 * fl.k);
      if (fl.t >= F.land && fl.spinT >= F.spin) { this._endFall(p); return; }
    }
    const air = fl.phase === 'air';
    for (let i = 0; i < 2; i++) {
      const f = p.feet[i], isKick = i === fl.kickFoot;
      f.air = false;
      if (f.ctl && !f.ctl.fall) { f.planted = false; continue; } // ногу ведёт удар
      if (!f.ctl) {
        if (isKick && k && air) { f.planted = false; continue; }
        f.swing = null; f.ctl = { fall: true };
      }
      // Targets: fo/lo along the original kick line and towards the kicking side - before the turn; once the body has
      // turned, in the body's own frame (fwd / own side), otherwise 'behind' would end up in front of the player
      let fo = 0, lo = 0, h, rate, body = false;
      const own = i ? 1 : -1;
      if (!after) {
        if (kp !== 'swing') { fo = 0.05; lo = -0.12; h = p.y + 0.18; rate = 10; } else { fo = -0.05; lo = -0.25; h = p.y + 0.05; rate = 14; }
      } else if (!isKick) {
        // the other leg: tucked up under the body through the spin, then snapped down - the player lands on it
        body = true;
        if (air && sp < 0.45) { fo = 0.1; lo = own * 0.1; h = p.y + 0.36; rate = 12; }
        else { fo = 0.08; lo = own * 0.13; h = air ? p.y + 0.02 : 0; rate = 16; }
      } else if (air && sp < 0.3) { fo = 0.4; lo = -0.3; h = p.y + 0.85; rate = 12; } // kicking leg carries on across the body
      else if (air && sp < 0.72) { body = true; fo = -0.5; lo = own * 0.12; h = p.y + 0.45; rate = 11; } // then trails stretched out behind
      else { body = true; fo = -0.3; lo = own * 0.17; h = air ? p.y + 0.12 : 0; rate = 14; } // and comes down a step behind the other: a split stance
      const a = Math.min(1, rate * dt);
      if (!f.ctl.set) {
        const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
        const tx = body ? p.x + cy * fo - sy * lo : p.x + fl.ax0 * fo + fl.ux * lo, tz = body ? p.z + sy * fo + cy * lo : p.z + fl.az0 * fo + fl.uz * lo;
        f.x += (tx - f.x) * a; f.z += (tz - f.z) * a; f.h += (h - f.h) * a;
        if (!air && (!isKick || (f.h < 0.02 && fl.t >= 0.05))) { f.ctl.set = true; f.h = 0; } // встала — дальше не едет
        else {
          // нога не складывается через таз: голеностоп не ближе 0,45 м от тазобедренного сустава
          const sg = i ? 1 : -1, hx = p.x - Math.sin(p.yaw) * sg * 0.09, hz = p.z + Math.cos(p.yaw) * sg * 0.09, hy = p.y + 0.9;
          const dx = f.x - hx, dy = f.h + 0.1 - hy, dz = f.z - hz, dd = Math.hypot(dx, dy, dz);
          if (dd < 0.45 && dd > 1e-4) { const q = 0.45 / dd; f.x = hx + dx * q; f.z = hz + dz * q; f.h = Math.max(0, hy + dy * q - 0.1); }
        }
      }
      f.planted = !!f.ctl.set;
      f.yaw = p.yaw;
    }
  }

  // ---------- дотянуться до мяча ----------
  // Пока кнопка удержана, игрок следит за мячом: как только прогноз показывает, что мяч пройдёт в пределах выпада,
  // ближайшая нога выходит ему навстречу. Касание гасит мяч и оставляет его перед игроком — в зоне следующего касания.
  _reachLogic(p, input, hasBall) {
    const P = this.P, R = P.reach, b = this.ball, dt = this.dt, r = P.ball.radius;
    let rc = p.reach;
    const want = input.superHeld && (rc || !hasBall) && !p.fall && !p.kick && !p.slide && !p.lunge && p.y <= 0 && p.reachCd <= 0;
    if (!want) { if (rc) this._endReach(p); return; }
    let hit = null;
    const c = Object.assign(this._pred || (this._pred = {}), b), ev = this._predEv || (this._predEv = []);
    const h = 1 / 60, n = Math.round(R.horizon / h);
    for (let i = 0; i <= n; i++) {
      if (i) { stepBall(c, h, P, ev, null); ev.length = 0; }
      const t = i * h, d = Math.hypot(c.x - (p.x + p.vx * t * R.slow), c.z - (p.z + p.vz * t * R.slow));
      if (d <= R.range && d >= R.minDist && c.y - r <= R.maxH) { hit = c; hit.t = t; break; }
    }
    if (!hit) { if (rc) this._endReach(p); return; }
    if (!rc) {
      if (hit.t > R.lead) return;
      const lat = (hit.x - p.x) * -Math.sin(p.yaw) + (hit.z - p.z) * Math.cos(p.yaw), i = lat >= 0 ? 1 : 0, f = p.feet[i];
      if (f.ctl || p.feet[1 - i].ctl) return;
      f.swing = null; f.planted = false; f.ctl = { reach: true };
      rc = p.reach = { foot: i, t: 0, ext: 0 };
      this.events.push({ type: 'reach' });
    }
    const f = p.feet[rc.foot];
    rc.t += dt;
    // стопа приходит к мячу со стороны игрока и чуть ниже центра мяча; быстрее 10 м/с нога не движется
    const ox = p.x - hit.x, oz = p.z - hit.z, ol = Math.hypot(ox, oz) || 1;
    const tx = hit.x + (ox / ol) * 0.1, tz = hit.z + (oz / ol) * 0.1, th = Math.max(0.02, hit.y - 0.1);
    const ex = tx - f.x, ey = th - f.h, ez = tz - f.z, el = Math.hypot(ex, ey, ez);
    if (el > 1e-5) {
      const s = Math.min(el, Math.max(el * dt / Math.max(hit.t, dt), 0), 10 * dt) / el;
      f.x += ex * s; f.h += ey * s; f.z += ez * s;
    }
    f.yaw = p.yaw;
    rc.ext = clamp(Math.hypot(f.x - p.x, f.z - p.z) / R.range, 0, 1);
    const gap = Math.hypot(f.x - b.x, f.h + 0.06 - b.y, f.z - b.z) - (r + P.player.footRadius + R.hit);
    if (gap <= 0) {
      const rel = Math.hypot(b.vx - p.vx, b.vy, b.vz - p.vz);
      let vx = (p.x + Math.cos(p.yaw) * R.front - b.x) / R.settle + p.vx * 0.5, vz = (p.z + Math.sin(p.yaw) * R.front - b.z) / R.settle + p.vz * 0.5;
      const vl = Math.hypot(vx, vz); if (vl > R.maxOut) { vx *= R.maxOut / vl; vz *= R.maxOut / vl; }
      b.vx = vx; b.vz = vz; b.vy = b.y > 0.3 ? 0.6 : 0; b.wx = b.wy = b.wz = 0;
      p.recvTick = this.tick; p.lastTouchKind = 'reach';
      p.lastTouchTick = this.tick - Math.round(0.15 / dt);
      p.superCharge = Math.min(1, p.superCharge + P.kick.superReceive * R.quality);
      this.stats.receives++;
      this.events.push({ type: 'receive', zone: 'foot', quality: R.quality, speed: rel, reach: true });
      this._endReach(p); p.reachCd = R.cooldown;
    } else if (rc.t > 0.6) { this._endReach(p); p.reachCd = R.cooldown; }
  }

  _endReach(p) {
    const rc = p.reach;
    if (!rc) return;
    const f = p.feet[rc.foot];
    if (f.ctl && f.ctl.reach) { f.ctl = null; this._lift(f, 0.24, 0.03, false, true); }
    p.reach = null;
  }

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
    const toss = !!j.toss;
    if (toss) { vx = fx * J.tossFwd + p.vx * 0.5; vz = fz * J.tossFwd + p.vz * 0.5; }
    b.vx = vx; b.vz = vz; b.vy = toss ? J.tossPop : vy; b.wx = b.wy = b.wz = 0;
    j.n++; j.high = false; j.swing = false; j.side = next;
    p.lastTouchTick = this.tick; p.lastTouchKind = toss ? 'toss' : 'juggle';
    p.superCharge = Math.min(1, p.superCharge + P.kick.superJuggle);
    foot.ctl = null; this._lift(foot, 0.18, 0.02, false);
    this.stats.touches++;
    this.events.push({ type: 'touch', kind: toss ? 'toss' : 'juggle', n: j.n, speed: toss ? J.tossPop : vy });
    if (toss) this._endJuggle(p); // мяч ушёл высоко: дальше — удар в прыжке, навес с лёта или приём
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
    if (!p.possession || p.kick || p.y > 0 || p.juggle || p.fall) return null;
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
    // Стойка на полном ходу от мяча, когда мяч остался между игроком и его воротами: пятиться незачем и слишком медленно —
    // игрок разворачивается по ходу движения и бежит обычным бегом. Возврат в стойку — когда перестал уходить от мяча.
    if (p.guard && mag > 0.8) {
      const bd = Math.hypot(b.x - p.x, b.z - p.z) || 1, away = -(ix * (b.x - p.x) + iz * (b.z - p.z)) / bd;
      p.turnRun = away > (p.turnRun ? 0.3 : 0.6) && (b.x - p.x) * p.side > 0.5;
      if (p.turnRun) { p.guard = false; p.mode = input.sprintHeld ? 'sprint' : 'run'; }
    } else p.turnRun = false;
    const ms = this._modeSpeed(p);
    let dvx = 0, dvz = 0, rateScale = 1, faceYaw = null, faceBall = false, ov = null;
    const k = p.kick;
    if (p.recover) { p.recover.t += dt; if (k || mag > 0.05 || p.y > 0 || p.guard || p.recover.t >= p.recover.dur) p.recover = null; }
    const toBall = () => (Math.hypot(b.x - p.x, b.z - p.z) > 0.25 ? Math.atan2(b.z - p.z, b.x - p.x) : null);
    // корпус при ударе — по линии удара; при ударе через себя — спиной к воротам
    const kickYaw = () => (k.bike ? Math.atan2(-k.az, -k.ax) : Math.atan2(k.az, k.ax));

    if (p.slide && !k) {
      // подкат: резкий толчок по ходу, скольжение с замедлением, затем подъём; направление в подкате не меняется
      const S = p.slide, T = P.tackle;
      S.t += dt;
      if (S.t < T.time) { const u = S.t / T.time, sp = T.speed * (1 - 0.7 * u * u); dvx = S.dx * sp; dvz = S.dz * sp; ov = { a: T.accel, b: T.accel }; }
      else ov = { a: T.brake, b: T.brake };
      faceYaw = Math.atan2(S.dz, S.dx); rateScale = 1.4;
      if (S.t >= T.time + T.recover && p.y <= 0) this._endSlide(p);
    } else if (p.fall && !k) {
      // падение после удара через себя: в воздухе игрок летит по инерции, на покрытии лежит; вставая, выходит корпусом к стопам
      const fl = p.fall, F = P.fall;
      if (p.y > 0) { dvx = p.vx; dvz = p.vz; }
      else if (fl.phase === 'rise') { const sp = fl.k < 0.8 && fl.k > 0.2 ? F.step / (F.rise * 0.6) : 0; dvx = fl.ux * sp; dvz = fl.uz * sp; }
      ov = fl.kind === 'side' ? { a: 16, b: 16 } : { a: 30, b: 30 }; // после удара сбоку игрок приходит на ноги и гасит ход шагом
      faceYaw = fl.yaw;
    } else if (p.lunge && !k) {
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
    } else if (!k && p.y <= 0 && p.lastTouchKind === 'flick' && (this.tick - p.lastTouchTick) * dt < 1.4 && b.y > 0.3 && this._ballDist(p) < P.juggle.maxDist) {
      // мяч подброшен и ещё в воздухе: игрок не стоит столбом, а подстраивается под точку, куда мяч опустится
      const J = P.juggle, g = P.ball.gravity, hc = J.height, disc = b.vy * b.vy + 2 * g * (b.y - hc);
      const tc = disc > 0 ? (b.vy + Math.sqrt(disc)) / g : 0;
      const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);
      dvx = ix * J.speed * mag; dvz = iz * J.speed * mag;
      const ex = b.x + b.vx * tc - fx * J.front - p.x, ez = b.z + b.vz * tc - fz * J.front - p.z, el = Math.hypot(ex, ez);
      if (el > 0.04) { const sp = Math.min(2.2, el * 5); dvx += (ex / el) * sp; dvz += (ez / el) * sp; }
      if (mag > 0.05) faceYaw = Math.atan2(iz, ix);
    } else if (p.guard) {
      // стойка: приставной шаг в любую сторону, корпус всегда развёрнут к мячу.
      // Спиной вперёд человек бежит медленнее и короткими шагами: чем точнее игрок отходит от мяча, тем ниже скорость.
      const G = P.guard, bd = Math.hypot(b.x - p.x, b.z - p.z) || 1;
      const away = clamp(-(ix * (b.x - p.x) + iz * (b.z - p.z)) / bd, 0, 1); // 1 — движение точно от мяча
      const gs = G.speed + (G.backSpeed - G.speed) * clamp((away - 0.3) / 0.5, 0, 1);
      dvx = ix * gs * mag; dvz = iz * gs * mag;
      if (mag <= 0.05 && (this.tick - p.recvTick) * dt < 1.2 && b.y < 0.5) { // only once the ball is down: walking under a dropping ball would knock it up again
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
      const tl = k.phase === 'windup' ? k.windDur - k.t + k.swingDur : k.plan.t;
      const sp = Math.min(this._strikeCap(p, k, k.plan.sx, k.plan.sz), el / Math.max(tl - 0.03, 0.04));
      if (el > 0.02) { dvx = (ex / el) * sp; dvz = (ez / el) * sp; }
      k.bike = !!k.plan.bike;
      faceYaw = kickYaw();
      rateScale = 1.6;
    } else if (k && k.free && (k.phase === 'charge' || k.phase === 'ready')) {
      // удар удержан, мяча в зоне нет: игрок бежит по команде, как без удара
      dvx = ix * ms * mag; dvz = iz * ms * mag;
      if (mag > 0.05) faceYaw = Math.atan2(iz, ix);
    } else if (k && k.dyn) {
      dvx = p.vx; dvz = p.vz; faceYaw = kickYaw(); // удар с хода: инерция сохраняется
    } else if (k && (k.phase === 'charge' || k.phase === 'ready')) {
      // автоматическая подстройка под удар; направления управляют прицелом, а не движением
      const ax = k.ax, az = k.az, rx = -az, rz = ax;
      const relx = p.x - b.x, relz = p.z - b.z;
      const dist = Math.hypot(relx, relz);
      let tx, tz, open = 0;
      // the ball is flying and there is no point where the foot meets it: the player does not run after it — he waits
      // (it may come back off the fence); only a ball dropping nearby is worth a step under it
      const chase = !k.dynamic || (b.y > 0.5 && Math.hypot(b.vx, b.vz) < 4);
      if (dist > 2.6 || b.y > 0.5 || !chase) { tx = p.x; tz = p.z; if (chase && b.y > 0.5 && dist < 2.6) { tx = b.x + b.vx * 0.15 - ax * 0.3; tz = b.z + b.vz * 0.15 - az * 0.3; } }
      let intent = false;
      if (!chase) {
        // out of reach, but the player shows he is going for it: a short step towards the ball's path, no further
        const KK = P.kick;
        if (k.ix === undefined) { k.ix = p.x; k.iz = p.z; }
        const qx = b.x + b.vx * 0.2 - k.ix, qz = b.z + b.vz * 0.2 - k.iz, ql = Math.hypot(qx, qz);
        // once the ball has gone past behind him the step is not turned after it: no backing after the ball
        if (ql > 0.6 && (qx * ax + qz * az) / ql > -0.25) { k.itx = k.ix + (qx / ql) * KK.intentStep; k.itz = k.iz + (qz / ql) * KK.intentStep; }
        if (k.itx !== undefined) { tx = k.itx; tz = k.itz; intent = true; }
      }
      else {
        // заход сбоку: игрок встаёт позади мяча со стороны опорной ноги и разворачивается к бьющей —
        // так подходит к мячу бьющий подъёмом; через удар корпус доворачивается по линии удара и дальше
        const bp = predictRoll(b, 0.08, P, this._tmp), KK = P.kick;
        tx = bp.x - ax * KK.approachBack - rx * k.footSide * KK.approachSide; tz = bp.z - az * KK.approachBack - rz * k.footSide * KK.approachSide;
        open = k.footSide * KK.approachAngle;
        if (relx * ax + relz * az > -0.05 && dist < 0.9) {
          // игрок перед мячом относительно удара: обойти сбоку, не проходя сквозь мяч
          const s = (relx * rx + relz * rz) >= 0 ? 1 : -1;
          tx = bp.x + rx * s * 0.45 - ax * 0.1; tz = bp.z + rz * s * 0.45 - az * 0.1;
        }
      }
      let ex = tx - p.x, ez = tz - p.z;
      const el = Math.hypot(ex, ez);
      const sp = Math.min(intent ? P.kick.intentSpeed : P.kick.approachSpeed, this._strikeCap(p, k, tx, tz), el * (intent ? 5 : 9));
      const lead = k.dynamic ? 0 : 0.6; // a rolling ball is followed; a flying one is not chased
      if (el > 1e-4) { dvx = (ex / el) * sp + b.vx * lead; dvz = (ez / el) * sp + b.vz * lead; }
      faceYaw = Math.atan2(az, ax) + open;
      rateScale = 1.2;
    } else if (k) {
      // замах/контакт/окно подкрутки: короткая опорная фаза. Удар с места по лежащему мячу: в замахе корпус ещё
      // раскрыт к бьющей ноге, в проносе доворачивается на линию удара, после контакта — немного за неё
      const side = !k.bike && k.sideOn ? k.footSide * P.kick.approachAngle : 0;
      // доворот начинается во второй половине замаха — вместе с ходом бедра вперёд — и опережает цель,
      // чтобы к контакту таз успел выйти почти на линию удара
      const early = k.phase === 'windup' && k.t < k.windDur * 0.4;
      rateScale = side && !early ? 1.6 : 0.6;
      faceYaw = kickYaw() + (early ? side : k.phase === 'windup' ? 0 : k.phase === 'swing' ? -side * 0.4 : -side * 0.6);
      // после контакта корпус не замирает: вес идёт вперёд по линии удара, вслед за ногой
      if (side && k.phase === 'curl') { dvx = k.ax * P.kick.followSpeed; dvz = k.az * P.kick.followSpeed; }
    } else if (p.recover) {
      // выход из удара: корпус по инерции проходит вперёд и останавливается над бьющей ногой, которая встала шагом вперёд.
      // Любая команда движения сразу снимает это состояние — тело подстраивается под следующее движение.
      const R = p.recover, u = R.t / R.dur, sp = R.speed * (u < 0.45 ? 1 : (1 - u) / 0.55);
      dvx = R.ax * sp; dvz = R.az * sp; faceYaw = R.yaw;
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
    if (p.fall && p.fall.kind === 'side' && p.fall.spinT > 0) { faceYaw = p.fall.yaw; rateScale = 1.6; } // разворот вслед за бьющей ногой начинается сразу после контакта
    if (p.reach) { dvx *= P.reach.slow; dvz *= P.reach.slow; } // выпад за мячом: корпус притормаживает
    if (faceYaw === null && input.faceGoalHeld && !k) faceYaw = p.side < 0 ? 0 : Math.PI; // Q без направления: к атакуемым воротам

    if (p.y > 0) {
      // в воздухе — только слабая коррекция
      const ex = dvx - p.vx, ez = dvz - p.vz, el = Math.hypot(ex, ez);
      if (el > 1e-6) { const s = Math.min(el, PP.airControl * dt); p.vx += (ex / el) * s; p.vz += (ez / el) * s; }
      // удар сбоку в полёте: после контакта игрок не летит дальше по ходу подхода — разворачивается и опускается почти на месте
      if (p.fall && p.fall.kind === 'side' && p.fall.spinT > 0) { const d = Math.exp(-P.fall.stop * dt); p.vx *= d; p.vz *= d; }
      p.vy -= P.ball.gravity * dt; p.y += p.vy * dt;
      if (p.y <= 0) { p.y = 0; p.vy = 0; p.airWide = false; this.events.push({ type: 'land' }); }
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
    // разворот после удара сбоку быстрее обычного предела поворота корпуса: угол задаёт само движение
    if (p.fall && p.fall.kind === 'side' && p.fall.spinT > 0 && p.fall.spinT <= P.fall.spin + dt) { p.yaw = p.fall.yaw % TAU; p.yawVel = 0; }
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
  // Без мяча ниже ~2 м/с игрок идёт, а не семенит трусцой: шаг 110–130 в минуту, длиннее, с двойной опорой
  // (доля опоры ~0,6), стопа поднимается ниже. Переход к бегу — на 1,4–2,0 м/с: близкий контроль (1,9 м/с) остаётся трусцой.
  // back — доля движения спиной вперёд (0..1): шаги короче и чаще, стопа идёт низко, опора дольше.
  _gaitParams(speed, withBall, back = 0) {
    if (back > 0) {
      const T = clamp(0.33 - 0.03 * speed, 0.25, 0.32), D = clamp(0.62 - 0.05 * speed, 0.48, 0.6);
      const f = this._gaitParams(speed, withBall, 0);
      return { T: f.T + (T - f.T) * back, D: f.D + (D - f.D) * back, lift: f.lift + (0.05 + 0.01 * speed - f.lift) * back, lead: f.lead + (0.5 - f.lead) * back, far: f.far, pw: f.pw + (0.85 - f.pw) * back };
    }
    const G = this.P.player.runLegs;
    let T =clamp(0.40 - 0.025 * speed, 0.27, 0.38) * (withBall ? 0.9 : 1); // время одного шага, с
    let D = clamp(0.64 - 0.09 * speed + (withBall ? 0.05 : 0), 0.3, 0.6); // доля опоры одной ноги в полном цикле (два шага)
    let lift = 0.05 + 0.05 * speed; // подъём стопы в махе, м
    let lead = 0.36; // доля пути опоры впереди таза: в беге нога дольше толкается назад
    let far = 0.58; // дальше этого опора от таза не остаётся — подшаг; в шаге опора длиннее, толчок идёт с носка
    if (!withBall && speed < 2.0) {
      const s = clamp((speed - 1.4) / 0.6, 0, 1), w = 1 - s * s * (3 - 2 * s);
      T += (clamp(0.60 - 0.09 * speed, 0.45, 0.56) - T) * w;
      D += (clamp(0.64 - 0.05 * speed, 0.56, 0.62) - D) * w; // путь опоры не длиннее ~0,8 м: дальше нога не дотянется без провала таза
      lift += (0.045 + 0.025 * speed - lift) * w;
      lead += 0.06 * w; far += 0.06 * w;
    }
    // fast run without the ball: the heel comes up behind the body right after the push-off (pw < 0.85 moves the top of the
    // swing earlier, while the foot is still behind), and the knee then drives forward high
    let pw = 0.85;
    if (!withBall && speed > G.from) { const k = clamp((speed - G.from) / G.span, 0, 1); lift += G.heel * k; pw -= G.early * k; }
    return { T, D, lift, lead, far, pw };
  }

  // ---------- стопы: единая фаза цикла, строгое чередование; опора закреплена в мире ----------
  _feet(p, plan) {
    const P = this.P, PP = P.player, dt = this.dt, b = this.ball;
    const speed = Math.hypot(p.vx, p.vz);
    const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw), rx = -fz, rz = fx;
    const feet = p.feet;
    const wide = p.guard || p.lunge || (p.y > 0 && p.airWide); // a jump out of the stance keeps the feet apart: no slide on landing
    // sideways across the body (coming under a strike): a side step with the feet apart, otherwise they meet on one line
    const latK = !wide && p.kick && speed > 0.3 ? clamp((Math.abs(p.vx * rx + p.vz * rz) / speed - 0.35) / 0.4, 0, 1) : 0;
    // side shuffle in the stance: the feet never pass each other — the leading foot steps out, the trailing one closes up.
    // For that the stance gets wider and the steps shorter and quicker (see the gait parameters below)
    const latV = Math.abs(p.vx * rx + p.vz * rz), latW = wide && p.y <= 0 && speed > 0.3 ? clamp((latV / speed - 0.35) / 0.4, 0, 1) : 0;
    const spread = PP.footSpread * (wide ? P.guard.spread * (1 + P.guard.sideWide * latW) : 1 + (P.guard.spread - 1) * latK);

    if (p.y > 0) {
      for (const f of feet) {
        if (f.ctl) continue;
        const hx = p.x + rx * f.side * spread, hz = p.z + rz * f.side * spread;
        // нога, только что ударившая в прыжке, возвращается под корпус плавно, а не рывком
        const soft = f.ease > 0;
        if (soft) f.ease -= dt;
        const a = Math.min(1, (soft ? 6 : 14) * dt);
        f.x += (hx - f.x) * a; f.z += (hz - f.z) * a;
        if (soft) f.h = Math.max(f.h, 0) + (p.y - f.h) * Math.min(1, 7 * dt);
        else {
          // legs in flight: stretched on the way up (the toes leave the turf last), tucked at the top — one knee higher,
          // reaching down for the turf on the way down, so the landing starts on nearly straight legs
          const J = PP.jumpLegs, u = clamp(p.vy / PP.jumpSpeed, -1, 1);
          const off = (f.side > 0 ? J.tuckHigh : J.tuckLow) * (1 - u * u) - (u > 0 ? J.push * u : J.reach * -u);
          const rel = Math.max(f.h, 0) - (p.y - p.vy * dt); // against the body height the foot was set for: no lag behind the body
          f.h = Math.max(0, p.y + rel + (off - rel) * Math.min(1, J.rate * dt));
        }
        f.yaw = p.yaw; f.planted = false; f.swing = null; f.air = true;
      }
      p.gait = false;
      return;
    }
    for (const f of feet) if (f.air) {
      f.air = false;
      // стопа, оставшаяся высоко после удара в прыжке, доопускается коротким мягким движением, а не оказывается на покрытии мгновенно
      if (f.h > 0.1 && f.ease > 0) this._lift(f, 0.16, 0, false, true); else { f.planted = true; f.h = 0; }
      f.ease = 0;
    }

    const moving = speed > 0.3;
    const back = speed > 0.3 ? clamp((-(p.vx * fx + p.vz * fz) / speed - 0.3) / 0.5, 0, 1) : 0; // движение спиной вперёд
    const gp = this._gaitParams(speed, p.possession, back), { lead: leadK, far, pw } = gp;
    let { T, D, lift } = gp;
    if (latW > 0) {
      // the gap between the feet swings by about 0.93 of the path covered in one cycle: the cycle is cut so that it swings by sideSwing
      const G = P.guard, Ts = clamp(G.sideSwing / (1.86 * Math.max(latV, 0.5)), G.sideStepMin, T);
      T += (Ts - T) * latW; D += (G.sideDuty - D) * latW; lift += (G.sideLift - lift) * latW;
    }
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
          s.armed = dp <= PP.touchReach && front > -0.3 && b.y < 0.3 && !(o.swing && o.swing.armed && o.swing !== s);
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
          const lead = moving ? remain + contact * leadK : 0;
          tx = hx + p.vx * lead; tz = hz + p.vz * lead;
        }
        const u = Math.min(1, s.t / s.dur), u0 = Math.max(0, (s.t - dt) / s.dur);
        // обычный мах — с разгоном и торможением; к мячу стопа идёт равномерно и приходит со скоростью
        // в беге стопа сначала остаётся позади и поднимается (захлёст), потом быстро выносится вперёд;
        // короткие подшаги идут без задержки
        const S = s.gait
          ? (x) => { const y = clamp((x - 0.05) / 0.95, 0, 1); return y * y * (3 - 2 * y); }
          : (x) => 0.35 * x + 0.65 * x * x * (3 - 2 * x);
        const a = s.armed ? Math.min(1, dt / remain) : Math.min(1, (S(u) - S(u0)) / Math.max(1e-6, 1 - S(u0)));
        f.x += (tx - f.x) * a; f.z += (tz - f.z) * a;
        s.hTop += ((s.armed && s.top ? 0.19 : 0) - s.hTop) * Math.min(1, dt / Math.max(remain, 0.03));
        f.h = s.soft ? s.lift * Math.sin(Math.PI * u) + s.h0 * (1 - u * u * (3 - 2 * u)) + s.hTop
          : s.lift * Math.sin(Math.PI * Math.pow(u, s.gait ? s.pw || 0.85 : 0.8)) + s.h0 * (1 - u) * (1 - u) + s.hTop;
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
        if (dHip > (tight ? 0.5 : far) && (!o.swing || dHip > 0.7)) { this._lift(f, tight ? 0.09 : 0.11, 0.04, false); continue; }
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
            this._lift(f, Math.max(0.08, (1 - ps) * cycle), lift, true);
            f.swing.pw = pw;
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

  // Стопы остаются внутри площадки: нога не проходит сквозь борт
  _clampFeet(p) {
    const F = this.P.field, mx = F.length / 2 - 0.06, mz = F.width / 2 - 0.06;
    for (const f of p.feet) { f.x = clamp(f.x, -mx, mx); f.z = clamp(f.z, -mz, mz); }
  }

  // soft — мягкая постановка с высоты (выход из удара): без резкого начала опускания
  _lift(f, dur, lift, gait = false, soft = false) {
    f.planted = false;
    f.swing = { t: 0, dur, lift, h0: f.h, armed: false, hit: false, gap: 0, cx: 0, cz: 0, top: false, hTop: 0, gait, soft };
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
      b.vx = p.vx * 0.85 + plan.dx * 0.15; b.vz = p.vz * 0.85 + plan.dz * 0.15; b.vy = P.dribble.flickUp;
      b.wx = b.wz = 0; p.flick = false;
      // подброс сразу начинает чеканку: одна кнопка — мяч в воздухе и под контролем
      if (!p.juggle && p.y <= 0) {
        p.juggle = { side: footIndex ? -1 : 1, n: 0, high: false, swing: null, tc: 0, lx: b.x, lz: b.z };
        this.events.push({ type: 'juggle_start' });
      }
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
  // type: 'shot' — обычный удар, 'lob' — навес, 'super' — суперудар (без заряда: сразу полная сила)
  _startKick(p, input, type = 'shot') {
    const P = this.P, b = this.ball, F = P.field;
    const gx = -p.side * (F.length / 2 - F.goalInset); // центр атакуемых ворот на их линии
    let ax = gx - b.x, az = 0 - b.z;
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    const lat = (b.x - p.x) * -az + (b.z - p.z) * ax;
    const sup = type === 'super';
    if (p.reach) this._endReach(p);
    p.kick = {
      jumpOk: p.y > 0 || p.jumpPrep > 0, // удар начат уже в прыжке
      type, phase: sup ? 'ready' : 'charge', t: 0, charge: sup ? 1 : 0, released: sup, waitT: 0,
      ax, az, gx, aimLat: 0, aimHigh: 0,
      footSide: lat > -0.05 ? 1 : -1,
      e1: this.rng.signed(), e2: this.rng.signed(), // случайность — один раз на попытку
      startYaw: p.yaw, curlIn: 0, curlN: 0, hit: false, plan: null, dynamic: false, dyn: false, high: false, jumped: false, commitTick: 0, bike: false,
    };
    p.flick = false; p.lunge = null; p.guard = false;
    if (p.juggle) this._endJuggle(p);
    this.events.push({ type: 'kick_start', kind: type });
  }

  _kickLogic(p, input) {
    const P = this.P, K = P.kick, dt = this.dt, b = this.ball, k = p.kick;
    k.t += dt;
    const attack = -p.side; // +1: атакуем вправо
    if (!k.free && (k.phase === 'charge' || k.phase === 'ready' || k.phase === 'windup' || k.phase === 'swing')) {
      // прицел в экранных осях: вверх/вниз — сторона ворот, к воротам — выше, от ворот — ниже (как в привычных футбольных играх)
      const tLat = input.mz, tHigh = input.mx * attack;
      if (input.digital) {
        k.aimLat = clamp(k.aimLat + tLat * K.aimRateDigital * dt, -1, 1);
        k.aimHigh = clamp(k.aimHigh + tHigh * K.aimRateDigital * dt, -1, 1);
      } else {
        const a = Math.min(1, K.aimRateAnalog * dt);
        k.aimLat += (clamp(tLat, -1, 1) - k.aimLat) * a; k.aimHigh += (clamp(tHigh, -1, 1) - k.aimHigh) * a;
      }
    }
    const held = k.type === 'lob' ? input.lobHeld : k.type === 'super' ? false : input.kickHeld;
    if (!held) k.released = true;
    // удар в касание: заряд продолжает расти и во время замаха, пока кнопка удержана — до самого контакта
    if (k.dyn && !k.released && (k.phase === 'windup' || k.phase === 'swing')) k.charge = Math.min(1, k.charge + dt / K.chargeTime);
    if (k.phase === 'charge') {
      k.charge = Math.min(1, k.charge + dt / K.chargeTime);
      if (!held || k.t > K.chargeTime + K.autoRelease) { k.phase = 'ready'; k.waitT = 0; }
    }
    if (k.phase === 'charge' || k.phase === 'ready') {
      // мяч в динамике: прогноз точки встречи, подстройка, замах заранее, удар в расчётный момент.
      // Заряд — сколько успели удержать к моменту контакта; отпускать кнопку заранее не требуется.
      k.plan = this._strikePlan(p, k);
      if (k.plan) {
        const pl = k.plan; k.free = false;
        if (pl.jump && p.y <= 0 && pl.jumpAt <= dt) {
          k.commitTick = this.tick + Math.round(pl.t / dt);
          this._takeoff(p, k, pl);
        }
        const swingDur = pl.bike ? K.bikeSwing : pl.fly ? K.flySwing : K.strikeSwing;
        if (pl.t <= (pl.bike ? K.bikeWindup : pl.fly ? K.flyWindup : K.strikeWindup) + swingDur) {
          const rx = -k.az, rz = k.ax;
          k.phase = 'windup'; k.t = 0; k.dyn = true; k.offset = 0; k.high = pl.high; k.bike = !!pl.bike; k.fly = pl.fly || 0;
          if (k.fly) k.footSide = k.fly;
          if ((k.fly || k.bike) && !p.fall && p.y > 0) this._takeoff(p, k, pl, false); // удар из уже начатого прыжка
          k.swingDur = swingDur;
          k.windDur = Math.max(0.04, pl.t - swingDur);
          const foot = p.feet[k.footSide > 0 ? 1 : 0];
          foot.swing = null; foot.planted = false;
          // замах: низкий мяч — нога назад; мяч на весу — нога отводится в сторону и вверх
          // занос: низкий мяч — стопа уходит назад с согнутым коленом; мяч на весу — нога отводится назад-в сторону
          // и поднимается почти до высоты будущего контакта, чтобы пронос шёл по дуге, а не снизу вверх
          // через себя: колено подтянуто перед корпусом, дальше стопа идёт вверх к мячу
          // сбоку в полёте: нога отведена в сторону и поднята до уровня таза, колено согнуто — отсюда она идёт вверх к мячу
          const back = pl.fly ? 0.2 : pl.bike ? 0.34 : pl.high ? 0.34 : 0.4, out = pl.fly ? 0.45 : pl.bike ? 0.1 : pl.high ? 0.3 : 0.13;
          foot.ctl = {
            tx: p.x - k.ax * back + rx * k.footSide * out, tz: p.z - k.az * back + rz * k.footSide * out,
            th: p.y + (pl.fly ? 0.8 : pl.bike ? 0.28 : pl.high ? Math.max(0.35, pl.hRel * 0.85) : 0.26 + 0.14 * k.charge), remain: k.windDur, rel: true, ease: true, t0: k.windDur,
          };
          this.events.push({ type: 'kick_windup', charge: k.charge, dynamic: true, high: pl.high, jump: p.y > 0 });
        }
        if (k.phase === 'ready') { k.waitT += dt; if (k.waitT > K.approachTimeout + K.strikeHorizon) { this.events.push({ type: 'kick_cancel', reason: 'мяч недостижим' }); this._endKick(p, 'timeout'); } }
        return;
      }
      // Кнопка удара удержана, а мяча в зоне удара нет: стрелки ведут игрока, а не прицел — так его подводят к мячу
      // с уже заряженным ударом. Как только появляется точка встречи или мяч оказывается рядом, удар идёт как обычно.
      const bd = this._ballDist(p), dropping = b.y > 0.5 && bd < 2.6 && Math.hypot(b.vx, b.vz) < 4;
      const out = k.dynamic ? !dropping : bd > (k.free ? 2.2 : 2.6);
      k.free = held && out && Math.hypot(input.mx, input.mz) > 0.05 && p.y <= 0;
      if (k.free) {
        k.phase = 'charge'; k.waitT = 0; k.ix = k.itx = undefined;
        k.aimLat *= Math.exp(-6 * dt); k.aimHigh *= Math.exp(-6 * dt); // the arrows are not an aim now
        // the line of the strike follows the ball: from it to the goal
        let ax = k.gx - b.x, az = -b.z; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al; k.ax = ax; k.az = az;
        p.mode = input.sprintHeld ? 'sprint' : 'run';
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
      const low = b.y <= 0.3; // лежащий мяч: заход сбоку; мяч на весу бьётся как раньше, с линии удара
      const sideOff = low ? K.approachSide : 0.13;
      const lat = relx * rx + relz * rz - k.footSide * (sideOff - 0.01);
      const yawErr = Math.abs(angDiff(Math.atan2(k.az, k.ax) + (low ? k.footSide * K.approachAngle : 0), p.yaw));
      const plant = p.feet[k.footSide > 0 ? 0 : 1];
      let go = false;
      if (low) go = along > 0.12 && along < 0.55 && Math.abs(lat) < 0.16 && yawErr < 0.9 && !plant.swing;
      else go = b.y < 1.05 && along > -0.05 && along < 0.75 && Math.abs(lat) < 0.4; // воллей
      if (go) {
        k.phase = 'windup'; k.t = 0; k.offset = Math.abs(lat); k.sideOn = low;
        k.windDur = b.y > 0.3 ? 0.05 : 0.08 + 0.06 * k.charge;
        const foot = p.feet[k.footSide > 0 ? 1 : 0];
        foot.swing = null; foot.planted = false;
        // замах идёт по линии удара: стопа отводится назад за мяч, а не за центр корпуса
        foot.ctl = { tx: p.x - k.ax * 0.36 + rx * k.footSide * (sideOff - 0.02), tz: p.z - k.az * 0.36 + rz * k.footSide * (sideOff - 0.02), th: 0.2 + 0.22 * k.charge, remain: k.windDur };
        if (low) {
          // последний шаг: опорная нога выпадом ставится рядом с мячом, пока бьющая уходит в замах.
          // Точка — сбоку от мяча со стороны опорной ноги и чуть позади него; дальше досягаемости ноги шаг не тянется.
          const tl = k.windDur + 0.04;
          let px = b.x + b.vx * tl - k.ax * K.plantBack - rx * k.footSide * K.plantSide, pz = b.z + b.vz * tl - k.az * K.plantBack - rz * k.footSide * K.plantSide;
          const dh = Math.hypot(px - p.x, pz - p.z);
          if (dh > K.plantReach) { px = p.x + (px - p.x) * K.plantReach / dh; pz = p.z + (pz - p.z) * K.plantReach / dh; }
          if (Math.hypot(px - plant.x, pz - plant.z) > 0.08) {
            plant.swing = null; plant.planted = false;
            plant.ctl = { plant: true, tx: px, tz: pz, remain: tl, t0: tl, lift: 0.06 };
          }
        }
        this.events.push({ type: 'kick_windup', charge: k.charge });
      } else if (dist > 2.6 && k.waitT > 0.05) {
        this.events.push({ type: 'kick_empty' }); this._endKick(p, 'empty');
      } else if (k.waitT > K.approachTimeout) {
        this.events.push({ type: 'kick_cancel', reason: 'мяч недостижим' }); this._endKick(p, 'timeout');
      }
      return;
    }
    if ((k.phase === 'windup' || k.phase === 'swing') && k.dyn && k.plan && k.plan.jump && !k.jumped && p.y <= 0) {
      // the windup may start before the take-off (long bicycle windup): jump when the time left equals the rise time
      const pl = k.plan, rem = k.phase === 'windup' ? k.windDur - k.t + k.swingDur : k.swingDur - k.t; // the take-off may fall into the swing: a kick on the way up
      if (rem <= (pl.tUp || pl.jump / P.ball.gravity) + dt) {
        this._takeoff(p, k, pl);
      }
    }
    if (k.phase === 'windup' && k.t >= k.windDur) {
      k.phase = 'swing'; k.t = 0;
      const foot = p.feet[k.footSide > 0 ? 1 : 0];
      foot.ctl = { tx: b.x + k.ax * 0.1, tz: b.z + k.az * 0.1, th: Math.max(0.02, b.y - 0.1), remain: k.dyn ? k.swingDur : 0.075, track: true };
      return;
    }
    if (k.phase === 'swing' && k.t >= (k.dyn ? k.swingDur + 0.06 : 0.11) && !k.hit) {
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
      return { t, sx: p.x + p.vx * t, sz: p.z + p.vz * t, bx: q.x, by: q.y, bz: q.z, hRel, high: hRel > 0.35, jump: 0, jumpAt: 0, bike: k.bike, fly: k.fly || 0 };
    }
    const c = Object.assign(this._pred || (this._pred = {}), b);
    const ev = this._predEv || (this._predEv = []);
    const h = 1 / 60, n = Math.round(K.strikeHorizon / h);
    const rx = -k.az, rz = k.ax, air = p.y > 0;
    const R = PP.radius, minX = p.side < 0 ? -F.length / 2 + R : R + 0.05, maxX = p.side < 0 ? -R - 0.05 : F.length / 2 - R, maxZ = F.width / 2 - R;
    let best = null, bestCost = 1e9;
    // игрок спиной к воротам: мяч в воздухе рядом можно пробить через себя, не разворачиваясь
    const backToGoal = Math.cos(p.yaw) * k.ax + Math.sin(p.yaw) * k.az < -0.3;
    // удары по высокому мячу — только из собственного прыжка игрока (kick.jumpKicks): без него план ждёт, пока мяч опустится
    const own = !K.jumpKicks || k.jumpOk;
    for (let i = 1; i <= n; i++) {
      stepBall(c, h, P, ev, null); ev.length = 0;
      const t = i * h;
      if (t < 0.1) continue;
      if (t > bestCost) break;
      // высота игрока над покрытием к моменту t, если он уже в прыжке: тогда новые толчки не нужны, удар идёт из этого прыжка
      const pyAir = air ? p.y + p.vy * t - 0.5 * g * t * t : 0;
      const airReach = (sx, sz) => Math.hypot(sx - (p.x + p.vx * t), sz - (p.z + p.vz * t)) <= 0.3 + 0.5 * PP.airControl * t * t;
      if (own && backToGoal && k.type !== 'lob' && c.y >= K.bikeMin && t >= K.bikeSwing + 0.17 && (!air || pyAir >= 0.12)) { // время на замах и ножницы
        const pyB = air ? pyAir : Math.max(K.bikeHop, c.y - K.bikeReach);
        const vyB = Math.sqrt(2 * g * pyB), tUp = vyB / g;
        const jump = air ? 0 : t >= tUp ? vyB : (pyB + 0.5 * g * t * t) / t, jumpAt = air ? 0 : t >= tUp ? t - tUp : 0;
        // тело — чуть ближе к воротам, чем мяч: стопа приходит к мячу снизу-спереди и отправляет его назад через голову
        const sx0 = c.x + k.ax * 0.12, sz0 = c.z + k.az * 0.12;
        const sx = clamp(sx0, minX, maxX), sz = clamp(sz0, -maxZ, maxZ);
        const reachOk = air ? airReach(sx, sz) : jumpAt < 0.1
          ? Math.hypot(sx - (p.x + p.vx * t), sz - (p.z + p.vz * t)) <= 0.3
          : Math.hypot(sx - p.x, sz - p.z) <= 0.15 + this._strikeCap(p, k, sx, sz) * Math.max(0, t - 0.04);
        // мяч должен быть достаточно высоко над уровнем толчка — под почти прямую ногу; ниже это уже не удар через себя
        if (c.y - pyB >= K.bikeLeg && c.y - pyB <= K.bikeReach + 0.12 && pyB <= K.jumpReach && jump <= K.strikeJumpMax && Math.hypot(sx - sx0, sz - sz0) <= 0.12 && reachOk) {
          const cost = t - 0.12; // через себя быстрее, чем разворачиваться к воротам
          if (cost < bestCost) { bestCost = cost; best = { t, sx, sz, bx: c.x, by: c.y, bz: c.z, hRel: c.y - pyB, high: true, jump, jumpAt, bike: true }; }
          continue;
        }
      }
      if (own && !backToGoal && k.type !== 'lob' && c.y >= K.flyMin && t >= K.flySwing + 0.17 && (!air || pyAir >= 0.12)) { // навес — мягкое касание: ударов в полёте для него нет
        // высокий мяч лицом к воротам: удар сбоку в полёте. Нога поднята выше таза, корпус завален в другую сторону,
        // поэтому мяч стоит сбоку от таза — тем ближе, чем он выше
        const pyS = air ? pyAir : Math.max(K.flyHop, c.y - K.flyReach), hS = c.y - pyS;
        if (hS >= K.flyLeg && hS <= K.flyReach + 0.12 && pyS <= K.jumpReach) {
          // удар идёт на взлёте: толчок рассчитан на высоту выше точки контакта, tUp — время от толчка до контакта
          const vyS = Math.sqrt(2 * g * (pyS + K.flyRise)), tUp = (vyS - Math.sqrt(vyS * vyS - 2 * g * pyS)) / g;
          const jump = air ? 0 : t >= tUp ? vyS : (pyS + 0.5 * g * t * t) / t, jumpAt = air ? 0 : t >= tUp ? t - tUp : 0;
          // в полёте таз идёт низко (корпус лежит боком), поэтому нога смотрит к мячу круче
          const v = hS - 0.8, lat = Math.sqrt(Math.max(0.3 * 0.3, 0.72 * 0.72 - v * v));
          const s = k.fly || ((c.x - p.x) * rx + (c.z - p.z) * rz >= 0 ? 1 : -1); // бьёт нога с той стороны, где мяч
          const sx0 = c.x - k.ax * 0.15 - rx * s * lat, sz0 = c.z - k.az * 0.15 - rz * s * lat;
          const sx = clamp(sx0, minX, maxX), sz = clamp(sz0, -maxZ, maxZ);
          const reachOk = air ? airReach(sx, sz) : jumpAt < 0.1
            ? Math.hypot(sx - (p.x + p.vx * t), sz - (p.z + p.vz * t)) <= 0.3
            : Math.hypot(sx - p.x, sz - p.z) <= 0.15 + this._strikeCap(p, k, sx, sz) * Math.max(0, t - 0.04);
          if (jump <= K.strikeJumpMax && Math.hypot(sx - sx0, sz - sz0) <= 0.12 && reachOk) {
            const cost = t;
            if (cost < bestCost) { bestCost = cost; best = { t, sx, sz, bx: c.x, by: c.y, bz: c.z, hRel: hS, high: true, jump, jumpAt, bike: false, fly: s, tUp }; }
            continue;
          }
        }
      }
      let py = air ? Math.max(0, p.y + p.vy * t - 0.5 * g * t * t) : 0, jump = 0, jumpAt = 0, late = 0;
      let hRel = c.y - py;
      if (hRel > K.standReach) {
        if (air || !own) continue;
        if (!backToGoal && k.type !== 'lob' && c.y >= K.flyMin) late = 0.5; // a high ball is hit sideways in flight; the vertical jump stays only as a last resort
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
      let sx = 0, sz = 0, ok = false;
      // first the natural, almost straight leg; if the player cannot get that far in time - a closer spot with a more bent leg
      for (let v = 0; v < 2 && !ok; v++) {
        const ideal = v ? Math.min(K.legIdeal, 0.74) : K.legIdeal;
        const horiz = Math.sqrt(Math.max(0.32 * 0.32, ideal * ideal - dyLeg * dyLeg));
        const back = 0.12 + Math.sqrt(Math.max(0.03, horiz * horiz - (side - 0.09) * (side - 0.09)));
        sx = c.x - k.ax * back - rx * k.footSide * side; sz = c.z - k.az * back - rz * k.footSide * side;
        const sx0 = sx, sz0 = sz;
        sx = clamp(sx, minX, maxX); sz = clamp(sz, -maxZ, maxZ);
        if (Math.hypot(sx - sx0, sz - sz0) > 0.12) continue;
        const hxj = sx + rx * k.footSide * 0.09, hzj = sz + rz * k.footSide * 0.09;
        const dl = Math.hypot(c.x - k.ax * 0.12 - hxj, c.y + 0.02 - (py + 0.9), c.z - k.az * 0.12 - hzj);
        if (dl > K.legMax || dl < K.legMin) continue;
        if (air && py > 0.02) {
          if (Math.hypot(sx - (p.x + p.vx * t), sz - (p.z + p.vz * t)) > 0.3 + 0.5 * PP.airControl * t * t) continue;
        } else if (jump && jumpAt < 0.1) {
          if (Math.hypot(sx - (p.x + p.vx * t), sz - (p.z + p.vz * t)) > 0.25) continue;
        } else if (Math.hypot(sx - p.x, sz - p.z) > 0.15 + this._strikeCap(p, k, sx, sz) * Math.max(0, t - 0.04)) continue;
        ok = true;
      }
      if (!ok) continue;
      const cost = t + (jump ? 0.06 : 0) + (backToGoal ? 0.3 : 0) + late;
      if (cost < bestCost) { bestCost = cost; best = { t, sx, sz, bx: c.x, by: c.y, bz: c.z, hRel, high, jump, jumpAt, bike: false }; }
    }
    if (best && best.fly) k.footSide = best.fly;
    else if (best) {
      // нога — с той стороны, где окажется мяч; без дёрганья при малой разнице
      const lat = (best.bx - p.x) * rx + (best.bz - p.z) * rz;
      if (Math.abs(lat) > 0.18) k.footSide = lat > 0 ? 1 : -1;
    }
    return best;
  }

  // Наибольшая скорость выхода под удар, м/с: корпус уже развёрнут по линии удара, поэтому вперёд игрок бежит,
  // вбок идёт приставным шагом, а назад отходит спиной — медленнее. За мячом, пролетевшим мимо, он спиной не гонится.
  _strikeCap(p, k, tx, tz) {
    const K = this.P.kick, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.25) return K.strikeSpeed; // a short adjusting step in any direction
    const c = (dx * k.ax + dz * k.az) / d;
    return c >= 0 ? K.strikeSide + (K.strikeSpeed - K.strikeSide) * c : K.strikeSide + (K.strikeBack - K.strikeSide) * -c;
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
    // шаг опорной ноги к мячу: низкая дуга, постановка до контакта
    const pf = p.feet[k.footSide > 0 ? 0 : 1], pc = pf.ctl;
    if (pc && pc.plant) {
      const a = Math.min(1, dt / Math.max(pc.remain, dt));
      pf.x += (pc.tx - pf.x) * a; pf.z += (pc.tz - pf.z) * a;
      pc.remain -= dt;
      pf.h = pc.lift * Math.sin(Math.PI * clamp(1 - pc.remain / pc.t0, 0, 1));
      pf.yaw += angDiff(Math.atan2(k.az, k.ax), pf.yaw) * a; // опорная стопа встаёт носком по линии удара
      if (pc.remain <= 0) { pf.h = 0; pf.planted = true; pf.ctl = null; p.lastStrike = k.footSide > 0 ? 0 : 1; }
    }
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
      // side volley: the foot travels around the hip in an arc, the leg unfolding as it goes - not along a chord past the hip
      const arc = k.phase === 'swing' && k.high && !k.bike ? clamp(1 - c.remain / k.swingDur, 0, 1) : 0;
      const lim = clamp(d, K.legMin + (K.legIdeal - 0.05 - K.legMin) * arc, K.legMax);
      if (lim !== d) { foot.x = hx + dx * lim / d; foot.z = hz + dz * lim / d; foot.h = Math.max(0, hy + dy * lim / d - 0.1); }
    }
    foot.yaw = p.yaw;
    c.remain -= dt;
    if (k.phase === 'swing' && !k.hit) {
      const dist = Math.hypot(foot.x - b.x, foot.h + 0.06 - b.y, foot.z - b.z);
      const gap = dist - (P.ball.radius + P.player.footRadius + 0.02);
      k.gap = gap;
      // flying ball: foot and ball close ~20 cm per step, so "touching" may fall between steps - then the hit is taken
      // on the step where they have just passed the closest approach (the foot is brought to the ball in _applyKick)
      const passed = k.dyn && k.lastDist !== undefined && dist > k.lastDist && k.lastDist < 0.4;
      k.lastDist = dist;
      if (passed && gap > 0 && Math.abs(foot.h + 0.06 - b.y) < 0.2) { this._applyKick(p); return; }
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
    if (k.fly) speed *= K.flyBonus;
    const sup = k.type === 'super', lob = k.type === 'lob';
    // через себя: мяч сбоку от корпуса — удар «ножницами» набок, игрок упадёт на бок, а не на спину
    if (p.fall && p.fall.kind === 'back') {
      const rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
      p.fall.roll = clamp(((b.x - p.x) * rx + (b.z - p.z) * rz) / 0.3 + (p.vx * rx + p.vz * rz) / 1.6, -1, 1);
    }
    if (sup) { speed = K.superSpeed; p.superCharge = 0; }
    const tz = k.aimLat * (F.goalWidth / 2) * K.aimWidth;
    let dx = k.gx - b.x, dz = tz - b.z;
    let yaw = Math.atan2(dz, dx);
    let pitch;
    if (volley) {
      // мяч на весу: бьём в выбранную точку створа с поправкой на падение
      const yT = 0.35 + ((k.aimHigh + 1) / 2) * (F.goalHeight - 0.7), d = Math.hypot(dx, dz), tf = d / speed;
      pitch = clamp(Math.atan2(yT - b.y + 0.5 * P.ball.gravity * tf * tf, d) * 180 / Math.PI, -25, 40);
    } else if (sup) pitch = lerp(K.superPitchLow, K.superPitchHigh, (k.aimHigh + 1) / 2);
    else pitch = k.aimHigh < 0 ? lerp(K.pitchMid, K.pitchLow, -k.aimHigh) : lerp(K.pitchMid, K.pitchHigh, k.aimHigh);
    const pSpeed = Math.hypot(p.vx, p.vz);
    const turn = k.bike ? 0 : Math.abs(angDiff(Math.atan2(k.az, k.ax), k.startYaw)) / Math.PI;
    const sigma = (K.errBase + K.errSpeed * pSpeed + K.errTurn * turn + K.errCharge * k.charge + K.errOffset * (k.offset || 0)
      + (k.dyn ? K.errVolley + K.errIncoming * incoming : 0) + (k.bike ? K.errBike : 0) + (k.fly ? K.errFly : 0)) * (sup ? K.superErr : lob ? K.errLob : 1);
    const errYaw = k.e1 * sigma, errPitch = k.e2 * sigma * 0.6;
    yaw += (errYaw * Math.PI) / 180;
    pitch = (volley ? pitch + errPitch : Math.max(0, pitch + errPitch)) * Math.PI / 180;
    b.wx = b.wy = b.wz = 0;
    let carry = 0.3;
    if (lob) {
      // навес: крутая дуга с обратным вращением; скорость подбирается под дальность точки приземления
      pitch = lerp(K.lobPitchLow, K.lobPitchHigh, (k.aimHigh + 1) / 2) * Math.PI / 180;
      b.wx = -Math.sin(yaw) * K.lobSpin; b.wz = Math.cos(yaw) * K.lobSpin;
      speed = this._lobSpeed(yaw, pitch, lerp(K.lobMin, K.lobMax, k.charge) * (1 + k.e2 * 0.02 * sigma));
      carry = 0;
    }
    const cp = Math.cos(pitch);
    b.vx = Math.cos(yaw) * cp * speed + p.vx * carry;
    b.vz = Math.sin(yaw) * cp * speed + p.vz * carry;
    b.vy = Math.sin(pitch) * speed;
    if (!lob) {
      // Spin from the contact. The foot meets the ball below its centre the more, the higher the shot goes: backspin grows
      // with the launch angle (a driven low shot keeps a little, a volley hit downwards gets topspin). Sidespin comes from
      // the foot crossing the line of the shot — the player running across the ball slices it — and from the inside of
      // the foot on a soft, placed shot. The curl the player adds after the contact still replaces the sidespin.
      const S = K.spin, sy = Math.sin(yaw), cy = Math.cos(yaw), q = sup ? S.superShare : 1;
      const back = speed * (S.base + S.lift * Math.sin(pitch)) * q; // > 0 — backspin, < 0 — topspin
      const across = -p.vx * sy + p.vz * cy; // the player's speed across the line of the shot, to his right
      const side = (S.across * across + S.inside * k.footSide * (1 - k.charge) * speed) * q;
      b.wx = -sy * back; b.wz = cy * back; b.wy = side;
      const wl = Math.hypot(b.wx, b.wy, b.wz); if (wl > S.max) { const m = S.max / wl; b.wx *= m; b.wy *= m; b.wz *= m; }
    }
    if (b.y <= P.ball.radius + 1e-3 && b.vy > 0) b.y = P.ball.radius + 2e-4;
    p.lastTouchTick = this.tick; p.lastKickTick = this.tick;
    k.phase = 'curl'; k.t = 0;
    const foot = p.feet[k.footSide > 0 ? 1 : 0];
    if (k.dyn && !k.bike) {
      // По летящему мячу стопа и мяч сближаются на ~20 см за шаг симуляции, поэтому контакт засчитывается, когда стопа ещё
      // не дошла до мяча. Чтобы удар не выглядел «по воздуху», стопа за этот же шаг доходит до точки касания (не дальше 16 см).
      const ex = b.x - k.ax * 0.16 - foot.x, ey = Math.max(0.02, b.y - 0.07) - foot.h, ez = b.z - k.az * 0.16 - foot.z, el = Math.hypot(ex, ey, ez);
      const s = el > 0.16 ? 0.16 / el : 1;
      foot.x += ex * s; foot.h += ey * s; foot.z += ez * s;
    }
    // проводка: стопа продолжает дугу удара дальше по линии и чуть вверх
    // высота проводки растёт с силой удара, но стопа не поднимается выше колена опорной ноги
    foot.ctl = { tx: foot.x + k.ax * 0.36, tz: foot.z + k.az * 0.36, th: volley ? Math.min(foot.h + 0.06, p.y + 0.7) : 0.16 + 0.2 * k.charge, remain: 0.11, rel: true };
    this.stats.kicks++;
    this.events.push({
      type: 'kick', charge: k.charge, speed, aimLat: k.aimLat, aimHigh: k.aimHigh,
      error: { sigma, yaw: errYaw, pitch: errPitch, playerSpeed: pSpeed, turn, offset: k.offset || 0 },
      volley, jump: jumpKick, firstTime: !!k.dyn, incoming, bike: !!k.bike, fly: !!k.fly, kind: k.type,
    });
  }

  // Скорость навеса, при которой мяч опустится на покрытие в dist метрах: прогон полёта той же физикой (воздух, вращение)
  _lobSpeed(yaw, pitch, dist) {
    const P = this.P, b = this.ball, r = P.ball.radius;
    const c = this._pred2 || (this._pred2 = {}), ev = this._predEv || (this._predEv = []);
    let v = Math.sqrt(dist * P.ball.gravity / Math.sin(2 * pitch));
    for (let it = 0; it < 4; it++) {
      Object.assign(c, b);
      c.y = Math.max(b.y, r + 2e-4);
      c.vx = Math.cos(yaw) * Math.cos(pitch) * v; c.vz = Math.sin(yaw) * Math.cos(pitch) * v; c.vy = Math.sin(pitch) * v;
      for (let i = 0; i < 300; i++) { const pv = c.vy; stepBall(c, 1 / 60, P, ev, null); ev.length = 0; if (pv < 0 && c.vy >= 0) break; }
      const d = Math.hypot(c.x - b.x, c.z - b.z);
      if (d < 0.2) break;
      v = Math.min(18, v * clamp(Math.sqrt(dist / d), 0.75, 1.35));
    }
    return v;
  }

  _endKick(p, why) {
    const k = p.kick;
    if (!k) return;
    const foot = p.feet[k.footSide > 0 ? 1 : 0];
    const K = this.P.kick, done = why === 'done';
    // После удара нога не отдёргивается под корпус: она продолжает движение и мягко опускается (стопа сначала ещё идёт
    // вверх, потом плавно вниз). Сорванный удар (промах, отмена) завершается как раньше — быстрым возвратом.
    if (p.fall) { foot.swing = null; foot.planted = false; foot.ctl = { fall: true }; } // дальше ногу ведёт падение
    else if (foot.ctl) { foot.ctl = null; this._lift(foot, done ? K.followLand : 0.15, done ? 0.05 : 0.02, false, done); if (done && p.y > 0) foot.ease = 0.6; }
    // удар с места: корпус по инерции проходит вперёд, бьющая нога встаёт шагом впереди
    if (done && k.sideOn && !k.bike) p.recover = { t: 0, dur: K.followTime, ax: k.ax, az: k.az, speed: K.followSpeed, yaw: Math.atan2(k.az, k.ax) - k.footSide * K.approachAngle * 0.6 };
    const pf = p.feet[k.footSide > 0 ? 0 : 1];
    if (pf.ctl && pf.ctl.plant) { pf.ctl = null; pf.h = 0; pf.planted = true; } // удар оборвался на шаге опорной ноги
    p.kick = null; p.kickBuf = 0; p.gait = false;
  }

  // ---------- корпус и приём ----------
  _bodyCollision(p, b) {
    const P = this.P, G = P.guard, r = P.ball.radius;
    const guarding = p.guard || !!p.lunge;
    // в стойке игрок закрывает больше места: стопы шире, в рывке нога вынесена в сторону
    const R = P.player.radius + (p.lunge ? G.lungeReach : p.guard ? G.reach : 0);
    const low = p.slide || (p.fall && (p.fall.phase === 'down' || p.fall.phase === 'rise')); // в подкате игрок лежит низко
    const top = low ? 0.75 : this._bodyTop(p), lean = low ? 0 : G.lean * p.crouch;
    const y0 = p.y + R, y1 = Math.max(y0, p.y + top - R);
    // ось капсулы: от стоп к голове; в стойке голова вынесена вперёд, и ось наклонена вместе с корпусом
    const cy = clamp(b.y, y0, y1), ck = y1 > y0 ? (cy - y0) / (y1 - y0) * lean : 0;
    let nx = b.x - (p.x + Math.cos(p.yaw) * ck), ny = b.y - cy, nz = b.z - (p.z + Math.sin(p.yaw) * ck);
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
    if (relH < 0.4 && vn < 2.5) return;
    // the ball this player has just played off his body is coming down in front of him: he does not take it on the body again
    if (relH >= 0.4 && vn < 4 && (this.tick - p.recvTick) * this.dt < 0.8) return; // медленный мяч у ног — область стоп, не корпуса
    if (vn <= 0) return;
    // разрешаем пересечение без взрывного импульса
    const pen = R + r - d;
    b.x += nx * pen; b.y = Math.max(r, b.y + ny * pen); b.z += nz * pen;
    const zk = top > 1 ? top / P.player.top : 1; // в стойке таз, грудь и голова ниже — границы зон опускаются вместе с ними
    const zone = relH < 0.4 ? 'foot' : relH < 0.95 * zk ? 'thigh' : relH < 1.45 * zk ? 'chest' : 'head';
    const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);

    // качество приёма: точное нажатие по таймингу — лучшее; стойка гасит мяч и без нажатия, рывок — чуть хуже
    let q = 0;
    if (p.receiveT > 0) {
      const age = P.receive.window - p.receiveT;
      q = age >= P.receive.idealFrom && age <= P.receive.idealTo ? 1 : 0.5;
    }
    if (guarding) q = Math.max(q, p.lunge ? G.lungeQuality : G.quality);
    // мяч, упавший на спину или затылок, корпусом вперёд не сыграть: он отскакивает как от стенки
    if (q > 0 && (zone === 'foot' || nx * fx + nz * fz > -0.25)) {
      // мяч гасится телом и опускается перед игроком — в зону следующего касания; остаток скорости зависит от качества
      const leak = guarding ? Math.min(2, (1 - q) * vn * 0.2) : (1 - q) * vn * 0.3; // стойка гасит сильнее: мяч падает в зону контроля
      const carry = p.lunge ? 0.3 : 1; // в рывке мяч не уносится вместе с игроком
      const pvx = p.vx * carry, pvz = p.vz * carry;
      if (zone === 'foot') { b.vx = pvx * 0.6 + nx * (0.3 + leak); b.vz = pvz * 0.6 + nz * (0.3 + leak); b.vy = 0; }
      else this._deflect(p, b, zone, q, vn);
      p.recvTick = this.tick;
      p.superCharge = Math.min(1, p.superCharge + P.kick.superReceive * q);
      b.wx = b.wy = b.wz = 0;
      p.receiveT = 0; p.gesture = { type: zone, t: 0 };
      // мяч, отбитый корпусом, уже уходит от игрока: второго касания тем же местом не будет
      p.lastTouchTick = zone === 'foot' ? this.tick - Math.round(0.15 / this.dt) : this.tick;
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
    if (zone !== 'foot' && p.y <= 0 && !p.kick && !p.fall && !p.slide && nx * fx + nz * fz > -0.25) {
      // игрок повёрнут к мячу: без нажатий он тоже подрабатывает мяч той частью тела, в которую тот пришёл, — только грубее
      this._deflect(p, b, zone, 0, vn);
      p.gesture = { type: zone, t: 0 };
      p.recvTick = this.tick; p.lastTouchTick = this.tick;
      this.stats.receives++;
      this.events.push({ type: 'receive', zone, quality: 0.3, speed: vn, auto: 'deflect' });
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

  // Высота макушки над опорой, м: коллайдер тела повторяет модель — в стойке игрок ниже, на бегу голова чуть опущена.
  _bodyTop(p) {
    const B = this.P.player, run = Math.min(1, Math.hypot(p.vx, p.vz) / B.sprintSpeed);
    const stand = B.top - B.runDrop * run * (p.y > 0 ? 0 : 1);
    return stand + (this.P.guard.top - stand) * p.crouch;
  }

  // Подработка корпусом: одно касание — и мяч уходит перед игроком на небольшой дуге и опускается к ногам.
  // Направление — по корпусу; если зажато направление, то туда, но не дальше чем вбок. q > 0 — мягкий приём (стойка, нажатие).
  _deflect(p, b, zone, q, vn) {
    const P = this.P, A = P.receive, g = P.ball.gravity, fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);
    let dx = fx, dz = fz;
    const m = Math.hypot(p.inX, p.inZ);
    if (m > 0.3) {
      dx = p.inX / m; dz = p.inZ / m;
      if (dx * fx + dz * fz < 0) { const s = -dx * fz + dz * fx >= 0 ? 1 : -1; dx = -fz * s; dz = fx * s; } // назад через себя корпусом не сыграть
    }
    const soft = q > 0;
    const up = (zone === 'head' ? A.popHead : zone === 'chest' ? A.popChest : A.popThigh) * (soft ? 1 : 1.15);
    const t = (up + Math.sqrt(up * up + 2 * g * Math.max(0, b.y - P.ball.radius))) / g; // время до покрытия
    let dist = soft ? A.softNear + (A.softFar - A.softNear) * (1 - q) + Math.min(0.4, vn * 0.02) : clamp(A.roughBase + A.roughGain * vn, A.roughBase, A.roughMax);
    if (zone === 'head') dist = Math.max(dist, A.headSpeed * t); // с головы мяч должен уйти вперёд раньше, чем опустится до плеч
    const carry = p.lunge ? 0.3 : 0.6; // мяч отчасти идёт вместе с игроком
    b.vx = dx * dist / t + p.vx * carry; b.vz = dz * dist / t + p.vz * carry; b.vy = up;
    b.wx = b.wy = b.wz = 0;
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
    | (i.cmdReturn ? 1024 : 0) | (i.cmdServe ? 2048 : 0) | (i.cmdWall ? 4096 : 0) | (i.guardHeld ? 8192 : 0)
    | (i.lobPressed ? 16384 : 0) | (i.lobHeld ? 32768 : 0) | (i.superHeld ? 65536 : 0),
  ];
}

export function unpackInput(a, out = emptyInput()) {
  const f = a[2];
  out.mx = a[0] / 1000; out.mz = a[1] / 1000;
  out.digital = !!(f & 1); out.kickHeld = !!(f & 2); out.kickPressed = !!(f & 4); out.jumpPressed = !!(f & 8);
  out.receivePressed = !!(f & 16); out.controlHeld = !!(f & 32); out.faceGoalHeld = !!(f & 64); out.sprintHeld = !!(f & 128);
  out.feintPressed = !!(f & 256); out.superPressed = !!(f & 512);
  out.cmdReturn = !!(f & 1024); out.cmdServe = !!(f & 2048); out.cmdWall = !!(f & 4096); out.guardHeld = !!(f & 8192);
  out.lobPressed = !!(f & 16384); out.lobHeld = !!(f & 32768); out.superHeld = !!(f & 65536);
  return out;
}
