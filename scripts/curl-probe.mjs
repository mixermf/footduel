// Куда закручивается удар в угол: игрок с мячом бьёт с удержанием прицела (клавиша или стик в сторону угла держится,
// как у человека, и после контакта). Для каждого удара: цель по ширине, где мяч прошёл линию ворот, изгиб относительно
// линии вылета (+ — к центру ворот, − — от ворот), попал ли в створ.   node scripts/curl-probe.mjs
import { World, emptyInput } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';

function shot({ aim, charge, run, digital, keepAfter, x0 = 3, z0 = 0 }) {
  const w = new World(createProfile(), { seed: 1, duel: true }); w.recording = false; w.reset('duel');
  const p = w.players[0], q = w.players[1], att = -p.side, F = w.P.field, K = w.P.kick, gx = att * (F.length / 2 - F.goalInset);
  q.x = -att * 8; q.z = 4.5; w._placeFeet(q);
  p.x = -att * x0; p.z = z0; p.yaw = att > 0 ? 0 : Math.PI; w._placeFeet(p);
  Object.assign(w.ball, { x: p.x + att * 0.45, y: 0.11, z: p.z, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 });
  const idle = emptyInput();
  // разбег с мячом: run — направление бега по ширине (0 — прямо на ворота, ±1 — по диагонали)
  for (let i = 0; i < 60; i++) { const o = emptyInput(); o.digital = digital; o.mx = att * 0.8; o.mz = run * 0.8; w.step(o, idle); }
  const hold = charge * K.chargeTime; let t = 0, kicked = false, launch = null, cross = null, events = [];
  for (let i = 0; i < 400 && !cross; i++) {
    const o = emptyInput(); o.digital = digital;
    o.mx = att * 0.8; o.mz = run * 0.8; // пока держится удар, стик — прицел
    if (t >= 0) { o.kickPressed = t === 0; o.kickHeld = t < hold; o.mz = aim; o.mx = 0; }
    if (kicked && !keepAfter) o.mz = 0;
    w.step(o, idle); t += w.dt;
    for (const e of w.events) if (e.type === 'kick' && e.pi === 0) { kicked = true; const b = w.ball; launch = { x: b.x, z: b.z, vx: b.vx, vz: b.vz, aimLat: e.aimLat }; }
    const b = w.ball;
    if (launch && (b.x - gx) * att >= 0) cross = { z: b.z, y: b.y };
    if (launch && Math.hypot(b.vx, b.vz) < 1) break;
  }
  if (!launch || !cross) return null;
  const lin = launch.z + launch.vz * ((gx - launch.x) / launch.vx), tz = launch.aimLat * (F.goalWidth / 2) * K.aimWidth;
  const bend = (cross.z - lin) * -Math.sign(tz || 1); // + — к центру
  return { tz: tz.toFixed(2), z: cross.z.toFixed(2), bend: bend.toFixed(2), onTarget: Math.abs(cross.z) < F.goalWidth / 2 && cross.y < F.goalHeight };
}

for (const digital of [true, false]) for (const keepAfter of [true, false]) {
  const rows = [];
  for (const aim of [-1, 1]) for (const run of [0, 1, -1]) for (const charge of [0.4, 0.9]) {
    const r = shot({ aim, charge, run, digital, keepAfter });
    if (r) rows.push(r);
  }
  const out = rows.filter((r) => !r.onTarget).length, bendOut = rows.filter((r) => +r.bend < -0.05).length;
  console.log(`${digital ? 'клавиши' : 'стик   '} ${keepAfter ? 'держит прицел после контакта' : 'отпустил на контакте        '} | ударов ${rows.length}, мимо створа ${out}, изгиб от ворот ${bendOut} | ` + rows.map((r) => `${r.tz}→${r.z}(${r.bend})`).join(' '));
}
