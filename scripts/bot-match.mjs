// Матчи бот против бота без графики: проверка уровней сложности.
//   node scripts/bot-match.mjs                      — все пары уровней, по 10 матчей на пару (стороны меняются)
//   node scripts/bot-match.mjs hard easy 20         — одна пара, 20 матчей
// Уровни: easy, medium, hard; для сравнения — kicker (стоит и сразу бьёт, получив мяч) и idle (ничего не делает). Матч — до 7 голов или 4 минут.
// Сводка: победы и голы каждого; за минуту: удары, мимо мяча, отмены, подкаты; автоголы; доля времени, когда мяч стоит
// и к нему никто не идёт (бот «завис»).
import { World, emptyInput } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';
import { Bot } from '../src/ai/bot.js';

const LV = ['easy', 'medium', 'hard'];
const args = process.argv.slice(2);
const pairs = args[0] && args[1] ? [[args[0], args[1]]] : [['hard', 'easy'], ['hard', 'medium'], ['medium', 'easy'], ['easy', 'kicker'], ['medium', 'kicker'], ['hard', 'kicker'], ['easy', 'easy']];
const N = +(args[2] || 10), MAX = 4 * 60 * 120;

// kicker — стоит на месте и, получив мяч, сразу бьёт прямо средним ударом: мяч всегда возвращается в игру
function kicker(me) {
  let t = -1; const o = emptyInput();
  return { think(w) {
    Object.assign(o, emptyInput()); const p = w.players[me];
    if (t < 0 && p.possession && !p.kick && w.phase === 'play') t = 0;
    if (t >= 0) { o.kickPressed = t === 0; o.kickHeld = t < 0.25; t += w.dt; if (t > 0.6) t = -1; }
    return o;
  } };
}

function brain(kind, me, seed) {
  if (kind === 'idle') return { think: () => emptyInput() };
  if (kind === 'kicker') return kicker(me);
  return new Bot(me, kind, seed);
}

function match(a, b, seed) {
  const w = new World(createProfile(), { seed, duel: true }); w.recording = false;
  w.reset('duel');
  const A = brain(a, 0, seed * 3 + 1), B = brain(b, 1, seed * 7 + 5);
  const st = { kicks: [0, 0], miss: [0, 0], cancel: [0, 0], empty: [0, 0], slides: [0, 0], own: [0, 0], stuck: 0, ticks: 0 };
  let lastToucher = -1;
  for (let i = 0; i < MAX && w.phase !== 'over'; i++) {
    w.step(A.think(w), B.think(w));
    st.ticks++;
    for (const e of w.events) {
      const pi = e.pi ?? 0;
      if (e.type === 'kick') st.kicks[pi]++;
      if (e.type === 'kick_miss') st.miss[pi]++;
      if (e.type === 'kick_cancel') st.cancel[pi]++;
      if (e.type === 'kick_empty') st.empty[pi]++;
      if (e.type === 'slide') st.slides[pi]++;
      if (e.type === 'touch' || e.type === 'kick' || e.type === 'receive' || e.type === 'tackle') lastToucher = pi;
      if (e.type === 'goal' && e.by !== undefined && lastToucher >= 0 && lastToucher !== e.by) st.own[lastToucher]++;
    }
    const bs = Math.hypot(w.ball.vx, w.ball.vz), near = w.players.some((p) => Math.hypot(p.vx, p.vz) > 0.5 || Math.hypot(w.ball.x - p.x, w.ball.z - p.z) < 1);
    if (w.phase === 'play' && bs < 0.3 && !near) st.stuck++;
  }
  return { goals: w.goals.slice(), winner: w.winner, st };
}

const r1 = (x) => Math.round(x * 10) / 10;
for (const [a, b] of pairs) {
  let winA = 0, winB = 0, gA = 0, gB = 0, min = 0;
  const T = { kicks: [0, 0], miss: [0, 0], cancel: [0, 0], empty: [0, 0], slides: [0, 0], own: [0, 0], stuck: 0, ticks: 0 };
  for (let m = 0; m < N; m++) {
    const swap = m % 2 === 1, seed = 1000 + m * 17;
    const r = swap ? match(b, a, seed) : match(a, b, seed);
    const ia = swap ? 1 : 0, ib = 1 - ia;
    gA += r.goals[ia]; gB += r.goals[ib];
    if (r.winner === ia) winA++; else if (r.winner === ib) winB++;
    for (const k of ['kicks', 'miss', 'cancel', 'empty', 'slides', 'own']) { T[k][0] += r.st[k][ia]; T[k][1] += r.st[k][ib]; }
    T.stuck += r.st.stuck; T.ticks += r.st.ticks;
  }
  min = T.ticks / 120 / 60;
  const pm = (k) => `${r1(T[k][0] / min)}/${r1(T[k][1] / min)}`;
  console.log(`${a.padEnd(6)} vs ${b.padEnd(6)} | победы ${winA}:${winB} (ничьих по времени ${N - winA - winB}) | голы ${gA}:${gB} | за минуту: удары ${pm('kicks')}, мимо ${pm('miss')}, отмены ${pm('cancel')}, пусто ${pm('empty')}, подкаты ${pm('slides')} | автоголы ${T.own[0]}/${T.own[1]} | мяч брошен ${Math.round(100 * T.stuck / T.ticks)}% | ${r1(min / N)} мин/матч`);
}
