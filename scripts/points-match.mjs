// Матчи по очкам (3 минуты) бот против бота: итоговый счёт, разница, бонусы, штрафы за удержание, дополнительное время.
//   node scripts/points-match.mjs [матчей=20] [уровень A=hard] [уровень B=hard]
import { World } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';
import { Bot } from '../src/ai/bot.js';
const N = +(process.argv[2] || 20), la = process.argv[3] || 'hard', lb = process.argv[4] || 'hard';
const totals = [], diffs = [], bonus = {}; let ot = 0, draws = 0, pens = 0, wins = [0, 0], goals = 0, minutes = 0, maxGoal = 0;
for (let m = 0; m < N; m++) {
  const w = new World(createProfile(), { seed: 300 + m, duel: true }); w.recording = false; w.reset('duel');
  const A = new Bot(0, la, m * 5 + 1), B = new Bot(1, lb, m * 11 + 3);
  for (let i = 0; i < 400 * 120 && w.phase !== 'over'; i++) {
    w.step(A.think(w), B.think(w));
    for (const e of w.events) {
      if (e.type === 'goal') { goals++; maxGoal = Math.max(maxGoal, e.pts); for (const [k, v] of e.bonus) if (k !== 'goal') bonus[k] = (bonus[k] || 0) + 1; }
      if (e.type === 'hold_penalty') pens++;
      if (e.type === 'overtime') ot++;
    }
  }
  minutes += w.tick * w.dt / 60;
  totals.push(...w.points); diffs.push(Math.abs(w.points[0] - w.points[1]));
  if (w.winner < 0) draws++; else wins[w.winner]++;
}
totals.sort((a, b) => a - b); diffs.sort((a, b) => a - b);
const med = (a) => a[a.length >> 1];
console.log(`${la} vs ${lb}: матчей ${N}, победы ${wins[0]}:${wins[1]}, ничьих ${draws}, доп. время ${ot} | ${(minutes / N).toFixed(1)} мин/матч, голов ${(goals / N).toFixed(1)}/матч`);
console.log(`очки игрока: медиана ${med(totals)}, мин ${totals[0]}, макс ${totals[totals.length - 1]} | разница: медиана ${med(diffs)}, макс ${diffs[diffs.length - 1]} | самый дорогой гол ${maxGoal}`);
console.log(`штрафов за удержание ${pens} | бонусы:`, Object.entries(bonus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
