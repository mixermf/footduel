// Какие голы и как часто забиваются в матчах ботов, и сколько игроки держат мяч: данные для баланса очков.
//   node scripts/goal-kinds.mjs [матчей=20]
import { World } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';
import { Bot } from '../src/ai/bot.js';
const N = +(process.argv[2] || 20), pairs = [['hard', 'hard'], ['hard', 'medium'], ['medium', 'medium'], ['easy', 'medium']];
const kinds = {}, holds = []; let goals = 0, minutes = 0;
const add = (k) => { kinds[k] = (kinds[k] || 0) + 1; };
for (const [a, b] of pairs) for (let m = 0; m < N; m++) {
  const w = new World(createProfile(), { seed: 900 + m, duel: true }); w.recording = false; w.reset('duel');
  const A = new Bot(0, a, m * 3 + 1), B = new Bot(1, b, m * 7 + 2);
  let shot = null; const hold = [0, 0];
  for (let i = 0; i < 180 * 120 && w.phase !== 'over'; i++) {
    w.step(A.think(w), B.think(w));
    for (let j = 0; j < 2; j++) { const p = w.players[j]; if (p.possession || p.juggle) hold[j] += w.dt; else { if (hold[j] > 0.3) holds.push(hold[j]); hold[j] = 0; } }
    for (const e of w.events) {
      if (e.type === 'kick') shot = { pi: e.pi, e, post: 0, bar: 0, defl: false, bounce: 0 };
      else if (shot && e.type === 'post') { if (w.ball.y > w.P.field.goalHeight - 0.25) shot.bar++; else shot.post++; }
      else if (shot && e.type === 'bounce') shot.bounce++;
      else if (shot && ['body', 'header', 'receive', 'touch'].includes(e.type) && e.pi !== undefined && e.pi !== shot.pi) shot.defl = true;
      if (e.type === 'goal') {
        goals++;
        if (!shot) { add('без удара'); continue; }
        const s = shot.e;
        if (e.by !== shot.pi) add('автогол/рикошет в свои');
        else {
          add('всего голов ударом');
          if (shot.defl) add('с рикошетом от соперника');
          if (shot.post) add('от штанги'); if (shot.bar) add('от перекладины');
          if (s.kind === 'super') add('суперудар'); if (s.kind === 'lob') add('навес');
          if (s.bike) add('через себя'); else if (s.fly) add('сбоку в полёте'); else if (s.jump) add('в прыжке');
          else if (s.volley) add('с лёта'); if (s.firstTime) add('в касание');
          if (shot.bounce === 0 && !s.volley) add('низом без отскока');
          if (s.speed > 24) add('сильный >24 м/с');
        }
        shot = null;
      }
    }
  }
  minutes += w.tick * w.dt / 60;
}
holds.sort((x, y) => x - y);
const q = (f) => holds[Math.floor(f * (holds.length - 1))].toFixed(1);
console.log(`матчей ${pairs.length * N}, минут ${minutes.toFixed(0)}, голов ${goals} (${(goals / minutes).toFixed(2)} в минуту)`);
for (const [k, v] of Object.entries(kinds).sort((x, y) => y[1] - x[1])) console.log(`  ${k}: ${v} (${(v / goals * 100).toFixed(1)}%)`);
console.log(`владение мячом подряд, с: медиана ${q(0.5)}, 90% ${q(0.9)}, 99% ${q(0.99)}, макс ${holds[holds.length - 1].toFixed(1)}; дольше 5 с: ${holds.filter((h) => h > 5).length} из ${holds.length}`);
