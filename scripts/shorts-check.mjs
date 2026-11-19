// Проверка шортс-сцен без браузера: ключевые события каждой сцены и совпадение с ожиданием.
//   node scripts/shorts-check.mjs [id]
import { SCENES } from '../src/shorts/scenes.js';
import { checkShort, estimateSeconds } from '../src/shorts/check.js';

const only = process.argv[2];
let fail = 0;
for (const s of SCENES) {
  if (only && s.id !== only) continue;
  const { bad, events } = checkShort(s);
  console.log(`\n${bad.length ? '✗' : '✓'} ${s.id} — ${s.title} · видео ≈${estimateSeconds(s).toFixed(1)} с`);
  for (const e of events) {
    if (e.type === 'touch' && e.kind !== 'juggle') continue;
    const who = e.pi !== undefined ? ` p${e.pi}` : e.by !== undefined ? ` by${e.by}` : '';
    const what = e.type === 'kick' ? `${e.kind}${e.bike ? ' через себя' : e.fly ? ' сбоку в полёте' : e.jump ? ' в прыжке' : e.volley ? ' с лёта' : ''} ${e.speed.toFixed(1)} м/с`
      : e.type === 'goal' ? `+${e.pts} (${e.bonus.map((b) => b[0]).join('+')})`
      : e.type === 'post' ? e.part : e.type === 'hold_penalty' ? e.pts : e.type === 'match_over' ? `победил ${e.winner}` : e.type === 'touch' ? `чеканка ${e.n}` : '';
    console.log(`  ${e.t.toFixed(2).padStart(6)}  ${e.type}${who} ${what}`);
  }
  for (const b of bad) console.log('  ! ' + b);
  if (bad.length) fail++;
}
if (fail) { console.log(`\nне удались: ${fail}`); process.exitCode = 1; }
