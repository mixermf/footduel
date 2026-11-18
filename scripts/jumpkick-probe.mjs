// Окно удара в прыжке для человека: мяч навесом летит к стоящему игроку и проходит над ним на высоте h. Игрок жмёт и держит
// удар за tk секунд до прихода мяча, жмёт прыжок за tj секунд до прихода. Для каждой пары (tk, tj) — получился ли удар
// по мячу в воздухе (в прыжке или сбоку в полёте). Таблица по высотам: строки — tj, столбцы — tk; «#» — удар в прыжке,
// «o» — удар без прыжка (мяч опустился), «h» — не удар, но мяч встретила голова, «.» — нет касания.     node scripts/jumpkick-probe.mjs
import { World, emptyInput } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';

const T = 1.0; // время полёта мяча от подачи до игрока, с
function trial(h, tk, tj, digital = true) {
  const w = new World(createProfile(), { seed: 3, duel: true }); w.recording = false; w.reset('duel');
  const p = w.players[0], q = w.players[1], att = -p.side;
  q.x = -att * 8; q.z = 4.5; w._placeFeet(q);
  p.x = -att * 3; p.z = 0; p.yaw = att > 0 ? 0 : Math.PI; w._placeFeet(p);
  const idle = emptyInput();
  for (let i = 0; i < 30; i++) w.step(idle, idle);
  // подача: с чужой половины, мяч проходит над точкой игрока (чуть впереди) на высоте h через T секунд
  const x0 = att * 4, y0 = 0.5, tx = p.x + att * 0.3, g = w.P.ball.gravity;
  Object.assign(w.ball, { x: x0, y: y0, z: 0.6, vx: (tx - x0) / T, vy: (h - y0 + 0.5 * g * T * T) / T, vz: -0.6 / T, wx: 0, wy: 0, wz: 0, inGoal: false });
  let res = '.';
  for (let i = 0; i < 1.8 * 120; i++) {
    // в целых шагах: нажатие ровно на своей отметке, без потерь на округлении
    const left = Math.round(T * 120) - i, o = emptyInput(); o.digital = digital;
    const kOn = left <= Math.round(tk * 120);
    o.kickPressed = left === Math.round(tk * 120); o.kickHeld = kOn && left > -60;
    o.jumpPressed = left === Math.round(tj * 120);
    w.step(o, idle);
    for (const e of w.events) { if (e.type === 'kick' && e.pi === 0) res = e.jump || e.fly ? '#' : 'o'; else if (e.type === 'header' && e.pi === 0 && res === '.') res = 'h'; }
    if (res !== '.') break;
  }
  return res;
}
const TK = [1.0, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2], TJ = [1.0, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1];
for (const h of [1.3, 1.6, 1.9, 2.2]) {
  let ok = 0, n = 0;
  console.log(`\nмяч проходит на высоте ${h} м; столбцы — удар нажат за ${TK.join('/')} с до прихода мяча`);
  for (const tj of TJ) {
    const row = TK.map((tk) => { const r = trial(h, tk, tj); n++; if (r === '#') ok++; return r; }).join(' ');
    console.log(`  прыжок за ${tj.toFixed(2)} с: ${row}`);
  }
  console.log(`  удачных ${ok}/${n}`);
}
