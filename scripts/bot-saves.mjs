// Сколько прямых ударов с места пропускает бот (соперник стоит и бьёт, получив мяч): node scripts/bot-saves.mjs hard ['{"keep":3}']
import { World, emptyInput } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';
import { Bot, BOT_LEVELS } from '../src/ai/bot.js';
const lv = process.argv[2] || 'hard', opts = JSON.parse(process.argv[3] || '{}');
let shots = 0, goals = 0;
for (let m = 0; m < 10; m++) {
  const w = new World(createProfile(), { seed: 2000 + m, duel: true }); w.recording = false; w.reset('duel');
  const A = new Bot(0, { ...BOT_LEVELS[lv], ...opts }, m + 1); let t = -1;
  const kick = (p) => { const o = emptyInput(); if (t < 0 && p.possession && !p.kick && w.phase === 'play') t = 0; if (t >= 0) { o.kickPressed = t === 0; o.kickHeld = t < 0.25; t += w.dt; if (t > 0.6) t = -1; } return o; };
  for (let i = 0; i < 180 * 120 && w.phase !== 'over'; i++) {
    w.step(A.think(w), kick(w.players[1]));
    for (const e of w.events) { if (e.type === 'kick' && e.pi === 1) shots++; if (e.type === 'goal' && e.by === 1) goals++; }
  }
}
console.log(lv, JSON.stringify(opts), 'shots', shots, 'conceded', goals, 'rate', (goals / shots).toFixed(2));
