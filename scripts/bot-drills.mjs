// Упражнения для бота без графики: проверка отдельных умений на одинаковых подачах, с умением и без.
//   node scripts/bot-drills.mjs [уровень]      (по умолчанию hard)
// 1. «Высокий удар»: мяч летит в створ своих ворот и проходит линию бота на высоте 1,6–2,4 м — выше стойки.
//    Сравнивается доля пропущенных при jumpBlock 0 и как у уровня.
// 2. «Навес на свою половину»: мяч с чужой половины навесом падает на половину бота и отскакивает. Сравнивается время,
//    за которое бот берёт мяч под контроль или бьёт по нему, при predict false и как у уровня; «не взят» — за 4 с ни то ни другое.
// 3. «Отбить сразу»: мяч катится или летит к боту с чужой половины. Доля подач, после которых бот ударил по мячу
//    в касание (в том числе в прыжке), и доля ударов, ушедших в сторону чужих ворот.
import { World, emptyInput } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';
import { Bot, BOT_LEVELS } from '../src/ai/bot.js';

const lv = process.argv[2] || 'hard', base = BOT_LEVELS[lv];
const idle = emptyInput();

function setup(seed, opts) {
  const w = new World(createProfile(), { seed, duel: true }); w.recording = false; w.reset('duel');
  const bot = new Bot(0, { ...base, ...opts }, seed);
  return { w, bot };
}
// мяч у соперника не остаётся: его игрок стоит в углу своей половины
function park(w) { const q = w.players[1]; q.x = 8; q.z = 4.4; q.vx = q.vz = 0; w._placeFeet(q); }
function settle(w, bot, s) { for (let i = 0; i < s * 120; i++) { park(w); const b = w.ball; b.x = 6; b.z = 4.4; b.y = 0.11; b.vx = b.vy = b.vz = 0; w.step(bot.think(w), idle); } }
function launch(w, x, y, z, vx, vy, vz) { Object.assign(w.ball, { x, y, z, vx, vy, vz, wx: 0, wy: 0, wz: 0, inGoal: false }); }

// 1. высокий удар в створ
function highShots(opts) {
  let goals = 0, n = 0;
  for (let s = 0; s < 60; s++) {
    const { w, bot } = setup(100 + s, opts); settle(w, bot, 1.5);
    const p = w.players[0], tz = ((s % 7) - 3) * 0.25, h = 1.6 + (s % 5) * 0.2;
    // от x=3 до линии бота — прямой полёт со скоростью 16 м/с, высота на линии бота — h
    const x0 = 3, d = x0 - p.x, vx = -16, t = d / -vx, z0 = tz + 0.5 * ((s % 3) - 1);
    const vy = (h - 1.0 + 0.5 * 9.81 * t * t) / t;
    launch(w, x0, 1.0, z0, vx, vy, (tz - z0) / t + (p.z - tz) / t);
    n++;
    for (let i = 0; i < 180; i++) { park(w); w.step(bot.think(w), idle); if (w.events.some((e) => e.type === 'goal')) { goals++; break; } }
  }
  return `пропущено ${goals}/${n}`;
}

// 2. навес на свою половину
function lofts(opts) {
  let sum = 0, got = 0, miss = 0;
  for (let s = 0; s < 40; s++) {
    const { w, bot } = setup(300 + s, opts); settle(w, bot, 1.5);
    const tx = -2 - (s % 5) * 1.0, tz = ((s % 9) - 4) * 0.8, x0 = 2, t = 1.1;
    launch(w, x0, 0.5, tz * 0.5, (tx - x0) / t, 5.6, (tz - tz * 0.5) / t);
    let k = -1;
    for (let i = 0; i < 480 && k < 0; i++) { park(w); w.step(bot.think(w), idle); if (w.players[0].possession || w.events.some((e) => e.type === 'kick' && (e.pi ?? 0) === 0)) k = i; }
    if (k < 0) miss++; else { sum += k / 120; got++; }
  }
  return `взят или пробит в среднем за ${(sum / Math.max(1, got)).toFixed(2)} с, не взят ${miss}/40`;
}

// 3. отбить сразу
function returns(opts) {
  let ft = 0, fwd = 0, n = 0, jump = 0;
  for (let s = 0; s < 60; s++) {
    const { w, bot } = setup(500 + s, opts); settle(w, bot, 1.5);
    const p = w.players[0], high = s % 3 === 0;
    const x0 = 2.5, tz = p.z + ((s % 5) - 2) * 0.5, t = (x0 - p.x) / 11;
    launch(w, x0, high ? 0.6 : 0.11, tz + 0.6, -11, high ? (1.7 - 0.6 + 0.5 * 9.81 * t * t) / t : 0, -0.6 / t);
    n++;
    let kicked = false;
    for (let i = 0; i < 180 && !kicked; i++) {
      park(w); w.step(bot.think(w), idle);
      for (const e of w.events) if (e.type === 'kick' && (e.pi ?? 0) === 0 && e.firstTime) { kicked = true; ft++; if (e.jump) jump++; if (w.ball.vx > 0) fwd++; }
    }
  }
  return `ударил в касание ${ft}/${n} (в прыжке ${jump}), к чужим воротам ${fwd}/${ft}`;
}

console.log(`уровень ${lv}`);
console.log('1. высокий удар:   без прыжка —', highShots({ jumpBlock: 0 }), '| как у уровня —', highShots({}));
console.log('2. навес:          без прогноза —', lofts({ predict: false }), '| как у уровня —', lofts({}));
console.log('3. отбить сразу:   без этого —', returns({ strike: 0, firstTime: 0 }), '| как у уровня —', returns({}));
