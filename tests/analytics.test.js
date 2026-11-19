import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchTracker, classifyEnd } from '../src/analytics/matchTracker.js';

const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
function rig() {
  const sent = []; let t = 0;
  const tr = new MatchTracker((name, params) => sent.push({ name, ...params }), { now: () => t, storage: memStore() });
  return { tr, sent, at: (s) => { t = s * 1000; } };
}
const world = (o = {}) => ({ P: { match: { duration: 180, goalsToWin: 0 } }, clock: 0, overtime: false, otT: 0, points: [0, 0], goals: [0, 0], ...o });

test('классификация: очки, штрафы, золотой гол, голы после дополнительного времени, ничья', () => {
  assert.deepEqual(classifyEnd({ me: 0, winner: 1, points: [100, 300], goals: [1, 2], overtime: false }), { result: 'loss', reason: 'points' });
  assert.deepEqual(classifyEnd({ me: 0, winner: 0, points: [300, 100], goals: [2, 1], overtime: false }), { result: 'win', reason: 'points' });
  // без 250 очков штрафа проигравший был бы впереди
  assert.deepEqual(classifyEnd({ me: 0, winner: 1, points: [50, 200], goals: [2, 2], overtime: false, penalties: [250, 0] }), { result: 'loss', reason: 'hold_penalties' });
  // штраф был, но и без него проигрыш
  assert.deepEqual(classifyEnd({ me: 0, winner: 1, points: [50, 600], goals: [1, 4], overtime: false, penalties: [100, 0] }), { result: 'loss', reason: 'points' });
  assert.deepEqual(classifyEnd({ me: 0, winner: 1, points: [200, 300], goals: [2, 3], overtime: true, decider: 'goal' }), { result: 'loss', reason: 'golden_goal' });
  assert.deepEqual(classifyEnd({ me: 0, winner: 1, points: [150, 200], goals: [2, 2], overtime: true, decider: 'penalty' }), { result: 'loss', reason: 'golden_penalty' });
  assert.deepEqual(classifyEnd({ me: 1, winner: 0, points: [200, 200], goals: [3, 2], overtime: true }), { result: 'loss', reason: 'overtime_goals' });
  assert.deepEqual(classifyEnd({ me: 0, winner: -1, points: [200, 200], goals: [2, 2], overtime: true }), { result: 'draw', reason: 'overtime_draw' });
  assert.deepEqual(classifyEnd({ me: 0, winner: 0, points: [500, 0], goals: [3, 0], overtime: false, goalsToWin: 3 }), { result: 'win', reason: 'goals_to_win' });
});

test('трекер: начало, события, итог с длительностью и номером матча', () => {
  const { tr, sent, at } = rig();
  at(10); tr.start({ mode: 'bot', botLevel: 'hard', me: 0 });
  tr.onEvent({ type: 'goal', by: 1, pts: 200 });
  tr.onEvent({ type: 'goal', by: 0, pts: 100 });
  tr.onEvent({ type: 'hold_penalty', pi: 0, pts: -50 });
  at(200); tr.finish({ winner: 1, points: [50, 200], goals: [1, 1] }, world({ clock: 0 }));
  assert.equal(tr.active, false);
  assert.equal(sent[0].name, 'match_start');
  assert.equal(sent[0].bot_level, 'hard');
  const end = sent[1];
  assert.equal(end.name, 'match_end');
  assert.equal(end.result, 'loss'); assert.equal(end.reason, 'points');
  assert.equal(end.duration_sec, 190); assert.equal(end.play_sec, 180);
  assert.equal(end.points_me, 50); assert.equal(end.points_opp, 200); assert.equal(end.penalty_me, 50);
  assert.equal(end.match_number, 1);
  tr.finish({ winner: 0, points: [1, 0], goals: [0, 0] }); // повторный итог не уходит
  assert.equal(sent.length, 2);
});

test('трекер: перезапуск бросает прежний матч, номера растут, сетевой игрок справа', () => {
  const { tr, sent, at } = rig();
  at(0); tr.start({ mode: 'bot', botLevel: 'easy' });
  at(30); tr.start({ mode: 'bot', botLevel: 'easy' }, world({ clock: 150, points: [100, 0], goals: [1, 0] }));
  assert.equal(sent[1].name, 'match_end'); assert.equal(sent[1].result, 'abandoned'); assert.equal(sent[1].reason, 'restart');
  assert.equal(sent[1].play_sec, 30); assert.equal(sent[1].points_me, 100);
  assert.equal(sent[2].match_number, 2); assert.equal(sent[2].session_match, 2);
  tr.abort('quit_menu');
  tr.start({ mode: 'online', me: 1 });
  assert.equal(sent.at(-1).bot_level, undefined);
  tr.finish({ winner: 1, points: [100, 300], goals: [1, 2] }, world());
  const end = sent.at(-1);
  assert.equal(end.result, 'win'); assert.equal(end.points_me, 300); assert.equal(end.goals_opp, 1);
});

test('трекер: штраф выводится из итоговых очков, если события штрафа не дошли', () => {
  const { tr, sent } = rig();
  tr.start({ mode: 'online', me: 0 });
  tr.onEvent({ type: 'goal', by: 0, pts: 300 });
  tr.onEvent({ type: 'goal', by: 1, pts: 200 });
  tr.finish({ winner: 1, points: [100, 200], goals: [1, 1] }, world());
  assert.equal(sent.at(-1).penalty_me, 200);
  assert.equal(sent.at(-1).reason, 'hold_penalties');
});

test('трекер: золотой гол в дополнительное время', () => {
  const { tr, sent } = rig();
  tr.start({ mode: 'bot', botLevel: 'medium' });
  tr.onEvent({ type: 'overtime' });
  tr.onEvent({ type: 'goal', by: 1, pts: 100 });
  tr.finish({ winner: 1, points: [200, 300], goals: [2, 3] }, world({ overtime: true, otT: 12.4 }));
  const end = sent.at(-1);
  assert.equal(end.reason, 'golden_goal'); assert.equal(end.overtime, 1); assert.equal(end.play_sec, 192);
});
