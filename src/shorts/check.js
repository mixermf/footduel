// Прогон шортс-сцены без рендера: что произошло и совпало ли с ожиданием сцены (scene.expect).
// Используют scripts/shorts-check.mjs и tests/shorts.test.js; в браузере — только для отладки.
import { World } from '../sim/world.js';
import { createProfile } from '../sim/profile.js';
import { ShortRunner, stageShort } from './script.js';

const KEEP = new Set(['kick', 'goal', 'post', 'buzzer', 'match_over', 'hold_penalty', 'tackle', 'receive', 'header', 'overtime', 'kickoff', 'touch']);

export function runShort(scene, until = null) {
  const w = new World(createProfile(), { seed: 1, duel: true });
  w.recording = false;
  stageShort(w, scene);
  const r = new ShortRunner(w, scene), events = [];
  const end = until ?? Math.max(scene.live || 0, ...(scene.replays || []).map((x) => x.to));
  while (r.t < end - 1e-9) {
    const [a, b] = r.inputs();
    w.step(a, b); r.advance();
    for (const e of w.events) if (KEEP.has(e.type)) events.push({ t: Math.round(r.t * 1000) / 1000, ...e });
  }
  return { world: w, events };
}

// Список нарушений ожиданий (пустой — сцена удалась)
export function checkShort(scene) {
  const { world, events } = runShort(scene);
  const X = scene.expect || {}, bad = [];
  const goals = events.filter((e) => e.type === 'goal');
  if (X.goal) {
    const g = goals[0];
    if (!g) bad.push('нет гола');
    else {
      if (g.by !== X.goal.by) bad.push(`гол забил ${g.by}, ожидался ${X.goal.by}`);
      for (const k of X.goal.bonus || []) if (!g.bonus.some((b) => b[0] === k)) bad.push(`в голе нет бонуса ${k} (${g.bonus.map((b) => b[0]).join('+')})`);
      if (g.t > scene.live) bad.push(`гол на ${g.t} с — позже конца живой части ${scene.live} с`);
      const rps = scene.replays || [];
      if (rps.length && !rps.some((rp) => g.t >= rp.from && g.t <= rp.to)) bad.push(`ни один повтор не показывает гол на ${g.t} с`);
    }
    if (goals.length > 1) bad.push('голов больше одного');
  }
  const ko = events.find((e) => e.type === 'kickoff' && e.t < scene.live);
  if (ko) bad.push(`ввод мяча на ${ko.t} с: живая часть ${scene.live} с длиннее паузы после гола — игроки перескочат`);
  if (X.winner !== undefined) {
    const m = events.find((e) => e.type === 'match_over');
    if (!m || m.winner !== X.winner) bad.push(`матч не закончился победой ${X.winner}`);
  }
  if (X.buzzerBeforeGoal) {
    const bz = events.find((e) => e.type === 'buzzer'), k = events.filter((e) => e.type === 'kick' && e.pi === X.goal.by).at(-1);
    if (!bz || !goals[0] || bz.t >= goals[0].t || (k && bz.t <= k.t)) bad.push('сирена должна прозвучать, когда мяч уже летит');
  }
  if (X.posts) {
    const n = events.filter((e) => e.type === 'post' && (!goals[0] || e.t <= goals[0].t)).length;
    if (n < X.posts) bad.push(`касаний рамы ${n}, нужно ${X.posts}`);
  }
  if (X.penalties) {
    const n = events.filter((e) => e.type === 'hold_penalty' && e.pi === X.penalties.pi).length;
    if (n < X.penalties.min) bad.push(`штрафов ${n}, нужно ${X.penalties.min}`);
  }
  return { bad, events, world };
}

// Сколько реальных секунд длится сцена: стоп-кадр в начале, живая часть с замедлениями, повторы, финальный кадр
export function estimateSeconds(scene) {
  const slow = (t) => { for (const [a, b, k] of scene.slow || []) if (t >= a && t < b) return k; return 1; };
  let sec = scene.hook?.sec || 0;
  const h = 1 / 120;
  for (let t = 0; t < scene.live; t += h) sec += h / slow(t);
  for (const r of scene.replays || []) sec += (r.to - r.from) / (r.scale || 0.5);
  return sec + (scene.outro?.sec || 0);
}
