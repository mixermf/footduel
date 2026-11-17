// Проверка на чтение прицела: два одинаковых мира, отличаются только направлением удара соперника (стик влево/вправо
// при зажатом ударе). Если бот как-то узнаёт прицел до удара, его ввод в двух мирах разойдётся раньше, чем мяч.
//   node scripts/bot-twin.mjs [уровень] ['{"param":value}']
import { World, emptyInput } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';
import { Bot, BOT_LEVELS } from '../src/ai/bot.js';
const lv = process.argv[2] || 'hard', opts = JSON.parse(process.argv[3] || '{}');
// различие в вводе — заметное (стик на 0,05 и больше или другая кнопка), а не шум последних знаков после запятой
const same = (a, b) => ['mx', 'mz'].every((k) => Math.abs(a[k] - b[k]) < 0.05) && ['guardHeld', 'jumpPressed', 'kickPressed', 'sprintHeld'].every((k) => a[k] === b[k]);
const rows = [];
for (let s = 0; s < 30; s++) {
  const mk = () => { const w = new World(createProfile(), { seed: 7000 + s, duel: true }); w.recording = false; w.reset('duel'); return { w, A: new Bot(0, { ...BOT_LEVELS[lv], ...opts }, s + 3), t: -1 }; };
  const W = [mk(), mk()], aims = [0.9, -0.9];
  let press = -1, kick = -1, ballDiv = -1, botDiv = -1;
  for (let i = 0; i < 60 * 120 && botDiv < 0; i++) {
    const outs = W.map(({ w, A }) => ({ ...A.think(w) }));
    if (press >= 0 && !same(outs[0], outs[1])) { botDiv = i; }
    W.forEach((X, j) => {
      const p = X.w.players[1], o = emptyInput(); o.digital = false;
      if (X.t < 0 && p.possession && !p.kick && X.w.phase === 'play' && press < 0) { X.t = 0; if (j === 1) press = i; }
      if (X.t >= 0) { o.kickPressed = X.t === 0; o.kickHeld = X.t < 0.35; o.mz = aims[j]; X.t += X.w.dt; }
      X.w.step(outs[j], o);
      for (const e of X.w.events) if (e.type === 'kick' && e.pi === 1 && kick < 0) kick = i;
    });
    const a = W[0].w.ball, b = W[1].w.ball;
    if (ballDiv < 0 && Math.abs(a.z - b.z) + Math.abs(a.vz - b.vz) > 1e-9) ballDiv = i;
  }
  if (press >= 0 && kick >= 0) rows.push({ press, kick, ballDiv, botDiv });
}
const ms = (n) => (n * 1000 / 120).toFixed(0);
let before = 0; const d = [];
for (const r of rows) { if (r.botDiv >= 0 && r.botDiv < r.ballDiv) before++; if (r.botDiv >= 0) d.push(r.botDiv - r.kick); }
d.sort((a, b) => a - b);
console.log(`${lv} | удары ${rows.length} | бот разошёлся раньше мяча: ${before} | от удара до первого отличия в вводе бота, мс: мин ${ms(d[0])}, медиана ${ms(d[d.length >> 1])}, макс ${ms(d[d.length - 1])}`);
console.log('мяч расходится после нажатия через, мс:', rows.slice(0, 8).map((r) => ms(r.ballDiv - r.press)).join(' '), '| удар через, мс:', rows.slice(0, 8).map((r) => ms(r.kick - r.press)).join(' '));
