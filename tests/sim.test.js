import test from 'node:test';
import assert from 'node:assert/strict';
import { World, emptyInput, unpackInput } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';
import { createBall, stepBall } from '../src/sim/ball.js';

function harness(scenario = 'free', seed = 7) {
  const w = new World(createProfile(), { seed });
  w.reset(scenario);
  const inp = emptyInput();
  const log = [];
  const run = (sec, each) => {
    const n = Math.round(sec * 120);
    for (let i = 0; i < n; i++) {
      if (each) each(i);
      w.step(inp);
      inp.kickPressed = inp.jumpPressed = inp.receivePressed = false;
      for (const e of w.events) log.push({ ...e, tick: w.tick });
    }
  };
  return { w, inp, log, run, count: (t) => log.filter((e) => e.type === t).length };
}
const energy = (b) => b.vx ** 2 + b.vy ** 2 + b.vz ** 2 + 2 * 9.81 * b.y;
const dist = (w) => Math.hypot(w.ball.x - w.player.x, w.ball.z - w.player.z);

test('мотор: разгон, остановка и скорости в стартовых диапазонах', () => {
  const { w, inp, run } = harness('motor');
  inp.mx = 1;
  let t90 = null;
  run(1, () => { if (t90 === null && w.player.vx >= 3.5 * 0.9) t90 = w.tick / 120; });
  assert.ok(t90 >= 0.15 && t90 <= 0.30, 't90=' + t90);
  assert.ok(Math.abs(Math.hypot(w.player.vx, w.player.vz) - 3.5) < 0.01);
  inp.mx = 0;
  const t0 = w.tick; let ts = null;
  run(1, () => { if (ts === null && Math.hypot(w.player.vx, w.player.vz) < 0.05) ts = (w.tick - t0) / 120; });
  assert.ok(ts >= 0.2 && ts <= 0.4, 'stop=' + ts);
  inp.mx = -0.7071; inp.mz = 0.7071; inp.sprintHeld = true; run(0.8);
  const v = Math.hypot(w.player.vx, w.player.vz);
  assert.ok(v > 4.2 && v <= 5.0, 'sprint=' + v);
});

test('мотор: разворот на 180° без мяча за 0,2–0,42 с', () => {
  const { w, inp, run } = harness('motor');
  inp.mx = -1; run(0.6);
  inp.mx = 1; const t0 = w.tick; let t = null;
  run(0.8, () => { if (t === null && w.player.vx > 3.15) t = (w.tick - t0) / 120; });
  assert.ok(t >= 0.2 && t <= 0.42, 't180=' + t);
});

test('владение не меняет свободную траекторию мяча между касаниями', () => {
  const h = harness('free'); h.inp.mz = 1;
  let checked = 0;
  for (let i = 0; i < 300; i++) {
    const copy = { ...h.w.ball };
    stepBall(copy, h.w.dt, h.w.P, [], null);
    h.w.step(h.inp);
    const touched = h.w.events.some((e) => e.type === 'touch' || e.type === 'body');
    if (!touched) {
      assert.ok(Math.abs(copy.x - h.w.ball.x) < 1e-9 && Math.abs(copy.z - h.w.ball.z) < 1e-9 && Math.abs(copy.vx - h.w.ball.vx) < 1e-9);
      checked++;
    }
  }
  assert.ok(checked > 250);
  assert.ok(h.w.stats.touches >= 4);
});

test('ведение: ритм касаний, зигзаг без тащения мяча позади', () => {
  const { w, inp, run, log } = harness('free');
  inp.mz = 1; run(1.2);
  const touches = log.filter((e) => e.type === 'touch').map((e) => e.tick / 120);
  assert.ok(touches.length >= 3);
  for (let i = 1; i < touches.length; i++) {
    const d = touches[i] - touches[i - 1];
    assert.ok(d > 0.15 && d < 0.5, 'интервал ' + d);
  }
  w.reset('free'); inp.mz = 0;
  for (let k = 0; k < 12; k++) {
    inp.mx = (k % 4 < 2 ? -1 : 1) * 0.7071; inp.mz = (k % 2 ? 1 : -1) * 0.7071;
    run(0.4);
  }
  assert.ok(w.player.possession, 'мяч под контролем после зигзага');
  assert.ok(w.stats.behindTime < 0.5, 'behind=' + w.stats.behindTime);
  assert.ok(dist(w) < 1.5);
});

test('поворот с мячом: касание-перенаправление в пределах 0,22 с', () => {
  for (const [mx, mz] of [[-1, 0], [0, -1], [1, 0]]) {
    const { w, inp, run, log } = harness('free');
    inp.mz = 1; run(0.7);
    inp.mx = mx; inp.mz = mz; const t0 = w.tick;
    run(0.8);
    const t = log.find((e) => e.type === 'touch' && e.tick > t0);
    assert.ok(t && (t.tick - t0) / 120 <= 0.22, 'задержка ' + (t ? (t.tick - t0) / 120 : 'нет касания'));
    assert.ok(w.player.possession);
  }
});

test('остановка мяча: касание-остановка, мяч и игрок стоят', () => {
  const { w, inp, run, log } = harness('free');
  inp.mz = -1; run(0.8); inp.mz = 0; run(1.0);
  assert.ok(log.some((e) => e.type === 'touch' && e.kind === 'trap'));
  assert.ok(Math.hypot(w.ball.vx, w.ball.vz) < 0.01);
  assert.ok(Math.hypot(w.player.vx, w.player.vz) < 0.01);
});

test('недостижимый мяч не получает импульса', () => {
  const { w, inp, run, log } = harness('motor');
  w.ball.x = -2; w.ball.z = 3;
  inp.kickPressed = true; inp.kickHeld = true; run(0.05); inp.kickHeld = false; run(1.5);
  assert.equal(log.filter((e) => e.type === 'kick').length, 0);
  assert.ok(log.some((e) => e.type === 'kick_empty' || e.type === 'kick_cancel'));
  assert.equal(Math.hypot(w.ball.vx, w.ball.vz), 0);
  assert.equal(w.player.kick, null);
});

test('удар: заряд, гол один раз, направления управляют прицелом', () => {
  const a = harness('free');
  a.inp.kickPressed = true; a.inp.kickHeld = true; a.run(0.3); a.inp.kickHeld = false; a.run(3);
  assert.equal(a.count('kick'), 1);
  assert.equal(a.count('goal'), 1);
  assert.equal(a.w.score.scored, 1);
  const k = a.log.find((e) => e.type === 'kick');
  assert.ok(k.charge > 0.5 && k.charge < 0.8);

  const c = harness('free');
  c.inp.kickPressed = true; c.inp.kickHeld = true; c.run(1 / 120); c.inp.kickHeld = false; c.run(1.5);
  const weak = c.log.find((e) => e.type === 'kick');
  assert.ok(weak && weak.charge < 0.1 && weak.speed >= 10, 'лёгкое нажатие даёт слабый удар');

  const b = harness('free');
  b.inp.kickPressed = true; b.inp.kickHeld = true; b.inp.mz = 1; b.run(0.3); b.inp.kickHeld = false;
  let zAtEnd = null;
  b.run(1.0, () => { if (zAtEnd === null && b.w.events.some((e) => e.type === 'kick_end')) { zAtEnd = b.w.player.z; b.inp.mz = 0; } });
  const kb = b.log.find((e) => e.type === 'kick');
  assert.ok(kb.aimLat > 0.9, 'aim=' + kb.aimLat);
  assert.ok(zAtEnd !== null && Math.abs(zAtEnd) < 0.6, 'игрок не убежал по направлению прицела: ' + zAtEnd);
});

test('после окна удара удерживаемое направление снова двигает игрока', () => {
  const h = harness('free');
  h.inp.kickPressed = true; h.inp.kickHeld = true; h.inp.mz = 1; h.run(0.2); h.inp.kickHeld = false; h.run(1.2);
  assert.equal(h.count('kick_end'), 1);
  assert.ok(Math.hypot(h.w.player.vx, h.w.player.vz) > 3, 'движение вернулось без отпускания');
});

test('подкрутка: противоположные знаки, без прироста энергии', () => {
  const res = [];
  for (const dir of [-1, 1]) {
    const h = harness('free');
    h.inp.kickPressed = true; h.inp.kickHeld = true; h.run(0.45); h.inp.kickHeld = false;
    let kicked = false, e0 = 0, maxE = 0, zSum = 0;
    h.run(0.6, () => {
      if (h.w.events.some((e) => e.type === 'kick')) { kicked = true; h.inp.mz = dir; }
      if (h.w.events.some((e) => e.type === 'kick_end')) { h.inp.mz = 0; e0 = energy(h.w.ball); }
      if (e0 && h.w.ball.x < 8) maxE = Math.max(maxE, energy(h.w.ball));
    });
    assert.ok(kicked);
    assert.ok(maxE <= e0 * 1.0001, 'энергия не растёт');
    res.push(h.log.find((e) => e.type === 'kick_end').curl);
  }
  assert.ok(res[0] < -0.5 && res[1] > 0.5);
});

test('гол на большой скорости, стойка и борт', () => {
  const P = createProfile();
  const mk = (z, v) => { const b = createBall(P); b.x = 5; b.z = z; b.vx = v; return b; };
  const sim = (b) => { const ev = []; for (let i = 0; i < 240; i++) stepBall(b, 1 / 120, P, ev, null); return ev; };
  assert.equal(sim(mk(0.3, 31)).filter((e) => e.type === 'goal_line').length, 1);
  const post = sim(mk(1.5, 31));
  assert.ok(post.some((e) => e.type === 'post'));
  assert.equal(post.filter((e) => e.type === 'goal_line').length, 0);
  const b3 = mk(3, 31); const wall = sim(b3);
  assert.ok(wall.some((e) => e.type === 'wall'));
  assert.ok(Math.abs(b3.x) < 9 && Math.abs(b3.z) < 5);
});

test('центр: тело не выходит за линию, мяч пересекает свободно', () => {
  const { w, inp, run } = harness('motor');
  inp.mx = 1; let maxX = -99;
  run(2.5, () => { maxX = Math.max(maxX, w.player.x); });
  assert.ok(maxX < 0);
  const h = harness('free');
  h.inp.kickPressed = true; h.inp.kickHeld = true; h.run(0.2); h.inp.kickHeld = false;
  let crossed = false; h.run(1.5, () => { if (h.w.ball.x > 1) crossed = true; });
  assert.ok(crossed);
});

test('приём: точное нажатие гасит мяч, без нажатия — отскок от тела', () => {
  const passive = harness('chest'); passive.run(1.6);
  assert.ok(passive.log.some((e) => e.type === 'body' && e.zone === 'chest'));
  assert.equal(passive.count('receive'), 0);
  const act = harness('chest'); let pressed = false;
  act.run(1.6, () => {
    const b = act.w.ball;
    if (!pressed && dist(act.w) / Math.hypot(b.vx, b.vz) < 0.09) { pressed = true; act.inp.receivePressed = true; }
  });
  const r = act.log.find((e) => e.type === 'receive');
  assert.ok(r && r.zone === 'chest' && r.quality === 1);
  assert.ok(dist(act.w) < 1.2 && dist(passive.w) > 2, 'приём ' + dist(act.w) + ', отскок ' + dist(passive.w));
  const early = harness('chest'); early.inp.receivePressed = true; early.run(1.6);
  assert.equal(early.count('receive'), 0, 'раннее нажатие не держит окно вечно');
});

test('детерминизм: повтор журнала ввода даёт тот же результат', () => {
  const a = harness('free', 11);
  a.inp.mz = 1; a.run(0.5); a.inp.mx = -0.6; a.inp.digital = false; a.run(0.6);
  a.inp.kickPressed = true; a.inp.kickHeld = true; a.inp.mz = -0.4; a.run(0.25); a.inp.kickHeld = false; a.run(1.2);
  a.inp.mx = 0; a.inp.mz = 0; a.inp.jumpPressed = true; a.run(1);
  const log = a.w.inputLog.map((x) => x.slice());
  const inp = emptyInput();
  const b = new World(createProfile(), { seed: 11 }); b.reset('free');
  for (const f of log) b.step(unpackInput(f, inp));
  assert.equal(b.hash(), a.w.hash());
  const c = new World(createProfile(), { seed: 12 }); c.reset('free');
  for (const f of log) c.step(unpackInput(f, inp));
  assert.notEqual(c.hash(), a.w.hash(), 'другой seed меняет погрешность удара');
});

test('сброс не оставляет отложенных действий', () => {
  const h = harness('free');
  h.inp.kickPressed = true; h.inp.kickHeld = true; h.inp.jumpPressed = true; h.run(0.1);
  h.w.reset('free'); h.inp.kickHeld = false;
  assert.equal(h.w.player.kick, null); assert.equal(h.w.player.kickBuf, 0); assert.equal(h.w.player.jumpBuf, 0);
  h.log.length = 0; h.run(1);
  assert.equal(h.count('kick'), 0); assert.equal(h.count('jump'), 0);
});

test('опорная стопа закреплена в мире между подъёмами', () => {
  const { w, inp, run } = harness('motor');
  inp.mx = -1; let maxDrift = 0; const last = [null, null];
  run(2, () => {
    w.player.feet.forEach((f, i) => {
      if (f.planted && last[i] && last[i].planted) maxDrift = Math.max(maxDrift, Math.hypot(f.x - last[i].x, f.z - last[i].z));
      last[i] = { x: f.x, z: f.z, planted: f.planted };
      if (f.planted) assert.equal(f.h, 0);
    });
  });
  assert.ok(maxDrift < 1e-9, 'дрейф ' + maxDrift);
});

test('разворот на 180° с мячом: убирание подошвой, мяч проходит мимо корпуса, контроль сохранён', () => {
  for (const sprint of [false, true]) {
    const { w, inp, run, log } = harness('free');
    inp.sprintHeld = sprint; inp.mz = 1; run(0.75);
    inp.mz = -1; const t0 = w.tick; let minD = 9, maxYawStep = 0, prevYaw = w.player.yaw;
    run(1.0, () => {
      if (w.tick > t0 + 1) minD = Math.min(minD, dist(w));
      let dy = Math.abs(w.player.yaw - prevYaw); if (dy > Math.PI) dy = 2 * Math.PI - dy;
      maxYawStep = Math.max(maxYawStep, dy); prevYaw = w.player.yaw;
    });
    const first = log.find((e) => e.type === 'touch' && e.tick > t0);
    assert.equal(first.kind, 'drag');
    assert.ok((first.tick - t0) / 120 <= 0.22);
    assert.ok(minD > 0.12, 'мяч не проходит сквозь центр тела: ' + minD);
    assert.ok(maxYawStep <= w.P.player.turnRate / 120 + 1e-9, 'корпус не разворачивается рывком');
    assert.ok(w.player.possession && w.player.vz < -3, 'игрок ушёл в новую сторону с мячом');
    assert.equal(w.stats.misses, 0);
  }
});

test('срезка на 90° и пауза между касаниями манёвра', () => {
  const { w, inp, run, log } = harness('free');
  inp.mz = 1; run(0.75); inp.mz = 0; inp.mx = -1; const t0 = w.tick; run(0.8);
  const touches = log.filter((e) => e.type === 'touch' && e.tick > t0);
  assert.equal(touches[0].kind, 'cut');
  assert.ok((touches[1].tick - touches[0].tick) / 120 >= 0.15, 'после срезки нет мгновенного второго касания');
  for (let i = 1; i < log.length; i++) if (log[i].type === 'touch' && log[i - 1].type === 'touch') assert.ok(log[i].tick > log[i - 1].tick, 'одно касание за шаг');
});

test('пивот: опорная стопа не выворачивается дальше предела относительно корпуса', () => {
  const { w, inp, run } = harness('free');
  let maxTwist = 0;
  const check = () => { for (const f of w.player.feet) if (f.planted) { let d = Math.abs(f.yaw - w.player.yaw) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; maxTwist = Math.max(maxTwist, d); } };
  inp.mz = 1; run(0.6, check); inp.mz = -1; run(0.6, check); inp.mz = 0; inp.mx = 1; run(0.6, check);
  assert.ok(maxTwist < 0.95, 'скручивание стопы ' + maxTwist);
});

test('остановка: игрок встаёт за мячом, а не над ним', () => {
  const { w, inp, run } = harness('free');
  inp.mz = 1; run(0.8); inp.mz = 0; run(1.2);
  const p = w.player, ahead = (w.ball.x - p.x) * Math.cos(p.yaw) + (w.ball.z - p.z) * Math.sin(p.yaw);
  assert.ok(ahead > 0.25 && ahead < 0.6, 'мяч впереди на ' + ahead);
  assert.ok(Math.hypot(p.vx, p.vz) < 0.05);
});

test('цикл бега: стопы строго чередуются, шаги равны по времени, полёт короткий', () => {
  for (const [scn, opts, maxFlight] of [['motor', {}, 0.11], ['free', {}, 0.11], ['motor', { sprintHeld: true }, 0.14], ['motor', { controlHeld: true }, 0.05], ['free', { controlHeld: true }, 0.03]]) {
    const { w, inp, run } = harness(scn);
    w.player.z = -4.3; w._placeFeet(w.player); if (scn === 'free') w.ball.z = -4.3; // разбег через всю ширину площадки
    Object.assign(inp, opts); inp.mz = 1; run(0.5);
    const strikes = []; const prev = [true, true]; let air = 0, maxAir = 0;
    run(1.0, () => {
      const f = w.player.feet;
      for (let k = 0; k < 2; k++) { if (f[k].planted && !prev[k]) strikes.push([k, w.tick]); prev[k] = f[k].planted; }
      if (!f[0].planted && !f[1].planted) { air++; maxAir = Math.max(maxAir, air); } else air = 0;
    });
    assert.ok(strikes.length >= 3, scn + ' шагов ' + strikes.length);
    for (let i = 1; i < strikes.length; i++) assert.notEqual(strikes[i][0], strikes[i - 1][0], 'одна нога дважды подряд');
    const iv = strikes.slice(1).map((s, i) => s[1] - strikes[i][1]);
    assert.ok(Math.max(...iv) - Math.min(...iv) <= 3, 'неровный шаг: ' + iv.join(','));
    assert.ok(maxAir / 120 <= maxFlight, scn + JSON.stringify(opts) + ' полёт ' + (maxAir / 120).toFixed(3));
  }
});

// ---------- удар по летящему мячу в касание ----------
function strike(scn, { pressAt = 0.45, hold = 0.6, jumpAt = null, setup = null } = {}) {
  const h = harness(scn);
  if (setup) setup(h.w);
  let t = 0;
  const seg = (sec) => { h.run(sec); t += sec; };
  if (jumpAt !== null && jumpAt < pressAt) { seg(jumpAt); h.inp.jumpPressed = true; seg(pressAt - jumpAt); } else seg(pressAt);
  h.inp.kickPressed = true; h.inp.kickHeld = true; seg(hold); h.inp.kickHeld = false; seg(1.0);
  return h;
}

test('удар в касание: низкий мяч, с лёта, после рикошета — стопа встречает мяч раньше корпуса', () => {
  for (const [scn, volley] of [['low', false], ['thigh', true], ['chest', true], ['wall', false]]) {
    const h = strike(scn, scn === 'wall' ? { pressAt: 0.6, hold: 0.8 } : {});
    const k = h.log.find((e) => e.type === 'kick');
    assert.ok(k, scn + ': удар состоялся');
    assert.equal(k.firstTime, true);
    assert.equal(k.volley, volley, scn + ' volley');
    assert.equal(h.count('body'), 0, scn + ': мяч не попал в корпус');
    assert.equal(h.count('kick'), 1);
    assert.ok(k.speed > 15 && k.speed <= h.w.P.kick.maxSpeed + h.w.P.kick.volleyOverMax, 'скорость ' + k.speed);
    assert.ok(h.log.some((e) => e.type === 'kick_windup' && e.dynamic && e.tick < k.tick), 'замах начат заранее');
  }
});

test('удар в касание: держать кнопку до контакта не мешает, заряд растёт; ранний отпуск — слабее', () => {
  const long = strike('thigh', { pressAt: 0.2, hold: 0.9 }).log.find((e) => e.type === 'kick');
  const short = strike('thigh', { pressAt: 0.2, hold: 0.05 }).log.find((e) => e.type === 'kick');
  assert.ok(long && short);
  assert.ok(long.charge > 0.6 && short.charge < 0.2);
  assert.ok(long.speed > short.speed + 3);
});

test('удар в прыжке: ручной прыжок и автоматический, когда стоя не достать', () => {
  const manual = strike('chest', { jumpAt: 0.5, pressAt: 0.55, hold: 0.6 });
  const km = manual.log.find((e) => e.type === 'kick');
  assert.ok(km && km.jump && km.volley, 'удар в ручном прыжке');
  // мяч проходит над игроком выше досягаемости стоя — игрок выпрыгивает сам
  const auto = strike('motor', { pressAt: 0.25, hold: 0.8, setup: (w) => { const b = w.ball; b.x = 3; b.z = 0; b.y = 1.6; b.vx = -13; b.vy = 2.2; b.vz = 0; } });
  const ka = auto.log.find((e) => e.type === 'kick');
  assert.ok(auto.log.some((e) => e.type === 'jump' && e.strike), 'автоматический прыжок');
  assert.ok(ka && ka.jump, 'удар в автоматическом прыжке');
});

test('удар в касание: недостижимый летящий мяч не получает импульса, удар отменяется', () => {
  const h = strike('motor', { pressAt: 0.1, hold: 0.2, setup: (w) => { const b = w.ball; b.x = 3; b.z = 4; b.y = 1; b.vx = -12; b.vy = 2; b.vz = 0.5; } });
  assert.equal(h.count('kick'), 0);
  assert.ok(h.log.some((e) => e.type === 'kick_empty' || e.type === 'kick_cancel'));
  assert.equal(h.w.player.kick, null);
});

test('песочница: после гола идёт новая подача, щит вместо ворот возвращает мяч', () => {
  const a = harness('free');
  a.inp.kickPressed = true; a.inp.kickHeld = true; a.run(0.3); a.inp.kickHeld = false; a.run(3);
  assert.equal(a.count('goal'), 1);
  assert.ok(a.log.some((e) => e.type === 'feed' && e.tick > a.log.find((x) => x.type === 'goal').tick), 'подача после гола');
  const b = harness('free');
  b.w.P.field.reboundWall = true;
  b.inp.kickPressed = true; b.inp.kickHeld = true; b.run(0.3); b.inp.kickHeld = false;
  let back = false; b.run(2.5, () => { if (b.w.ball.x < 0 && b.w.ball.vx < 0) back = true; });
  assert.equal(b.count('goal'), 0);
  assert.ok(back, 'мяч вернулся на половину игрока');
});

test('команды песочницы записываются в журнал: повтор с подачей, возвратом мяча и щитом точен', () => {
  const a = harness('free', 5);
  a.inp.mz = 1; a.run(0.4); a.inp.mz = 0;
  a.inp.cmdWall = true; a.run(1 / 120); a.inp.cmdWall = false;
  a.inp.cmdServe = true; a.run(1 / 120); a.inp.cmdServe = false; a.run(0.5);
  a.inp.kickPressed = true; a.inp.kickHeld = true; a.run(0.5); a.inp.kickHeld = false; a.run(1.5);
  a.inp.cmdReturn = true; a.run(1 / 120); a.inp.cmdReturn = false; a.run(0.3);
  assert.ok(a.log.some((e) => e.type === 'wall_toggle' && e.on) && a.log.some((e) => e.type === 'ball_return'));
  const frames = a.w.inputLog.map((x) => x.slice());
  const P = createProfile(); P.field.reboundWall = a.w.startWall;
  const b = new World(P, { seed: 5 }); b.reset('free');
  const inp = emptyInput();
  for (const f of frames) b.step(unpackInput(f, inp));
  assert.equal(b.hash(), a.w.hash());
  assert.deepEqual(b.stats, a.w.stats);
});

// ---------- защитная стойка
const inp = (o = {}) => Object.assign(emptyInput(), o);
test('защитная стойка: лицом к мячу, приставной шаг, широкие стопы; с мячом не включается', () => {
  const w = new World(createProfile(), { seed: 4 });
  w.reset('motor'); // мяч далеко справа-снизу
  const p = w.player, G = w.P.guard;
  for (let i = 0; i < 180; i++) w.step(inp({ guardHeld: true, mz: -1 }));
  assert.equal(p.guard, true);
  assert.equal(p.mode, 'guard');
  const sp = Math.hypot(p.vx, p.vz);
  assert.ok(Math.abs(sp - G.speed) < 0.1, 'скорость приставного шага ' + sp.toFixed(2));
  const toBall = Math.atan2(w.ball.z - p.z, w.ball.x - p.x);
  assert.ok(Math.abs(Math.atan2(Math.sin(toBall - p.yaw), Math.cos(toBall - p.yaw))) < 0.2, 'корпус развёрнут к мячу, а не по ходу движения');
  for (let i = 0; i < 120; i++) w.step(inp({ guardHeld: true }));
  assert.ok(Math.hypot(p.vx, p.vz) < 0.05, 'остановка в стойке быстрая');
  const spread = Math.hypot(p.feet[0].x - p.feet[1].x, p.feet[0].z - p.feet[1].z);
  assert.ok(spread > w.P.player.footSpread * 2 * 1.4, 'стопы расставлены шире: ' + spread.toFixed(3));

  w.reset('free');
  for (let i = 0; i < 30; i++) w.step(inp({ guardHeld: true }));
  assert.equal(w.player.possession, true);
  assert.equal(w.player.guard, false, 'с мячом стойка не включается');
});

test('рывок в стойке: быстрый сдвиг в сторону, пауза перед следующим; без направления — обычный прыжок', () => {
  const w = new World(createProfile(), { seed: 4 });
  w.reset('motor');
  const p = w.player;
  for (let i = 0; i < 30; i++) w.step(inp({ guardHeld: true }));
  const z0 = p.z;
  let lunges = 0, peak = 0;
  for (let i = 0; i < 60; i++) {
    w.step(inp({ guardHeld: true, mz: 1, jumpPressed: i === 0 || i === 20 }));
    for (const e of w.events) if (e.type === 'lunge') lunges++;
    peak = Math.max(peak, p.vz);
    assert.equal(p.y, 0, 'рывок — не прыжок');
  }
  assert.equal(lunges, 1, 'второй рывок во время первого и паузы не начинается');
  assert.ok(peak > 5.5, 'скорость рывка ' + peak.toFixed(2));
  const d = p.z - z0;
  assert.ok(d > 1.3 && d < 2.6, 'сдвиг за полсекунды ' + d.toFixed(2) + ' м');
  for (let i = 0; i < 60; i++) w.step(inp({ guardHeld: true }));
  let jumped = false;
  for (let i = 0; i < 40; i++) { w.step(inp({ guardHeld: true, jumpPressed: i === 0 })); if (p.y > 0.05) jumped = true; }
  assert.ok(jumped, 'без направления остаётся обычный прыжок');
});

test('приём в стойке: сильный удар гасится телом и мяч остаётся под контролем; без стойки — отлетает', () => {
  const shoot = (guard, h, speed, lungeAt = -1) => {
    const w = new World(createProfile(), { seed: 4 });
    w.reset('motor');
    const p = w.player, b = w.ball;
    for (let i = 0; i < 40; i++) w.step(inp({ guardHeld: guard }));
    b.x = p.x + 7; b.z = p.z + (lungeAt >= 0 ? 1.1 : 0.05); b.y = h; b.vx = -speed; b.vz = 0; b.vy = h > 0.3 ? 1.5 : 0;
    let rec = null, maxAway = 0, hit = false;
    for (let i = 0; i < 240; i++) {
      w.step(inp({ guardHeld: guard, mz: lungeAt >= 0 && i >= lungeAt ? 1 : 0, jumpPressed: i === lungeAt }));
      for (const e of w.events) { if (e.type === 'receive') rec = e; if (e.type === 'receive' || e.type === 'body') hit = true; }
      if (hit) maxAway = Math.max(maxAway, Math.hypot(b.x - p.x, b.z - p.z));
    }
    return { rec, hit, maxAway, poss: p.possession, speed: Math.hypot(b.vx, b.vz) };
  };
  for (const [h, name] of [[0.11, 'низом'], [0.7, 'в бедро'], [1.2, 'в грудь']]) {
    for (const v of [12, 20]) {
      const g = shoot(true, h, v);
      assert.ok(g.rec && g.rec.guard, `${name} ${v} м/с: приём в стойке состоялся`);
      assert.ok(g.maxAway < 1.8, `${name} ${v} м/с: мяч остался рядом (${g.maxAway.toFixed(2)} м)`);
      assert.ok(g.poss, `${name} ${v} м/с: мяч под контролем`);
    }
  }
  const n = shoot(false, 0.7, 20);
  assert.ok(n.hit && !n.rec, 'без стойки — обычный отскок от тела');
  assert.ok(n.maxAway > 2.5, 'без стойки мяч отлетает: ' + n.maxAway.toFixed(2));
  // мяч идёт в метре сбоку: стоя не достать, рывком — достать
  const miss = shoot(true, 0.11, 16);
  const still = (() => { const w = shoot(true, 0.11, 16, 9999); return w; })();
  assert.ok(!still.hit, 'мяч в метре сбоку мимо стоящего игрока');
  const lunge = shoot(true, 0.11, 16, 35);
  assert.ok(lunge.rec, 'рывок достаёт мяч, идущий в метре сбоку');
  assert.ok(lunge.maxAway < 2.2, 'после рывка мяч рядом: ' + lunge.maxAway.toFixed(2));
  assert.ok(miss.rec);
});

// ---------- чеканка, удар через себя, остановка низового мяча, опорная нога
test('чеканка: подброс, повторный прыжок — серия касаний; движение с мячом в воздухе; удар с лёта из чеканки', () => {
  const w = new World(createProfile(), { seed: 7 });
  w.reset('free');
  const p = w.player, b = w.ball;
  let touches = 0, kick = null, maxD = 0, started = false;
  for (let i = 0; i < 780; i++) {
    const t = i / 120;
    w.step(inp({ jumpPressed: i === 10 || i === 60, mz: t > 2.5 && t < 4.5 ? 1 : 0, kickHeld: t > 6 && t < 6.3, kickPressed: i === 721 }));
    for (const e of w.events) {
      if (e.type === 'juggle_start') started = true;
      if (e.type === 'touch' && e.kind === 'juggle') touches++;
      if (e.type === 'kick') kick = e;
      assert.notEqual(e.type, 'body', 'в чеканке мяч не отскакивает от корпуса');
    }
    if (p.juggle) { maxD = Math.max(maxD, Math.hypot(b.x - p.x, b.z - p.z)); assert.equal(p.possession, false); }
    if (t > 1 && t < 6) assert.ok(p.juggle, 'серия не прерывается сама, t=' + t.toFixed(2));
  }
  assert.ok(started);
  assert.ok(touches >= 8, 'касаний в серии: ' + touches);
  assert.ok(maxD < 0.9, 'мяч остаётся у ног: ' + maxD.toFixed(2));
  assert.ok(p.z > 0.5, 'игрок прошёл с мячом в воздухе: ' + p.z.toFixed(2));
  assert.ok(kick && kick.volley && kick.firstTime, 'из чеканки удар идёт с лёта');
  assert.equal(p.juggle, null);
});

test('чеканка кончается честно: спринт бросает серию, мяч падает сам', () => {
  const w = new World(createProfile(), { seed: 7 });
  w.reset('free');
  const p = w.player;
  for (let i = 0; i < 200; i++) w.step(inp({ jumpPressed: i === 10 || i === 60 }));
  assert.ok(p.juggle && p.juggle.n >= 1);
  for (let i = 0; i < 30; i++) w.step(inp({ sprintHeld: true, mx: -1 }));
  assert.equal(p.juggle, null);
});

test('удар через себя: спиной к воротам по мячу в воздухе — без разворота, в прыжке, мяч летит к воротам', () => {
  for (const [h, dx] of [[2.2, -0.3], [2.6, 0.2]]) {
    const w = new World(createProfile(), { seed: 7 });
    w.reset('motor');
    const p = w.player, b = w.ball;
    for (let i = 0; i < 90; i++) w.step(inp({ mx: -1 }));
    for (let i = 0; i < 60; i++) w.step(inp());
    assert.ok(Math.abs(Math.abs(p.yaw) - Math.PI) < 0.2, 'игрок стоит спиной к правым воротам');
    b.x = p.x + dx; b.z = p.z + 0.05; b.y = h; b.vx = b.vz = b.vy = 0;
    let kick = null, yawAtKick = 0, pyAtKick = 0, maxLeg = 0, minLeg = 9;
    for (let i = 0; i < 200; i++) {
      w.step(inp({ kickHeld: i < 40, kickPressed: i === 0 }));
      const k = p.kick;
      if (k && k.dyn && (k.phase === 'windup' || k.phase === 'swing')) {
        const f = p.feet[k.footSide > 0 ? 1 : 0], rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
        const L = Math.hypot(f.x - (p.x + rx * k.footSide * 0.09), f.h + 0.1 - (p.y + 0.9), f.z - (p.z + rz * k.footSide * 0.09));
        maxLeg = Math.max(maxLeg, L); minLeg = Math.min(minLeg, L);
      }
      for (const e of w.events) if (e.type === 'kick') { kick = e; yawAtKick = p.yaw; pyAtKick = p.y; assert.ok(b.vx > 8, 'мяч летит к воротам: ' + b.vx.toFixed(1)); }
    }
    assert.ok(kick && kick.bike, 'удар через себя состоялся');
    assert.ok(Math.abs(Math.abs(yawAtKick) - Math.PI) < 0.35, 'корпус остался спиной к воротам');
    assert.ok(pyAtKick > 0.15, 'удар в прыжке');
    assert.ok(maxLeg <= w.P.kick.legMax + 0.01 && minLeg >= w.P.kick.legMin - 0.01, `нога в анатомических пределах: ${minLeg.toFixed(2)}–${maxLeg.toFixed(2)}`);
  }
});

test('низовой мяч в ноги без нажатий: до 9 м/с — остановка, быстрее — щёчка; мяч остаётся рядом', () => {
  const run = (v, turnAway) => {
    const w = new World(createProfile(), { seed: 7 });
    w.reset('motor');
    const p = w.player, b = w.ball;
    for (let i = 0; i < 30; i++) w.step(inp(turnAway ? { mx: -1 } : {}));
    for (let i = 0; i < 40; i++) w.step(inp());
    b.x = p.x + 5; b.z = p.z + 0.04; b.y = 0.11; b.vx = -v; b.vz = 0; b.vy = 0;
    let rec = null, body = false, maxAway = 0;
    for (let i = 0; i < 300; i++) {
      w.step(inp());
      for (const e of w.events) { if (e.type === 'receive') rec = e; if (e.type === 'body') body = true; }
      if (rec || body) maxAway = Math.max(maxAway, Math.hypot(b.x - p.x, b.z - p.z));
    }
    return { rec, body, maxAway, poss: p.possession, gesture: rec };
  };
  const a = run(8);
  assert.equal(a.rec.auto, 'stop');
  assert.ok(a.maxAway < 0.6 && a.poss);
  for (const v of [12, 18]) {
    const c = run(v);
    assert.equal(c.rec.auto, 'cushion');
    assert.ok(c.maxAway < 1.2, `${v} м/с: мяч отскочил недалеко (${c.maxAway.toFixed(2)} м)`);
    assert.ok(c.maxAway > a.maxAway, 'сильный мяч отскакивает дальше остановленного');
  }
  const back = run(14, true);
  assert.ok(back.body && !back.rec, 'спиной к мячу приёма нет — обычный отскок');
});

test('опорная нога не остаётся позади корпуса: удар с хода, выход из удара, остановка со спринта', () => {
  const far = (w) => Math.max(...w.player.feet.filter((f) => f.planted && !f.ctl).map((f) => Math.hypot(f.x - w.player.x, f.z - w.player.z)), 0);
  for (const sc of ['low', 'thigh', 'wall']) {
    const w = new World(createProfile(), { seed: 7 });
    w.reset(sc);
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      w.step(inp({ kickHeld: i > 16 && i < 140, kickPressed: i === 17, mx: i < 16 ? 1 : 0 }));
      worst = Math.max(worst, far(w));
    }
    assert.ok(worst < 0.75, `${sc}: опора не дальше 0,75 м от таза (было до 1,8 м): ${worst.toFixed(2)}`);
  }
  const w = new World(createProfile(), { seed: 7 });
  w.reset('motor');
  let worst = 0;
  for (let i = 0; i < 600; i++) {
    const ph = Math.floor(i / 100) % 4;
    w.step(inp({ sprintHeld: true, mx: [1, -1, 0, 0][ph], mz: [0, 0, 1, -1][ph] }));
    worst = Math.max(worst, far(w));
  }
  assert.ok(worst < 0.75, 'спринт с разворотами: ' + worst.toFixed(2));
});

// ---------- ворота в поле: рама, сетка снаружи и изнутри
test('ворота выступают в поле: гол в створ, штанга и перекладина отбивают, сетка снаружи не пускает', () => {
  const P = createProfile(), F = P.field, gx = F.length / 2 - F.goalInset, r = P.ball.radius;
  const shot = (set, ticks = 480) => {
    const b = createBall(P), ev = [];
    set(b);
    const types = [];
    for (let i = 0; i < ticks; i++) { ev.length = 0; stepBall(b, 1 / 120, P, ev, null); for (const e of ev) types.push(e.type + (e.part ? ':' + e.part : '')); }
    return { b, types, goals: types.filter((t) => t === 'goal_line').length };
  };
  // прямой удар в створ: один гол, мяч остаётся в сетке между линией и бортом
  const g = shot((b) => { b.x = 4; b.y = 0.6; b.z = 0.5; b.vx = 22; b.vy = 1; });
  assert.equal(g.goals, 1);
  assert.ok(g.types.includes('net:back'), 'мяч погашен задней сеткой');
  assert.ok(g.b.x > gx && g.b.x < F.length / 2 && Math.abs(g.b.z) < F.goalWidth / 2, 'мяч лежит в воротах');
  // в штангу: отскок по круглой поверхности обратно в поле, гола нет
  const post = shot((b) => { b.x = 4; b.y = 0.5; b.z = F.goalWidth / 2 + 0.02; b.vx = 18; });
  assert.ok(post.types.includes('post'));
  assert.equal(post.goals, 0);
  const post2 = shot((b) => { b.x = 4; b.y = 0.5; b.z = F.goalWidth / 2 - 0.08; b.vx = 18; }, 40);
  assert.ok(post2.types.includes('post'));
  assert.ok(post2.b.vz < -1, 'от внутренней стороны штанги мяч уходит к центру ворот: ' + post2.b.vz.toFixed(1));
  // в перекладину
  const bar = shot((b) => { b.x = 4; b.y = F.goalHeight - 0.05; b.z = 0; b.vx = 20; b.vy = 1.05; }, 60);
  assert.ok(bar.types.includes('post'));
  assert.equal(bar.goals, 0);
  // сбоку из-за линии ворот: боковая сетка снаружи
  const side = shot((b) => { b.x = gx + 0.4; b.y = 0.4; b.z = 3.5; b.vz = -12; });
  assert.ok(side.types.includes('net:near'));
  assert.equal(side.goals, 0);
  assert.ok(side.b.z > F.goalWidth / 2, 'мяч остался снаружи ворот');
  // навес на верхнюю сетку: мяч не проваливается и скатывается обратно в поле
  const top = shot((b) => { b.x = gx + 0.4; b.y = 4; b.z = 0.3; b.vy = -1; }, 720);
  assert.ok(top.types.includes('net:top'));
  assert.equal(top.goals, 0);
  assert.ok(top.b.x < gx && top.b.y < 0.5, 'мяч скатился перед воротами: x=' + top.b.x.toFixed(2) + ' y=' + top.b.y.toFixed(2));
  // мяч за линией рядом со штангой, но вне рамы — не гол
  const wide = shot((b) => { b.x = 4; b.y = 0.3; b.z = F.goalWidth / 2 + 0.6; b.vx = 15; });
  assert.equal(wide.goals, 0);
  assert.ok(wide.types.includes('wall'), 'мяч дошёл до торцевого борта мимо ворот');
  assert.ok(r > 0);
});

test('игрок не заходит в ворота: упор в раму спереди и в сетку сбоку', () => {
  const w = new World(createProfile(), { seed: 3 });
  w.reset('motor');
  const p = w.player, F = w.P.field, R = w.P.player.radius;
  for (let i = 0; i < 360; i++) w.step(inp({ mx: -1 }));
  assert.ok(p.x >= -(F.length / 2 - F.goalInset - R) - 1e-6, 'спереди игрок упирается в линию ворот: ' + p.x.toFixed(2));
  for (let i = 0; i < 240; i++) w.step(inp({ mz: 1 }));
  for (let i = 0; i < 240; i++) w.step(inp({ mx: -1 }));
  assert.ok(p.x < -(F.length / 2 - F.goalInset), 'сбоку от ворот можно зайти за линию');
  for (let i = 0; i < 240; i++) w.step(inp({ mz: -1 }));
  assert.ok(p.z >= F.goalWidth / 2 + R - 1e-6, 'сбоку игрок упирается в сетку: ' + p.z.toFixed(2));
});
