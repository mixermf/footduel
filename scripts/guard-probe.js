// Проба перемещения в защитной стойке (dev-сборка, /?menu=0&autopause=0):
//   guardProbe({ mz: 1 })            — приставной шаг вбок (мяч стоит впереди по X)
//   guardProbe({ mx: -1 })           — отход спиной;  guardProbe({ mx: 0.7, mz: 0.7 }) — по диагонали
// Сводка: speed — скорость, м/с; stepT — время шага, с; gapMin / gapMax — расстояние между стопами поперёк корпуса, см
// (симуляция и кости); cross — кадров, где стопы поменялись местами; ankleMin — наименьшее расстояние между голеностопами, см;
// pops — рывки: наибольшее отношение скорости точки за кадр к среднему у соседних кадров (голеностопы, таз, кисть) и её наибольшая
// скорость, м/с; hipBob — ход таза по вертикали, см; slip — путь опорной стопы по покрытию за одну опору, см.
// trace: true — покадровые строки.
window.guardProbe = function guardProbe(cfg = {}) {
  const c = { mx: 0, mz: 1, frames: 110, warm: 30, trace: false, ...cfg };
  const g = window.__game, rig = g.rig, B = rig.bones, w = g.world;
  const V = rig.root.position.constructor, wp = (b) => b.getWorldPosition(new V());
  g.manual = true; g.simPaused = false; g.timeScale = 1;
  g.resetSandbox('motor'); rig._cel = null;
  const p = w.player;
  { const dx = -3 - p.x, dz = -3 * Math.sign(c.mz || 0) - p.z; p.x += dx; p.z += dz; for (const f of p.feet) { f.x += dx; f.z += dz; } }
  const orig = g.input.fill; let on = false;
  g.input.fill = function (out, e) { orig.call(this, out, e); out.mx = on ? c.mx : 0; out.mz = on ? c.mz : 0; out.digital = false; out.guardHeld = true; out.sprintHeld = false; out.controlHeld = false; };
  const rows = [];
  try {
    for (let f = 0; f < c.warm + c.frames; f++) {
      w.ball.x = 6; w.ball.z = 0; w.ball.vx = w.ball.vz = 0;
      on = f >= c.warm;
      g.manualFrame(1 / 60); rig._cel = null;
      if (!on) continue;
      const v = g.view, rx = -Math.sin(v.yaw), rz = Math.cos(v.yaw);
      const a = [wp(B.LeftFoot), wp(B.RightFoot)], hips = wp(B.Hips), hand = wp(B.LeftHand);
      rows.push({ f: f - c.warm, speed: Math.hypot(p.vx, p.vz), px: v.px, pz: v.pz, guard: !!p.guard,
        simGap: (p.feet[1].x - p.feet[0].x) * rx + (p.feet[1].z - p.feet[0].z) * rz,
        boneGap: (a[1].x - a[0].x) * rx + (a[1].z - a[0].z) * rz, ankle: Math.hypot(a[1].x - a[0].x, a[1].z - a[0].z),
        pl: [p.feet[0].planted, p.feet[1].planted], a, hips, hand, h: [p.feet[0].h, p.feet[1].h] });
    }
  } finally { g.input.fill = orig; }
  const st = rows.slice(20), r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
  const pop = (get) => {
    const sp = [];
    for (let i = 1; i < st.length; i++) { const a = get(st[i - 1]), b = get(st[i]); sp.push(Math.hypot(b.x - a.x - (st[i].px - st[i - 1].px), b.y - a.y, b.z - a.z - (st[i].pz - st[i - 1].pz)) * 60); }
    let worst = 0, at = 0;
    for (let i = 2; i < sp.length - 2; i++) { const nb = (sp[i - 2] + sp[i - 1] + sp[i + 1] + sp[i + 2]) / 4, k = sp[i] / Math.max(0.3, nb); if (k > worst) { worst = k; at = st[i + 1].f; } }
    return [r2(worst), r2(Math.max(...sp)), at];
  };
  const strikes = [];
  for (let i = 1; i < st.length; i++) for (let k = 0; k < 2; k++) if (st[i].pl[k] && !st[i - 1].pl[k]) strikes.push(st[i].f);
  const dT = []; for (let i = 1; i < strikes.length; i++) dT.push((strikes[i] - strikes[i - 1]) / 60);
  let slip = 0;
  for (let k = 0; k < 2; k++) { let acc = 0; for (let i = 1; i < st.length; i++) { if (st[i].pl[k] && st[i - 1].pl[k]) acc += Math.hypot(st[i].a[k].x - st[i - 1].a[k].x, st[i].a[k].z - st[i - 1].a[k].z); else { slip = Math.max(slip, acc); acc = 0; } } slip = Math.max(slip, acc); }
  const out = {
    speed: r2(st.reduce((s, r) => s + r.speed, 0) / st.length), guard: st.every((r) => r.guard),
    stepT: r2(dT.reduce((s, x) => s + x, 0) / Math.max(1, dT.length)), stepSpread: dT.length ? r2(Math.max(...dT) - Math.min(...dT)) : 0,
    simGap: [r1(Math.min(...st.map((r) => r.simGap)) * 100), r1(Math.max(...st.map((r) => r.simGap)) * 100)],
    boneGap: [r1(Math.min(...st.map((r) => r.boneGap)) * 100), r1(Math.max(...st.map((r) => r.boneGap)) * 100)],
    cross: st.filter((r) => r.boneGap < 0.02).length, ankleMin: r1(Math.min(...st.map((r) => r.ankle)) * 100),
    pops: { ankleL: pop((r) => r.a[0]), ankleR: pop((r) => r.a[1]), hips: pop((r) => r.hips), hand: pop((r) => r.hand) },
    hipBob: r1((Math.max(...st.map((r) => r.hips.y)) - Math.min(...st.map((r) => r.hips.y))) * 100), slip: r1(slip * 100),
  };
  if (c.trace) out.rows = rows.map((r) => [r.f, r2(r.speed), (r.pl[0] ? 'P' : '-') + (r.pl[1] ? 'P' : '-'), r2(r.simGap), r2(r.boneGap), r2(r.h[0]), r2(r.h[1]), r2(r.hips.y)].join(' '));
  return out;
};
