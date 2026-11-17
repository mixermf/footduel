// Сколько навесов через себя пропускает бот: соперник получает мяч, стоит и бьёт навесом (кнопка навеса с зарядом
// под расстояние до ворот, с разбросом, прицел в случайную сторону).   node scripts/bot-lobs.mjs hard ['{"param":value}']
import { World, emptyInput } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';
import { Bot, BOT_LEVELS } from '../src/ai/bot.js';
const lv = process.argv[2] || 'hard', opts = JSON.parse(process.argv[3] || '{}');
let lobs = 0, goals = 0, jumps = 0, touched = 0;
const TOUCH = new Set(['body', 'head', 'header', 'hit', 'kick', 'receive', 'touch', 'reach']); // касания мяча
for (let m = 0; m < 10; m++) {
  const w = new World(createProfile(), { seed: 5000 + m, duel: true }); w.recording = false; w.reset('duel');
  const A = new Bot(0, { ...BOT_LEVELS[lv], ...opts }, m + 11), K = w.P.kick, F = w.P.field;
  let t = -1, hold = 0, aim = 0, rng = m * 31 + 7, live = false;
  const rnd = () => ((rng = (rng * 1103515245 + 12345) >>> 0) / 4294967296);
  const lob = (p) => {
    const o = emptyInput(); o.digital = false;
    if (t < 0 && p.possession && !p.kick && w.phase === 'play') {
      t = 0; const gx = -(F.length / 2 - F.goalInset), d = Math.hypot(gx - w.ball.x, w.ball.z);
      hold = Math.min(1, Math.max(0, (d - 0.6 - K.lobMin) / (K.lobMax - K.lobMin) + (rnd() - 0.5) * 0.08)) * K.chargeTime;
      aim = (rnd() - 0.5) * 0.8;
    }
    if (t >= 0) { o.lobPressed = t === 0; o.lobHeld = t < hold; o.mz = aim; t += w.dt; if (t > hold + 0.6) t = -1; }
    return o;
  };
  for (let i = 0; i < 180 * 120 && w.phase !== 'over'; i++) {
    const o = A.think(w);
    if (live && o.jumpPressed) jumps++;
    w.step(o, lob(w.players[1]));
    for (const e of w.events) {
      if (e.type === 'kick' && e.pi === 1) { lobs++; live = true; }
      else if (live && e.pi === 0 && TOUCH.has(e.type)) { touched++; live = false; }
      if (e.type === 'goal') { if (e.by === 1 && lobs > 0) goals++; live = false; }
    }
  }
}
console.log(`${lv} ${JSON.stringify(opts)} | навесов ${lobs}, пропущено ${goals} (${(goals / lobs * 100).toFixed(0)}%), бот коснулся ${touched}, прыжков в полёте ${jumps}`);
