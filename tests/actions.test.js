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

test('навес: мяч уходит круто вверх, перелетает стоящего игрока и опускается на дальности по заряду', () => {
  const K = createProfile().kick;
  for (const hold of [0.1, 0.25]) {
    const w = make('free'), b = w.ball, p = w.player;
    let kick = null, apex = 0, land = null, over = null, x0 = 0, z0 = 0;
    for (let i = 0; i < 600 && !land; i++) {
      w.step(inp({ lobPressed: i === 0, lobHeld: i < hold * 120 }));
      for (const e of w.events) {
        if (e.type === 'kick') { kick = e; x0 = b.x; z0 = b.z; }
        if (kick && e.type === 'bounce') land = Math.hypot(b.x - x0, b.z - z0);
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
    assert.ok(apex > land * 0.3, 'дуга крутая: высота ' + apex.toFixed(2) + ' на дальности ' + land.toFixed(2));
    assert.equal(p.slide, null, 'с мячом та же кнопка подкат не включает');
  }
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
      w.step(inp({ kickHeld: i < 40, kickPressed: i === 0 || i === 150, mx: i > 60 ? 1 : 0, lobPressed: i === 160 }));
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
    assert.ok(r.upAt > 0 && (r.upAt - r.landAt) / 120 < 1.3, 'gets up in about a second');
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
  for (const [h, dx, dz, vx] of [[2.3, 0.5, 0.3, 0], [2.0, 0.6, -0.4, 0], [2.6, 2.5, 0.5, 5]]) {
    const w = make('motor'), p = w.player, b = w.ball;
    for (let i = 0; i < 20; i++) w.step(inp());
    b.x = p.x + dx; b.z = p.z + dz; b.y = h; b.vx = -vx; b.vy = b.vz = 0;
    const yaw0 = p.yaw;
    let kick = null, top = 0, side = 0, footH = 0, byHit = 0, hitAt = -1, landAt = -1, upAt = -1, first = -1, kf = -1, carry = 0, fell = false, kx = 0;
    for (let i = 0; i < 420; i++) {
      w.step(inp({ kickHeld: i < 60, kickPressed: i === 0, mx: i > 80 ? -1 : 0 }));
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
  for (let i = 0; i < 300; i++) w0.step(inp({ kickHeld: i < 60, kickPressed: i === 0 }));
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
      w.step(inp({ kickHeld: i < 60, kickPressed: i === 0, mx, mz }));
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
  assert.ok((idle.freeAt - idle.landAt) / 120 > 0.4, 'without a command the low landing stance plays out');
});
