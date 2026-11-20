// Действия второй раскладки: навес, суперудар, подкат, дотянуться до мяча, чеканка одной кнопкой
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, emptyInput, packInput, unpackInput } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';

const inp = (o = {}) => Object.assign(emptyInput(), o);
const make = (scenario = 'free') => { const w = new World(createProfile(), { seed: 7 }); w.reset(scenario); return w; };

test('ввод: новые кнопки переживают упаковку кадра', () => {
  const a = unpackInput(packInput(inp({ lobPressed: true, lobHeld: true, superHeld: true, superPressed: true, mx: 0.5 })));
  assert.ok(a.lobPressed && a.lobHeld && a.superHeld && a.superPressed);
  const z = unpackInput(packInput(inp()));
  assert.ok(!z.lobPressed && !z.lobHeld && !z.superHeld);
});

test('навес: мяч перелетает стоящего игрока невысокой быстрой дугой и опускается на дальности по заряду', () => {
  const K = createProfile().kick;
  for (const hold of [0.1, 0.25]) {
    const w = make('free'), b = w.ball, p = w.player;
    let kick = null, apex = 0, land = null, over = null, x0 = 0, z0 = 0, t0 = 0, flight = 0;
    for (let i = 0; i < 600 && !land; i++) {
      w.step(inp({ lobPressed: i === 0, lobHeld: i < hold * 120 }));
      for (const e of w.events) {
        if (e.type === 'kick') { kick = e; x0 = b.x; z0 = b.z; t0 = i; }
        if (kick && e.type === 'bounce') { land = Math.hypot(b.x - x0, b.z - z0); flight = (i - t0) / 120; }
      }
      if (kick) {
        apex = Math.max(apex, b.y);
        if (over === null && b.x - x0 > 2.5) over = b.y; // «защитник» в 2,5 м перед мячом
      }
    }
    assert.ok(kick && kick.kind === 'lob', 'кнопка навеса с мячом даёт навес');
    const want = K.lobMin + (K.lobMax - K.lobMin) * kick.charge;
    assert.ok(land !== null && Math.abs(land - want) < 1.2, `приземление ${land?.toFixed(2)} при расчёте ${want.toFixed(2)}`);
    assert.ok(over > 2.1, 'мяч проходит над головой игрока в 2,5 м: ' + over.toFixed(2));
    assert.ok(apex < w.P.field.fenceHeight - 0.3, 'навес не задевает потолок: ' + apex.toFixed(2));
    // не «парашют»: прежний навес на 6–9 м поднимался на 0,42–0,44 дальности и летел 1,5–1,9 с
    assert.ok(apex < land * 0.4 + 0.1, 'дуга невысокая: высота ' + apex.toFixed(2) + ' на дальности ' + land.toFixed(2));
    assert.ok(flight < 0.08 * land + 0.9, 'навес летит быстро: ' + flight.toFixed(2) + ' с на ' + land.toFixed(2) + ' м');
    assert.equal(p.slide, null, 'с мячом та же кнопка подкат не включает');
  }
});

test('навес: дальний навес не задевает потолок и садится на расчётной дальности (крыша сетки не сбивает подбор)', () => {
  const K = createProfile().kick, w = make('free'), b = w.ball, p = w.player;
  const sh = 4.3 * p.side; p.x += sh; b.x += sh; for (const f of p.feet) f.x += sh; // от своих ворот: до чужих ~16 м
  let kick = null, apex = 0, land = null, x0 = 0, z0 = 0;
  for (let i = 0; i < 600 && !land; i++) {
    w.step(inp({ lobPressed: i === 0, lobHeld: i < 70 }));
    for (const e of w.events) {
      if (e.type === 'kick') { kick = e; x0 = b.x; z0 = b.z; }
      if (kick && e.type === 'bounce') land = Math.hypot(b.x - x0, b.z - z0);
    }
    if (kick) apex = Math.max(apex, b.y);
  }
  assert.ok(kick && kick.charge > 0.99, 'полный заряд');
  assert.ok(land !== null && Math.abs(land - K.lobMax) < 1.2, 'дальность ' + land?.toFixed(2));
  assert.ok(apex < 5.2, 'высота дальнего навеса ' + apex.toFixed(2));
});

test('навес: с места точный, с хода разброс по направлению и дальности заметно больше', () => {
  const K = createProfile().kick;
  const spread = (run) => {
    const lat = [], rng = [];
    for (let seed = 1; seed <= 10; seed++) {
      const w = new World(createProfile(), { seed }); w.reset('free');
      const b = w.ball, p = w.player, pre = run ? 40 : 0;
      let kick = null, land = null, x0 = 0, z0 = 0;
      for (let i = 0; i < 600 && !land; i++) {
        const s = i - pre;
        w.step(inp({ mx: run && !kick ? -p.side : 0, lobPressed: s === 0, lobHeld: s >= 0 && s < 12 }));
        for (const e of w.events) {
          if (e.type === 'kick' && !kick) { kick = e; x0 = b.x; z0 = b.z; }
          if (kick && e.type === 'bounce' && !land) land = { d: Math.hypot(b.x - x0, b.z - z0), z: b.z - z0 };
        }
      }
      assert.ok(kick && land, 'навес ' + (run ? 'с хода' : 'с места') + ', seed ' + seed);
      lat.push(Math.abs(land.z)); rng.push(Math.abs(land.d / (K.lobMin + (K.lobMax - K.lobMin) * kick.charge) - 1));
    }
    return { lat: Math.max(...lat), rng: Math.max(...rng) };
  };
  const still = spread(false), moving = spread(true);
  assert.ok(still.lat < 0.25 && still.rng < 0.05, `с места: вбок до ${still.lat.toFixed(2)} м, дальность ±${(still.rng * 100).toFixed(0)}%`);
  assert.ok(moving.lat > 3 * still.lat && moving.rng > 0.12, `с хода: вбок до ${moving.lat.toFixed(2)} м, дальность ±${(moving.rng * 100).toFixed(0)}%`);
});

test('удар головой в прыжке: мяч на уровне головы уходит в створ чужих ворот, стрелка задаёт сторону', () => {
  const run = (jt, mz) => {
    const w = new World(createProfile(), { seed: 3 }); w.reset('free'); const b = w.ball, p = w.player;
    for (let i = 0; i < 30; i++) w.step(inp());
    Object.assign(b, { x: p.x - 6 * p.side, y: 3.2, z: p.z, vx: 8 * p.side, vy: 2.5, vz: 0, wx: 0, wy: 0, wz: 0, rolling: false });
    let hd = null, cross = null;
    for (let i = 0; i < 400 && !cross; i++) {
      w.step(inp({ jumpPressed: i === jt, mz: i >= jt ? mz : 0 }));
      for (const e of w.events) if (e.type === 'header') hd = e;
      if (hd && Math.abs(b.x) > w.P.field.length / 2 - w.P.field.goalInset) cross = { y: b.y, z: b.z, x: b.x };
    }
    return { hd, cross, side: p.side };
  };
  const mid = run(52, 0), up = run(70, -1), down = run(70, 1);
  assert.ok(mid.hd && mid.hd.aimed, 'в прыжке лицом к воротам — удар головой');
  assert.ok(mid.cross && mid.cross.x * mid.side < 0, 'мяч идёт к чужим воротам');
  assert.ok(Math.abs(mid.cross.z) < 1.4 && mid.cross.y < 2.2, `в створ: z ${mid.cross.z.toFixed(2)}, высота ${mid.cross.y.toFixed(2)}`);
  assert.ok(up.cross && down.cross && up.cross.z < mid.cross.z - 0.5 && down.cross.z > mid.cross.z + 0.5,
    `стрелка разводит удары: ${up.cross?.z.toFixed(2)} / ${mid.cross.z.toFixed(2)} / ${down.cross?.z.toFixed(2)}`);
});

test('суперудар: без полной шкалы не бьёт; с полной — мяч летит быстрее обычного предела, шкала обнуляется', () => {
  const w = make('free'), p = w.player, K = w.P.kick;
  let empty = false, kick = null;
  w.step(inp({ superPressed: true, superHeld: true }));
  for (const e of w.events) if (e.type === 'super_empty') empty = true;
  assert.ok(empty && !p.kick, 'шкала не полная: удара нет');
  p.superCharge = 1;
  for (let i = 0; i < 240 && !kick; i++) {
    w.step(inp({ superPressed: i === 0 }));
    for (const e of w.events) if (e.type === 'kick') kick = e;
  }
  assert.ok(kick && kick.kind === 'super');
  assert.ok(Math.hypot(w.ball.vx, w.ball.vy, w.ball.vz) > K.maxSpeed + 4, 'скорость мяча выше обычного предела');
  assert.ok(p.superCharge < 0.05, 'шкала потрачена');
  // шкала копится со временем
  const w2 = make('motor');
  for (let i = 0; i < 120 * (K.superFill + 1); i++) w2.step(inp());
  assert.equal(w2.player.superCharge, 1);
});

test('подкат: без мяча кнопка навеса — скольжение к мячу, стопа выбивает мяч; после подката игрок встаёт', () => {
  const w = make('motor'), p = w.player, b = w.ball, T = w.P.tackle;
  b.x = p.x + 2.6; b.z = p.z + 0.2; b.vx = b.vz = 0;
  let tackle = null, top = 0, slid = false;
  for (let i = 0; i < 200; i++) {
    w.step(inp({ lobPressed: i === 5 }));
    for (const e of w.events) if (e.type === 'tackle') tackle = e;
    if (p.slide) { slid = true; top = Math.max(top, Math.hypot(p.vx, p.vz)); assert.equal(p.guard, false); }
  }
  assert.ok(slid && top > T.speed * 0.85, 'скорость скольжения: ' + top.toFixed(2));
  assert.ok(tackle, 'ведущая стопа достала мяч');
  assert.ok(b.x > p.x + 0.5, 'мяч выбит по ходу подката');
  assert.equal(p.slide, null);
  assert.ok(!p.feet[0].ctl && !p.feet[1].ctl, 'стопы возвращены в обычный цикл');
  assert.ok(Math.hypot(p.vx, p.vz) < 0.3, 'после подката игрок остановился');
  // направление — по команде движения
  const w2 = make('motor'), q = w2.player, z0 = q.z;
  for (let i = 0; i < 60; i++) w2.step(inp({ lobPressed: i === 0, mz: 1 }));
  assert.ok(q.z - z0 > 1.5, 'подкат идёт туда, куда нажато: ' + (q.z - z0).toFixed(2));
});

test('подкат в прыжке: прыжок и подкат сочетаются — стопа достаёт мяч на весу', () => {
  for (const order of ['jump-first', 'slide-first']) {
    const w = make('motor'), p = w.player, b = w.ball;
    let tackle = null, air = false;
    for (let i = 0; i < 160 && !tackle; i++) {
      // мяч висит на высоте колена в двух метрах по ходу
      if (!tackle) { b.x = p.x < -2 ? -1.6 : b.x; b.z = p.z; b.y = 0.55; b.vx = b.vy = b.vz = 0; }
      const j = order === 'jump-first' ? 0 : 6, s = order === 'jump-first' ? 6 : 0;
      w.step(inp({ mx: 1, jumpPressed: i === 20 + j, lobPressed: i === 20 + s }));
      if (p.slide && p.y > 0.05) air = true;
      for (const e of w.events) if (e.type === 'tackle') tackle = e;
    }
    assert.ok(air, order + ': подкат продолжается в воздухе');
    assert.ok(tackle && tackle.air, order + ': мяч на весу выбит в прыжке');
  }
});

test('дотянуться: с удержанием ближайшая нога достаёт мяч, идущий мимо, и оставляет его рядом; без удержания мяч уходит', () => {
  const pass = (hold) => {
    const w = make('motor'), p = w.player, b = w.ball;
    b.x = p.x + 5; b.z = p.z + 0.8; b.vx = -11; b.vz = 0; // мяч катится мимо в 0,8 м сбоку
    let rec = null, ext = 0, foot = -1;
    for (let i = 0; i < 200; i++) {
      w.step(inp({ superHeld: hold }));
      if (p.reach) { ext = Math.max(ext, p.reach.ext); foot = p.reach.foot; }
      for (const e of w.events) if (e.type === 'receive') rec = e;
    }
    return { rec, ext, foot, d: Math.hypot(b.x - p.x, b.z - p.z), p };
  };
  const a = pass(true), n = pass(false);
  assert.ok(a.rec && a.rec.reach, 'мяч принят вытянутой ногой');
  assert.equal(a.foot, 1, 'тянется нога со стороны мяча');
  assert.ok(a.ext > 0.5, 'нога действительно вытянута: ' + a.ext.toFixed(2));
  assert.ok(a.d < 1.3, 'мяч остался в зоне контроля: ' + a.d.toFixed(2));
  assert.equal(a.p.reach, null);
  assert.ok(!a.p.feet[1].ctl, 'нога вернулась');
  assert.ok(!n.rec && n.d > 3, 'без удержания мяч проходит мимо');
});

test('чеканка одной кнопкой: с мячом пробел подбрасывает мяч и сразу начинает серию', () => {
  const w = make('free'), p = w.player;
  let touches = 0, jumped = false;
  for (let i = 0; i < 480; i++) {
    w.step(inp({ jumpPressed: i === 10 }));
    for (const e of w.events) { if (e.type === 'touch' && e.kind === 'juggle') touches++; if (e.type === 'jump') jumped = true; }
  }
  assert.ok(!jumped, 'с мячом пробел — не прыжок');
  assert.ok(touches >= 4, 'серия идёт без повторного нажатия: ' + touches);
  assert.ok(p.juggle);
});

test('bicycle kick: scissors in the air, fall on the back or on the side, get up; no control until up', () => {
  const run = (dz) => {
    const w = make('motor'), p = w.player, b = w.ball;
    for (let i = 0; i < 90; i++) w.step(inp({ mx: -1 }));
    for (let i = 0; i < 60; i++) w.step(inp());
    const x0 = 0;
    b.x = p.x; b.z = p.z + dz; b.y = 2.6; b.vx = b.vy = b.vz = 0;
    const r = { kick: null, fell: false, roll: 0, lead: 0, cross: 0, down: 0, moved: 0, upAt: -1, landAt: -1, x0 };
    let xLie = null;
    for (let i = 0; i < 420; i++) {
      // the player mashes movement and kick the whole time: nothing may happen until he is up
      w.step(inp({ kickHeld: i < 40, kickPressed: i === 0 || i === 150, jumpPressed: i === 2, mx: i > 60 ? 1 : 0, lobPressed: i === 160 }));
      const k = p.kick, fl = p.fall;
      for (const e of w.events) { if (e.type === 'kick') r.kick = e; if (e.type === 'fall') { r.fell = true; r.landAt = i; r.roll = e.roll; } }
      if (fl && fl.phase === 'air' && k) {
        const kf = p.feet[fl.kickFoot], ff = p.feet[1 - fl.kickFoot];
        if (k.phase === 'windup') r.lead = Math.max(r.lead, ff.h - kf.h); // free leg goes up first
        if (k.phase === 'curl') r.cross = Math.max(r.cross, kf.h - ff.h); // then the kicking leg is above
      }
      if (fl && fl.phase !== 'air') {
        if (fl.phase === 'down' && fl.k >= 1) { r.down++; if (xLie === null) xLie = [p.x, p.z]; }
        assert.equal(p.kick, null, 'no kick while down');
        assert.equal(p.slide, null, 'no slide while down');
      }
      if (r.fell && !fl && r.upAt < 0) { r.upAt = i; r.moved = xLie ? Math.hypot(p.x - xLie[0], p.z - xLie[1]) : 9; }
    }
    return { r, p };
  };
  const a = run(0.05), s = run(0.6);
  for (const { r, p } of [a, s]) {
    assert.ok(r.kick && r.kick.bike, 'bicycle kick happened');
    assert.ok(r.lead > 0.45, 'free leg leads in the windup: ' + r.lead.toFixed(2));
    assert.ok(r.cross > 0.6, 'legs cross over at contact: ' + r.cross.toFixed(2));
    assert.ok(r.fell && r.down > 8, 'the player lies on the turf: ' + r.down);
    const F = make('motor').P.fall; // on the turf: lying + sitting up (down), then the get-up clip (rise)
    assert.ok(r.upAt > 0 && (r.upAt - r.landAt) / 120 < F.down + F.rise + 0.1, 'gets up in down + rise: ' + ((r.upAt - r.landAt) / 120).toFixed(2));
    assert.ok(r.moved < 0.5, 'does not slide around while down: ' + r.moved.toFixed(2));
    assert.equal(p.fall, null);
    assert.ok(!p.feet[0].ctl && !p.feet[1].ctl, 'feet are back in the normal cycle');
  }
  assert.ok(Math.abs(a.r.roll) < 0.3, 'ball overhead: falls on the back, roll ' + a.r.roll.toFixed(2));
  assert.ok(Math.abs(s.r.roll) > 0.7, 'diving sideways: falls on the side, roll ' + s.r.roll.toFixed(2));
});

test('slide tackle: the next one is available right after getting up', () => {
  const w = make('motor'), p = w.player, T = w.P.tackle;
  let starts = 0, was = false;
  for (let i = 0; i < 240; i++) {
    w.step(inp({ lobPressed: i % 6 === 0, mz: 1 }));
    if (p.slide && !was) starts++;
    was = !!p.slide;
  }
  assert.ok(starts >= 2, 'slides in 2 s: ' + starts);
  assert.ok(T.recover + T.cooldown < 0.4);
});

test('flying side volley: low take-off, kick with the body laid sideways; the leg carries on, the body turns and lands on the other leg', () => {
  for (const [h, dx, dz, vx] of [[2.3, 0.5, 0.3, 0], [2.15, 0.6, -0.4, 0], [2.6, 2.5, 0.5, 5]]) {
    const w = make('motor'), p = w.player, b = w.ball;
    for (let i = 0; i < 20; i++) w.step(inp());
    b.x = p.x + dx; b.z = p.z + dz; b.y = h; b.vx = -vx; b.vy = b.vz = 0;
    const yaw0 = p.yaw;
    let kick = null, top = 0, side = 0, footH = 0, byHit = 0, hitAt = -1, landAt = -1, upAt = -1, first = -1, kf = -1, carry = 0, fell = false, kx = 0;
    for (let i = 0; i < 420; i++) {
      w.step(inp({ kickHeld: i < 60, kickPressed: i === 0, jumpPressed: i === 0, mx: i > 80 ? -1 : 0 }));
      top = Math.max(top, p.y);
      const fl = p.fall;
      for (const e of w.events) {
        if (e.type === 'kick') { kick = e; hitAt = i; side = p.kick.fly; kf = p.kick.footSide > 0 ? 1 : 0; footH = p.feet[kf].h - p.y; byHit = b.y; kx = p.x; assert.ok(b.vx > 8, 'the ball goes to the goal: ' + b.vx.toFixed(1)); }
        if (e.type === 'fall') fell = true;
      }
      if (hitAt >= 0 && fl) carry = Math.max(carry, -(p.feet[kf].x - p.x) * fl.ux - (p.feet[kf].z - p.z) * fl.uz); // kicking foot crosses to the other side
      if (fl && fl.phase === 'land') {
        if (landAt < 0) landAt = i;
        if (first < 0) { if (p.feet[1 - kf].planted) first = 1 - kf; else if (p.feet[kf].planted) first = kf; }
      }
      if (landAt >= 0 && !fl && upAt < 0) upAt = i;
    }
    const tag = `h=${h} dz=${dz}: `, turned = Math.abs(Math.atan2(Math.sin(p.yaw - yaw0), Math.cos(p.yaw - yaw0)));
    assert.ok(kick && kick.fly, tag + 'flying side volley happened');
    assert.equal(side, dz > 0 ? 1 : -1, tag + 'kicks with the leg on the ball side'); // the player faces +x: +z is his right
    assert.ok(top < 0.8, tag + 'no jump to the ball level: ' + top.toFixed(2));
    assert.ok(byHit - top > 0.9, tag + 'the ball is well above the take-off height: ' + (byHit - top).toFixed(2));
    assert.ok(footH > 0.85, tag + 'the kicking foot is above the hips: ' + footH.toFixed(2));
    assert.ok(carry > 0.02, tag + 'the kicking leg carries on across the body: ' + carry.toFixed(2));
    assert.equal(fell, false, tag + 'the player does not fall');
    assert.equal(first, 1 - kf, tag + 'lands on the other leg first');
    assert.ok(upAt > 0 && (upAt - landAt) / 120 < 0.7, tag + 'back in play within 0.7 s of landing');
    assert.equal(p.fall, null);
    assert.ok(!p.feet[0].ctl && !p.feet[1].ctl);
    void turned;
  }
  // the turn itself, without input after the kick
  const w0 = make('motor'), q = w0.player, b0 = w0.ball;
  for (let i = 0; i < 20; i++) w0.step(inp());
  b0.x = q.x + 0.5; b0.z = q.z + 0.3; b0.y = 2.3; b0.vx = b0.vy = b0.vz = 0;
  const y0 = q.yaw;
  for (let i = 0; i < 300; i++) w0.step(inp({ kickHeld: i < 60, kickPressed: i === 0, jumpPressed: i === 0 }));
  const d = Math.atan2(Math.sin(q.yaw - y0), Math.cos(q.yaw - y0));
  assert.ok(Math.abs(d) > 2.6, 'the body ends turned almost fully around: ' + d.toFixed(2));
  // a ball at hip height is still an ordinary volley, without the flight
  const w = make('motor'), p = w.player, b = w.ball;
  for (let i = 0; i < 20; i++) w.step(inp());
  b.x = p.x + 0.6; b.z = p.z + 0.2; b.y = 1.1; b.vx = b.vy = b.vz = 0;
  let kick = null;
  for (let i = 0; i < 200; i++) { w.step(inp({ kickHeld: i < 30, kickPressed: i === 0 })); for (const e of w.events) if (e.type === 'kick') kick = e; assert.equal(p.fall, null); }
  assert.ok(kick && !kick.fly);
});

test('flying side volley: arrows do nothing until touchdown, the player does not fly on after the kick, control is back on landing', () => {
  const run = (mx, mz) => {
    const w = make('motor'), p = w.player, b = w.ball;
    for (let i = 0; i < 20; i++) w.step(inp());
    b.x = p.x + 0.5; b.z = p.z + 0.3; b.y = 2.3; b.vx = b.vy = b.vz = 0;
    const r = { hit: null, land: null, landAt: -1, freeAt: -1, spunAt: -1, hitAt: -1, yawHit: 0 };
    for (let i = 0; i < 260; i++) {
      w.step(inp({ kickHeld: i < 60, kickPressed: i === 0, jumpPressed: i === 0, mx, mz }));
      for (const e of w.events) if (e.type === 'kick') { r.hit = [p.x, p.z]; r.hitAt = i; r.yawHit = p.yaw; }
      const fl = p.fall;
      if (r.hitAt >= 0 && r.spunAt < 0 && Math.abs(Math.atan2(Math.sin(p.yaw - r.yawHit), Math.cos(p.yaw - r.yawHit))) > 2.6) r.spunAt = i;
      if (fl && fl.phase === 'land' && !r.land) { r.land = [p.x, p.z]; r.landAt = i; }
      if (r.land && !fl && r.freeAt < 0) r.freeAt = i;
    }
    return r;
  };
  const idle = run(0, 0), fwd = run(1, 0), side = run(0, 1);
  for (const r of [fwd, side]) {
    assert.deepEqual(r.hit, idle.hit, 'arrows do not move the player before the kick (they only aim)');
    assert.deepEqual(r.land, idle.land, 'arrows do not move the player in flight');
    assert.ok(r.freeAt - r.landAt <= 2, 'with a command held, control is back right on touchdown: ' + (r.freeAt - r.landAt));
  }
  assert.ok(Math.hypot(idle.land[0] - idle.hit[0], idle.land[1] - idle.hit[1]) < 0.3, 'after the kick the player comes down almost in place');
  assert.ok((idle.spunAt - idle.hitAt) / 120 < 0.4, 'the turn is done within 0.4 s of the kick: ' + ((idle.spunAt - idle.hitAt) / 120).toFixed(2));
  assert.ok(idle.spunAt < idle.landAt, 'and before touchdown');
  assert.ok((idle.freeAt - idle.landAt) / 120 > 0.3 && (idle.freeAt - idle.landAt) / 120 < 0.45, 'without a command the short landing stance plays out');
});

test('lob with the ball in the air: a ball bouncing or dropping by the player is his ball - A lobs it on the volley, no slide', () => {
  const cases = [
    ['bouncing beside', (p, b) => { b.x = p.x + 0.5; b.z = p.z; b.y = 0.8; b.vx = b.vz = 0; b.vy = 1; }],
    ['dropping from 1.6 m', (p, b) => { b.x = p.x + 0.4; b.z = p.z + 0.1; b.y = 1.6; b.vx = b.vy = b.vz = 0; }],
    ['high above', (p, b) => { b.x = p.x + 0.4; b.z = p.z + 0.2; b.y = 2.4; b.vx = b.vy = b.vz = 0; }],
    ['lofted pass arriving', (p, b) => { b.x = p.x + 2.5; b.z = p.z; b.y = 1.0; b.vx = -3.5; b.vy = 2.5; b.vz = 0; }],
  ];
  for (const [name, setup] of cases) {
    const w = make('motor'), p = w.player, b = w.ball;
    for (let i = 0; i < 20; i++) w.step(inp());
    setup(p, b);
    let kick = null, slid = false, apex = 0, x0 = 0;
    for (let i = 0; i < 360; i++) {
      w.step(inp({ lobPressed: i === 0, lobHeld: i < 30 }));
      if (p.slide) slid = true;
      for (const e of w.events) if (e.type === 'kick') { kick = e; x0 = b.x; }
      if (kick) apex = Math.max(apex, b.y);
    }
    assert.equal(slid, false, name + ': no slide tackle');
    assert.ok(kick && kick.kind === 'lob' && kick.volley, name + ': lob on the volley');
    assert.ok(!kick.fly && !kick.bike && p.fall === null, name + ': a lob is not a flying kick');
    assert.ok(apex > 2.5 && b.x > x0 + 2, name + `: the ball goes up and forward (apex ${apex.toFixed(1)})`);
  }
  // a low ball two metres away is still a tackle
  const w = make('motor'), p = w.player, b = w.ball;
  for (let i = 0; i < 20; i++) w.step(inp());
  b.x = p.x + 2; b.z = p.z; b.y = 0.5; b.vx = b.vy = b.vz = 0;
  w.step(inp({ lobPressed: true }));
  assert.ok(p.slide && !p.kick);
});

test('high-ball kicks need the player\'s own jump: kick alone waits for the ball, kick + jump or a kick from a jump goes for it; the switch restores the old rule', () => {
  const run = ({ jumpAt = -1, kickAt = 0, legacy = false, back = false, h = 2.3 }) => {
    const w = make('motor'), p = w.player, b = w.ball;
    if (legacy) w.P.kick.jumpKicks = false;
    if (back) { for (let i = 0; i < 90; i++) w.step(inp({ mx: -1 })); for (let i = 0; i < 60; i++) w.step(inp()); }
    else for (let i = 0; i < 20; i++) w.step(inp());
    b.x = p.x + (back ? 0 : 0.5); b.z = p.z + (back ? 0.05 : 0.3); b.y = h; b.vx = b.vy = b.vz = 0;
    const r = { kick: null, top: 0, byHit: 0, armed: false };
    for (let i = 0; i < 300; i++) {
      w.step(inp({ kickHeld: i >= kickAt && i < kickAt + 70, kickPressed: i === kickAt, jumpPressed: i === jumpAt }));
      r.top = Math.max(r.top, p.y);
      for (const e of w.events) { if (e.type === 'kick' && !r.kick) { r.kick = e; r.byHit = b.y; } if (e.type === 'kick_armed') r.armed = true; }
    }
    return r;
  };
  // kick alone: no flight, no jump - the ball is met when it has come down
  const plain = run({});
  assert.ok(plain.kick && !plain.kick.fly && !plain.kick.bike && !plain.kick.jump, 'kick without a jump stays on the ground');
  assert.equal(plain.top, 0, 'no take-off');
  assert.ok(plain.byHit < 1.0, 'the ball is struck low: ' + plain.byHit.toFixed(2));
  // kick held, then jump: the flying side volley, the take-off is timed by the game
  const armed = run({ jumpAt: 6 });
  assert.ok(armed.armed && armed.kick && armed.kick.fly, 'kick + jump: flying side volley');
  // already in a jump, then kick: the same kick out of that jump
  const fromJump = run({ jumpAt: 0, kickAt: 8, h: 2.5 });
  assert.ok(fromJump.kick && (fromJump.kick.fly || fromJump.kick.jump), 'jump first, then kick: a kick in the air');
  assert.ok(fromJump.byHit > 1.2, 'the ball is met high: ' + fromJump.byHit.toFixed(2));
  // back to goal: the bicycle kick needs the jump as well
  assert.ok(!run({ back: true, h: 2.6 }).kick?.bike, 'no bicycle kick without a jump');
  assert.ok(run({ back: true, h: 2.6, jumpAt: 4 }).kick?.bike, 'bicycle kick with kick + jump');
  // the switch: old conditions, one button is enough
  const old = run({ legacy: true });
  assert.ok(old.kick && old.kick.fly, 'jumpKicks off: the flying side volley on the kick button alone');
  assert.ok(run({ legacy: true, back: true, h: 2.6 }).kick?.bike, 'jumpKicks off: the bicycle kick on the kick button alone');
});

test('guard stance and foot receive together (one key): the stance holds, a ball going past is reached, a ball at the body is taken', () => {
  const run = (dx, dz, vx, vy, y) => {
    const w = make('motor'), p = w.player, b = w.ball;
    for (let i = 0; i < 30; i++) w.step(inp({ guardHeld: true, superHeld: true }));
    assert.ok(p.guard, 'stance is on');
    b.x = p.x + dx; b.z = p.z + dz; b.y = y; b.vx = vx; b.vy = vy; b.vz = 0;
    let rec = null, stance = 0;
    for (let i = 0; i < 240; i++) {
      w.step(inp({ guardHeld: true, superHeld: true }));
      if (p.guard) stance++;
      for (const e of w.events) if (e.type === 'receive' && !rec) rec = e;
    }
    return { rec, stance, d: Math.hypot(b.x - p.x, b.z - p.z) };
  };
  const wide = run(5, 0.8, -11, 0, 0.11), body = run(6, 0, -14, 0, 0.11), chest = run(6, 0.1, -10, 2.5, 0.9);
  assert.ok(wide.rec && wide.rec.reach && wide.d < 1.2, 'a ball 0.8 m to the side is reached with the foot: ' + wide.d.toFixed(2));
  assert.ok(wide.stance > 20, 'the stance was held until the ball was won');
  assert.ok(body.rec && body.d < 1.2, 'a ball at the body is taken');
  assert.ok(chest.rec && chest.d < 1.2, 'a ball at the chest is taken');
});

test('juggling: A tosses the ball up and a little forward for yourself; kick + jump then strikes it in flight', () => {
  const run = (after) => {
    const w = make('free'), p = w.player, b = w.ball;
    const r = { tossAt: -1, apex: 0, fwd: 0, kick: null, slid: false, juggleAfter: false, n: 0 };
    let x0 = 0, landed = false;
    for (let i = 0; i < 700; i++) {
      const s = r.tossAt < 0 ? -99 : i - r.tossAt;
      w.step(inp({ jumpPressed: i === 10 || (after === 'fly' && s === 40), lobPressed: i === 200 || (after === 'lob' && s === 60),
        lobHeld: after === 'lob' && s >= 60 && s < 80, kickPressed: after === 'fly' && s === 30, kickHeld: after === 'fly' && s >= 30 && s < 120 }));
      for (const e of w.events) {
        if (e.type === 'touch' && e.kind === 'juggle' && r.tossAt < 0) r.n++;
        if (e.type === 'touch' && e.kind === 'toss') { r.tossAt = i; x0 = b.x; }
        if (e.type === 'kick' && !r.kick) r.kick = e;
        if (r.tossAt >= 0 && e.type === 'bounce' && !landed) { landed = true; r.fwd = b.x - x0; }
      }
      if (r.tossAt >= 0) { r.apex = Math.max(r.apex, b.y); if (p.juggle) r.juggleAfter = true; if (p.slide) r.slid = true; }
    }
    return r;
  };
  const idle = run('none');
  assert.ok(idle.n >= 2 && idle.tossAt > 200, 'the series runs, the toss comes with the next touch');
  assert.ok(idle.apex > 2.0 && idle.apex < 2.8, 'the ball goes well above the head: ' + idle.apex.toFixed(2));
  assert.ok(idle.fwd > 0.8 && idle.fwd < 2.6, 'and comes down a little ahead: ' + idle.fwd.toFixed(2));
  assert.equal(idle.juggleAfter, false, 'the series ends with the toss');
  const fly = run('fly');
  assert.ok(fly.kick && fly.kick.fly && fly.kick.volley, 'kick held + jump after the toss: flying side volley');
  const lob = run('lob');
  assert.ok(lob.kick && lob.kick.kind === 'lob' && !lob.slid, 'A again after the toss: a lob on the volley, not a slide');
});

test('vertical aim: holding towards the goal lifts the shot, away from the goal keeps it low - for both sides', () => {
  const shot = (mx) => {
    const w = make('free'), b = w.ball;
    let vy = null, aim = null;
    for (let i = 0; i < 240 && vy === null; i++) {
      w.step(inp({ kickPressed: i === 0, kickHeld: i < 40, mx }));
      for (const e of w.events) if (e.type === 'kick') { vy = b.vy; aim = e.aimHigh; }
    }
    return { vy, aim };
  };
  const to = shot(1), away = shot(-1), flat = shot(0); // player 0 attacks towards +x
  assert.ok(to.aim > 0.5 && away.aim < -0.5, `aim: towards ${to.aim.toFixed(2)}, away ${away.aim.toFixed(2)}`);
  assert.ok(to.vy > flat.vy + 1 && flat.vy > away.vy, `ball rise: towards ${to.vy.toFixed(1)}, neutral ${flat.vy.toFixed(1)}, away ${away.vy.toFixed(1)}`);
  // the player on the right attacks towards -x: for him 'towards the goal' is the other way on the screen
  const w = new World(createProfile(), { seed: 3, duel: true });
  w._kickoff(1, true);
  let aim = null;
  for (let i = 0; i < 300 && aim === null; i++) {
    w.step(inp(), inp({ kickPressed: i === 0, kickHeld: i < 40, mx: -1 }));
    for (const e of w.events) if (e.type === 'kick') aim = e.aimHigh;
  }
  assert.ok(aim > 0.5, 'right-side player holding towards his target goal aims high: ' + aim);
});

test('ball at chest or head height: one touch with the body, the ball comes off in front (or to the side if directed) and drops to the feet', () => {
  const feed = (kind, mode) => {
    const hold = mode === 'guard' || mode === 'side' ? { guardHeld: true, superHeld: true } : {};
    // in the stance the head is lower (1.58 m against 1.82 m standing): the head-high ball is fed lower too
    const [dx, y0, sp, hT] = { chest: [6, 0.8, 11, 1.3], head: [6, 1.0, 10, hold.guardHeld ? 1.5 : 1.75], over: [6, 1.0, 10, 1.75], drop: [0.05, 3.2, 0, 0], hard: [7, 0.9, 17, 1.3] }[kind];
    const w = make('motor'), p = w.player, b = w.ball, P = w.P;
    for (let i = 0; i < 40; i++) w.step(inp(hold));
    b.x = p.x + dx + (kind === 'drop' ? P.guard.lean * p.crouch : 0); b.z = p.z; b.y = y0; b.vz = 0; // the drop lands on the head, and in the stance the head is forward of the hips
    if (sp > 0) { const t = dx / sp; b.vx = -sp * 1.05; b.vy = (hT - y0 + 4.905 * t * t) / t; } else { b.vx = 0; b.vy = 0; }
    const r = { body: 0, onTop: 0, inside: 0, first: -1, down: null, z0: p.z, landZ: null, landX: null, apexAfter: 0 };
    for (let i = 0; i < 360; i++) {
      const near = Math.hypot(b.x - p.x, b.z - p.z) < 1.5;
      w.step(inp({ ...hold, mz: mode === 'side' && near && r.down === null ? -1 : 0 }));
      for (const e of w.events) if ((e.type === 'receive' && e.zone !== 'foot') || e.type === 'body') { r.body++; if (r.first < 0) { r.first = i; r.zone = e.zone; } }
      if (r.first >= 0) {
        const d = Math.hypot(b.x - p.x, b.z - p.z);
        if (d < P.player.radius - 0.02 && b.y > 0.3 && b.y < P.player.height) r.inside++;
        if (b.y >= P.player.height - 0.05 && d < 0.2 && Math.hypot(b.vx, b.vz) < 0.6) r.onTop++;
        if (r.down === null && b.y < 0.4) { r.down = (i - r.first) / 120; r.landZ = b.z - r.z0; r.landX = b.x - p.x; }
      }
    }
    return r;
  };
  for (const kind of ['chest', 'head', 'drop', 'hard']) for (const mode of ['none', 'guard']) {
    const r = feed(kind, mode), tag = `${kind}/${mode}: `;
    assert.equal(r.body, 1, tag + 'one touch with the body, not a series');
    assert.equal(r.inside, 0, tag + 'the ball never sits inside the body');
    assert.ok(r.onTop < 6, tag + 'the ball does not rest on the head: ' + r.onTop);
    assert.ok(r.down !== null && r.down < 1.0, tag + 'it is down at the feet within a second: ' + r.down);
    assert.ok(r.landX > 0.3 && r.landX < 3.2, tag + 'and in front of the player: ' + r.landX.toFixed(2));
  }
  // the body collider follows the model: a ball at standing head height hits the standing player and passes over the crouched one
  assert.equal(feed('head', 'none').zone, 'head', 'standing: taken on the head');
  assert.equal(feed('head', 'guard').zone, 'head', 'stance: a lower ball is taken on the head');
  assert.equal(feed('over', 'none').body, 1, 'ball at 1.75 m meets the standing head');
  assert.equal(feed('over', 'guard').body, 0, 'the same ball flies over the head of the player in the stance');
  const soft = feed('hard', 'guard'), rough = feed('hard', 'none');
  assert.ok(rough.landX > soft.landX + 0.5, `without the stance the bounce is rougher: ${rough.landX.toFixed(2)} vs ${soft.landX.toFixed(2)}`);
  const side = feed('chest', 'side'), fwd = feed('chest', 'guard');
  assert.ok(side.landZ < -0.35 && Math.abs(fwd.landZ) < 0.15, `held direction sends the ball that way: ${side.landZ.toFixed(2)} vs ${fwd.landZ.toFixed(2)}`);
});

test('jump: a short crouch before the push-off, legs tucked at the top and reaching for the turf before landing', () => {
  const w = make('motor'), p = w.player, b = w.ball, P = w.P;
  b.x = p.x + 9; b.z = p.z + 6;
  for (let i = 0; i < 30; i++) w.step(inp({}));
  let off = -1, top = 0, tuckTop = 0, relLand = null, land = -1;
  for (let i = 0; i < 160 && land < 0; i++) {
    w.step(inp({ jumpPressed: i === 0 }));
    if (p.y > 0 && off < 0) off = i;
    if (p.y > top) { top = p.y; tuckTop = Math.max(p.feet[0].h, p.feet[1].h) - p.y; }
    if (off >= 0 && p.y > 0) relLand = Math.max(p.feet[0].h, p.feet[1].h) - p.y;
    if (off >= 0 && p.y <= 0) land = i;
  }
  assert.ok(off >= 6 && off <= 12, 'the player leaves the turf after the crouch, tick ' + off);
  assert.ok(top > 0.6, 'jump height is unchanged: ' + top.toFixed(2));
  assert.ok(tuckTop > 0.12, 'legs are tucked at the top: ' + tuckTop.toFixed(2));
  assert.ok(relLand < 0.06, 'feet are down under the body before landing: ' + relLand.toFixed(2));
  assert.ok(p.feet[0].planted && p.feet[1].planted && p.feet[0].h === 0, 'both feet planted on landing');
});

test('kick held while the ball flies past: the player does not chase it backwards', () => {
  for (const [lat, speed] of [[2.5, 12], [1.5, 18], [1.8, 12], [1.0, 9]]) {
    const w = make('motor'), p = w.player, b = w.ball, dir = -p.side;
    for (let i = 0; i < 40; i++) w.step(inp({}));
    b.x = p.x + dir * 7; b.z = p.z + lat; b.y = 0.4; b.vx = -dir * speed; b.vz = 0; b.vy = 1.2;
    let back = 0, backM = 0, v = 0;
    for (let i = 0; i < 220; i++) {
      w.step(inp({ kickHeld: i < 180, kickPressed: i === 0 }));
      const bs = -(p.vx * Math.cos(p.yaw) + p.vz * Math.sin(p.yaw));
      back = Math.max(back, bs); if (bs > 0.3) backM += bs / 120; v = Math.max(v, Math.hypot(p.vx, p.vz));
    }
    const tag = `ball ${lat} m aside at ${speed} m/s: `;
    assert.ok(back < w.P.kick.strikeBack + 0.8, tag + 'backwards no faster than a back-step: ' + back.toFixed(2));
    assert.ok(backM < 2.2, tag + 'and not far: ' + backM.toFixed(2));
    assert.ok(v <= w.P.kick.strikeSpeed + 0.2, tag + 'speed ' + v.toFixed(2));
  }
});

test('kick held, ball out of reach: one short step towards it to show the intent, then the player stops', () => {
  const w = make('motor'), p = w.player, b = w.ball, dir = -p.side;
  for (let i = 0; i < 40; i++) w.step(inp({}));
  b.x = p.x + dir * 7; b.z = p.z + 2.5; b.y = 0.4; b.vx = -dir * 12; b.vz = 0; b.vy = 1.2;
  const x0 = p.x, z0 = p.z; let far = 0, kicked = false;
  for (let i = 0; i < 240; i++) {
    w.step(inp({ kickHeld: i < 200, kickPressed: i === 0 }));
    for (const e of w.events) if (e.type === 'kick') kicked = true;
    far = Math.max(far, Math.hypot(p.x - x0, p.z - z0));
  }
  assert.ok(!kicked, 'the ball is not reached');
  assert.ok(far > 0.35 && far < 1.0, 'a step towards the ball, not a chase: ' + far.toFixed(2));
  assert.ok(p.z - z0 > 0.2, 'the step goes to the side the ball passed on');
  assert.ok(Math.hypot(p.vx, p.vz) < 0.3, 'and the player has stopped');
});

test('kick held with no ball in the strike zone: the arrows move the player, and he strikes once he is brought to the ball', () => {
  const w = make('motor'), p = w.player, b = w.ball, dir = -p.side;
  for (let i = 0; i < 30; i++) w.step(inp({}));
  b.x = p.x + dir * 2; b.z = p.z + 7; b.y = w.P.ball.radius; b.vx = b.vy = b.vz = 0; // lying ball, 7 m to the side
  const z0 = p.z; let kicked = false, ended = false, vTop = 0, aimTop = 0, freeTicks = 0;
  for (let i = 0; i < 700 && !kicked; i++) {
    const near = Math.hypot(b.x - p.x, b.z - p.z) < 2.6;
    w.step(inp({ kickHeld: true, kickPressed: i === 0, mz: near ? 0 : 1 }));
    for (const e of w.events) { if (e.type === 'kick') kicked = true; if (e.type === 'kick_empty' || e.type === 'kick_cancel') ended = true; }
    if (p.kick && p.kick.free) { freeTicks++; vTop = Math.max(vTop, Math.hypot(p.vx, p.vz)); aimTop = Math.max(aimTop, Math.abs(p.kick.aimLat)); }
  }
  assert.ok(!ended, 'the held kick is not cancelled while the player is being led to the ball');
  assert.ok(freeTicks > 60 && vTop > w.P.player.runSpeed * 0.9, 'he runs where the arrows say: ' + vTop.toFixed(2));
  assert.ok(aimTop < 0.2, 'the arrows do not turn the aim meanwhile: ' + aimTop.toFixed(2));
  assert.ok(p.z - z0 > 4, 'he has come to the ball');
  assert.ok(kicked, 'and strikes it');
  // released far from the ball: the kick ends as before
  const w2 = make('motor'), q = w2.player; let empty = false;
  w2.ball.x = q.x + 2; w2.ball.z = q.z + 7;
  for (let i = 0; i < 200; i++) { w2.step(inp({ kickHeld: i < 60, kickPressed: i === 0, mz: i < 60 ? -1 : 0 })); for (const e of w2.events) if (e.type === 'kick_empty') empty = true; }
  assert.ok(empty && !q.kick, 'released away from the ball: an empty kick');
});

test('выпад: мяч, проходящий навстречу в длину ноги, бьётся вынесенной ногой — слабее; за спиной и выше пояса — нет', () => {
  // ux, uz — откуда летит мяч относительно взгляда на чужие ворота; off — на сколько мимо корпуса; lead — за сколько до сближения нажат удар
  const run = (ux, uz, h, off, lead, v = 7) => {
    const w = make('free'), b = w.ball, p = w.player;
    for (let i = 0; i < 20; i++) w.step(inp());
    const att = -p.side, cx = p.x - uz * off * att, cz = p.z + ux * off, d0 = v * lead * 1.03, g = 9.81, vy0 = -2 + g * lead;
    Object.assign(b, { x: cx - ux * att * d0, y: h - vy0 * lead + 0.5 * g * lead * lead, z: cz - uz * d0, vx: ux * att * v, vy: vy0, vz: uz * v, wx: 0, wy: 0, wz: 0, rolling: false });
    let kick = null, miss = false, x0 = p.x, z0 = p.z, moved = 0;
    for (let i = 0; i < 120 && !kick; i++) {
      w.step(inp({ kickPressed: i === 0, kickHeld: i < 40 }));
      moved = Math.max(moved, Math.hypot(p.x - x0, p.z - z0));
      for (const e of w.events) { if (e.type === 'kick') kick = e; if (e.type === 'kick_miss') miss = true; }
    }
    return { kick, miss, moved };
  };
  // навстречу, на уровне колена, в 0,8 м сбоку, удар нажат за 0,25 с: раньше — пустой замах
  for (const off of [0.55, 0.8, 1.05]) {
    const r = run(-1, 0, 0.6, off, 0.25);
    assert.ok(r.kick && !r.miss, 'встречный мяч в ' + off + ' м достаётся');
    assert.ok(r.moved < 0.75, 'не дальше шага: ' + r.moved.toFixed(2));
  }
  const s = run(-1, 0, 0.6, 1.05, 0.25);
  assert.ok(s.kick.stretch && s.kick.speed < createProfile().kick.maxSpeed * 0.85, 'выпад слабее полного удара: ' + s.kick.speed.toFixed(1));
  // на уровне пояса навстречу: удар с лёта без прыжка
  assert.ok(run(-1, 0, 0.9, 0.8, 0.3).kick, 'мяч на уровне пояса бьётся с места');
  // на уровне груди навстречу без прыжка — не удар ногой
  assert.ok(!run(-1, 0, 1.4, 1.05, 0.25).kick, 'мяч на уровне груди без прыжка не бьётся');
  // далеко сбоку — не дотянуться даже выпадом
  assert.ok(!run(-1, 0, 0.6, 1.9, 0.25).kick, 'мяч в 1,9 м — мимо');
  // ни в одном случае — замах без контакта
  for (const off of [0.3, 0.55, 0.8, 1.05, 1.3]) for (const lead of [0.18, 0.25, 0.35]) assert.ok(!run(-0.707, -0.707, 0.6, off, lead).miss && !run(-1, 0, 0.9, off, lead).miss, `без пустых замахов: ${off} м, ${lead} с`);
});
