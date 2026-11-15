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
