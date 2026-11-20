// Очки дуэли: бонусы за гол, предел бонусов, штраф за удержание, часы матча и дополнительное время, сохранение состояния.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, emptyInput } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';

const duel = (seed = 5) => { const w = new World(createProfile(), { seed, duel: true }); w.recording = false; w.reset('duel'); return w; };
const shot = (pi, extra) => ({ pi, kind: 'shot', volley: false, jump: false, bike: false, fly: false, firstTime: false, juggle: false, dist: 9, speed: 20, post: 0, bar: 0, wall: 0, defl: false, ...extra });

test('очки за гол: база, бонусы складываются, из старших засчитывается один, предел бонусов', () => {
  const w = duel(), S = w.P.match.points;
  w.shot = shot(0); assert.equal(w._goalPoints(0).pts, S.goal);
  w.shot = shot(0, { post: 1 }); assert.equal(w._goalPoints(0).pts, S.goal + S.post);
  w.shot = shot(0, { post: 1, bar: 1 }); assert.equal(w._goalPoints(0).pts, S.goal + S.bar, 'штанга и перекладина — засчитывается перекладина');
  w.shot = shot(0, { volley: true, jump: true }); assert.equal(w._goalPoints(0).pts, S.goal + S.jump, 'в прыжке старше, чем с лёта');
  w.shot = shot(0, { bike: true, bar: 1, juggle: true, dist: 16, speed: 26 });
  assert.equal(w._goalPoints(0).pts, S.goal + S.cap, 'бонусы ограничены пределом');
  w.shot = shot(1); const own = w._goalPoints(0);
  assert.deepEqual(own.bonus, [['own', S.own]], 'гол без своего удара — без бонусов');
  w.shot = shot(0, { kind: 'super', speed: 30, dist: 16 }); assert.equal(w._goalPoints(0).pts, S.goal + S.super, 'суперудар без «пушки» и «издалека»');
});

test('гол в матче даёт очки и событие с разбором', () => {
  const w = duel(7), b = w.ball, F = w.P.field, idle = emptyInput();
  // мяч летит в правые ворота (их защищает игрок 1) после удара игрока 0 от штанги
  w.shot = shot(0, { post: 1 });
  Object.assign(b, { x: 7, y: 0.6, z: 0.3, vx: 20, vy: 0.5, vz: 0, wx: 0, wy: 0, wz: 0 });
  let g = null;
  for (let i = 0; i < 120 && !g; i++) { w.step(idle, idle); g = w.events.find((e) => e.type === 'goal'); }
  assert.ok(g, 'гол засчитан');
  assert.equal(g.by, 0);
  assert.equal(g.pts, w.P.match.points.goal + w.P.match.points.post);
  assert.equal(w.points[0], g.pts);
  assert.ok(g.bonus.some((x) => x[0] === 'post'));
  void F;
});

test('удержание: предупреждение, затем штраф каждую секунду; касание соперника сбрасывает', () => {
  const w = duel(2), H = w.P.match.hold, idle = emptyInput();
  const i = w.kickTo; // мяч введён этому игроку и лежит у его ног
  let warn = 0, pens = [];
  for (let t = 0; t < (H.grace + 2.05) * 120; t++) {
    w.step(idle, idle);
    for (const e of w.events) { if (e.type === 'hold_warn' && e.pi === i) warn++; if (e.type === 'hold_penalty' && e.pi === i) pens.push(e); }
  }
  assert.equal(warn, 1, 'одно предупреждение');
  assert.equal(pens.length, 3, 'штраф на 5, 6 и 7 секунде: ' + pens.length);
  assert.equal(w.points[i], -3 * H.perSec);
  // мяч забрал соперник: счётчик удержания у первого сбрасывается
  w.toucher = 1 - i;
  w.step(idle, idle);
  assert.equal(w.players[i].holdT, 0);
});

test('часы: конец матча по очкам, при равенстве — золотой гол, без голов — ничья', () => {
  const idle = emptyInput();
  // больше очков — победа, как только время вышло
  let w = duel(3); w.points[1] = 100; w.clock = 0.05; w.ball.vx = 0;
  for (let i = 0; i < 20 && w.phase !== 'over'; i++) { w.players[0].holdT = 0; w.step(idle, idle); }
  assert.equal(w.phase, 'over'); assert.equal(w.winner, 1);
  // равенство: дополнительное время, по его концу при равных голах — ничья
  w = duel(4); w.clock = 0.05; w.toucher = -1; w.shot = null;
  let ot = false;
  for (let i = 0; i < 20; i++) { w.toucher = -1; w.step(idle, idle); if (w.events.some((e) => e.type === 'overtime')) ot = true; }
  assert.ok(ot && w.overtime, 'началось дополнительное время');
  w.otT = w.P.match.overtime - 0.02;
  for (let i = 0; i < 10 && w.phase !== 'over'; i++) { w.toucher = -1; w.step(idle, idle); }
  assert.equal(w.phase, 'over'); assert.equal(w.winner, -1, 'ничья');
});

test('очки, часы и удар в полёте переживают сохранение состояния (сеть)', () => {
  const w = duel(9); w.points[0] = 250; w.points[1] = -50; w.clock = 77.5; w.shot = shot(1, { bar: 1 }); w.overtime = false;
  const s = JSON.parse(JSON.stringify(w.saveState()));
  const v = duel(1); v.loadState(s);
  assert.deepEqual(v.points, [250, -50]); assert.equal(v.clock, 77.5); assert.equal(v.shot.bar, 1);
  assert.equal(v.hash(), w.hash());
});

test('гол в девятку: база corner вместо goal, бонусы сверху с тем же пределом; зона — 1,5 диаметра мяча у угла', () => {
  const w = duel(), S = w.P.match.points, F = w.P.field, r = w.P.ball.radius;
  const zone = r + S.cornerZone * 2 * r, top = F.goalHeight - F.postRadius, side = F.goalWidth / 2 - F.postRadius;
  const line = (gapY, gapZ, sz = 1) => ({ type: 'goal_line', side: 1, y: top - gapY, z: sz * (side - gapZ) });
  w.shot = shot(0); assert.equal(w._goalPoints(0, line(r, r)).pts, S.corner, 'впритирку к углу');
  w.shot = shot(0); assert.equal(w._goalPoints(0, line(zone, zone, -1)).pts, S.corner, 'граница зоны, второй угол');
  w.shot = shot(0); assert.equal(w._goalPoints(0, line(zone + 0.01, r)).pts, S.goal, 'ниже зоны — обычный гол');
  w.shot = shot(0); assert.equal(w._goalPoints(0, line(r, zone + 0.01)).pts, S.goal, 'ближе к центру — обычный гол');
  w.shot = shot(0); assert.equal(w._goalPoints(0, null).pts, S.goal, 'без точки пересечения — обычный гол');
  w.shot = shot(0, { volley: true }); assert.equal(w._goalPoints(0, line(r, r)).pts, S.corner + S.volley);
  w.shot = shot(0, { bike: true, dist: 16, speed: 30, bar: 1 }); assert.equal(w._goalPoints(0, line(r, r)).pts, S.corner + S.cap, 'предел бонусов поверх девятки');
  w.shot = shot(1); assert.equal(w._goalPoints(0, line(r, r)).pts, S.own, 'автогол в девятку — только база автогола');
  assert.deepEqual(w._goalPoints(0, line(r, r)).bonus[0], ['own', S.own]);
  w.shot = shot(0); assert.deepEqual(w._goalPoints(0, line(r, r)).bonus[0], ['corner', S.corner]);
});
