// Компьютерный соперник: повторяемость и порядок уровней сложности
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';
import { Bot } from '../src/ai/bot.js';

function match(a, b, seed, maxSec = 120) {
  const w = new World(createProfile(), { seed, duel: true }); w.recording = false; w.reset('duel');
  const A = new Bot(0, a, seed * 3 + 1), B = new Bot(1, b, seed * 7 + 5);
  for (let i = 0; i < maxSec * 120 && w.phase !== 'over'; i++) w.step(A.think(w), B.think(w));
  return w;
}

test('бот: тот же seed — тот же матч', () => {
  const a = match('medium', 'hard', 11, 30), b = match('medium', 'hard', 11, 30);
  assert.equal(a.hash(), b.hash());
});

test('бот: сложный обыгрывает лёгкого, оба бьют по воротам', () => {
  let hard = 0, easy = 0, easyShots = 0;
  for (const seed of [21, 22]) {
    const w = new World(createProfile(), { seed, duel: true }); w.recording = false; w.reset('duel');
    const A = new Bot(0, 'hard', seed * 3 + 1), B = new Bot(1, 'easy', seed * 7 + 5);
    for (let i = 0; i < 120 * 120 && w.phase !== 'over'; i++) { w.step(A.think(w), B.think(w)); for (const e of w.events) if (e.type === 'kick' && e.pi === 1) easyShots++; }
    hard += w.goals[0]; easy += w.goals[1];
  }
  assert.ok(hard > easy * 2, `голы сложный:лёгкий ${hard}:${easy}`);
  assert.ok(easyShots >= 5, 'лёгкий тоже бьёт по воротам: ' + easyShots);
});
