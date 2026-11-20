// Компьютерный соперник: повторяемость, шкала сложности 0..100 и вероятности сложных решений
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';
import { Bot, BOT_PRESETS, botParams, botSkill, botTier } from '../src/ai/bot.js';

function match(a, b, seed, maxSec = 120, onEvent = null) {
  const w = new World(createProfile(), { seed, duel: true }); w.recording = false; w.reset('duel');
  const A = new Bot(0, a, seed * 3 + 1), B = new Bot(1, b, seed * 7 + 5);
  for (let i = 0; i < maxSec * 120 && w.phase !== 'over'; i++) { w.step(A.think(w), B.think(w)); if (onEvent) for (const e of w.events) onEvent(e); }
  return w;
}

test('бот: тот же seed — тот же матч', () => {
  const a = match('medium', 'hard', 11, 30), b = match('medium', 'hard', 11, 30);
  assert.equal(a.hash(), b.hash());
  const c = match(37, 73, 11, 30), d = match(37, 73, 11, 30);
  assert.equal(c.hash(), d.hash(), 'числовая сложность тоже повторяется');
});

test('бот: сложность — число 0..100; имена уровней — точки шкалы; старые имена читаются', () => {
  assert.equal(botSkill('easy'), BOT_PRESETS.easy);
  assert.equal(botSkill('hard'), BOT_PRESETS.hard);
  assert.equal(botSkill(150), 100); assert.equal(botSkill(-5), 0); assert.equal(botSkill('junk'), 50); assert.equal(botSkill('70'), 70);
  assert.deepEqual(new Bot(1, 'medium').L, botParams(50));
  assert.equal(new Bot(1, 63).skill, 63);
  assert.deepEqual(['easy', 'medium', 'hard', 'legend'], [10, 50, 80, 95].map(botTier));
});

test('бот: с ростом сложности ошибок меньше, а сложные решения случаются чаще; у среднего они уже есть', () => {
  const up = ['speed', 'sprint', 'corner', 'guard', 'lunge', 'firstTime', 'keep', 'predict', 'strike', 'jumpStrike', 'jumpBlock', 'lobCover', 'superShot', 'lob'];
  const down = ['latency', 'react', 'aimErr', 'hesitate', 'line', 'lobStill'];
  for (let s = 0; s < 100; s += 5) {
    const a = botParams(s), b = botParams(s + 5);
    for (const k of up) assert.ok(b[k] >= a[k], `${k} не убывает: ${s} → ${s + 5}`);
    for (const k of down) assert.ok(b[k] <= a[k], `${k} не растёт: ${s} → ${s + 5}`);
  }
  const mid = botParams(50);
  for (const k of ['predict', 'strike', 'jumpStrike', 'jumpBlock', 'lobCover', 'lob']) assert.ok(mid[k] > 0.05 && mid[k] < 0.6, `средний: ${k} = ${mid[k]}`);
  const god = botParams(100);
  assert.ok(god.predict === 1 && god.latency < botParams('hard').latency && god.aimErr < botParams('hard').aimErr, '100 сильнее сложного');
  // кубики бросаются на эпизод с заданной вероятностью
  const bot = new Bot(1, 50, 9); let n = 0, pr = 0;
  for (; n < 4000; n++) { bot._rollEpisode(); if (bot.ep.predict) pr++; }
  assert.ok(Math.abs(pr / n - mid.predict) < 0.03, 'частота predict ' + (pr / n).toFixed(3));
});

test('бот: сложные действия (с лёта, в прыжке, навес, суперудар, головой) — у лёгкого нет, у среднего иногда, у сложного часто', () => {
  const fancy = (skill) => {
    let n = 0;
    for (const seed of [21, 22, 23]) match(skill, 30, seed, 120, (e) => {
      if (e.pi === 0 && ((e.type === 'kick' && (e.volley || e.jump || e.kind !== 'shot')) || (e.type === 'header' && e.aimed))) n++;
    });
    return n;
  };
  const easy = fancy(20), mid = fancy(50), hard = fancy(80);
  assert.ok(easy === 0 && mid >= 2 && hard > mid * 3, `за три матча: лёгкий ${easy}, средний ${mid}, сложный ${hard}`);
});

test('бот: сильный обыгрывает слабого, слабый тоже бьёт по воротам', () => {
  let strong = 0, weak = 0, weakShots = 0;
  for (const seed of [21, 22]) {
    const w = match(85, 15, seed, 120, (e) => { if (e.type === 'kick' && e.pi === 1) weakShots++; });
    strong += w.goals[0]; weak += w.goals[1];
  }
  assert.ok(strong > weak * 2.5, `голы 85:15 — ${strong}:${weak}`);
  assert.ok(weakShots >= 5, 'слабый тоже бьёт по воротам: ' + weakShots);
});
