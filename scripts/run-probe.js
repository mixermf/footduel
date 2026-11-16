// Проба бега и перемещений (dev-сборка, /?menu=0&autopause=0):
//   runProbe({ sprint: true })                 — разгон с места, ровный бег, остановка
//   runProbe({ mz: 1, mx: 0 })                 — то же поперёк поля
//   runProbe({ turn: 180 })                    — на ходу направление меняется на turn градусов
// Ввод: 0..go кадров стоит, затем бежит run кадров, затем отпускает и стоит ещё rest кадров.
// Сводка:
//   start  — разгон: t90 — время до 90 % скорости, с; lean — наибольший наклон корпуса вперёд, °; firstStep — когда оторвалась первая стопа, с
//   steady — ровный бег (вторая половина пробега): speed м/с; stepT с; stepLen м; lean ° (мин/макс); flight — доля кадров без опоры;
//            heel — наибольшая высота голеностопа в махе, м; back/front — вынос стопы назад/вперёд от таза, м; knee — наибольший сгиб колена в махе, °;
//            bob — ход таза по вертикали, см; hand — ход кисти вперёд-назад от плеча, см; handY — высота кистей, м; elbow — сгиб локтя, ° (мин/макс)
//   stop   — остановка: t — время до скорости 0,3 м/с, с; lean — наименьший наклон (отклонение назад), °; steps — постановок стоп после отпускания
//   turn   — смена направления: dip — наименьшая скорость, м/с; t — время до 90 % скорости в новом направлении, с; side — наибольший наклон вбок, °
// trace: true — добавить покадровые строки (t, speed, lean, side, hipY, feet).
window.runProbe = function runProbe(cfg = {}) {
  const c = { mx: 1, mz: 0, sprint: false, go: 10, run: 80, rest: 50, turn: 0, turnAt: 50, startX: -8.5, trace: false, ...cfg };
  const g = window.__game, rig = g.rig, B = rig.bones, w = g.world;
  const V = rig.root.position.constructor, wp = (b) => b.getWorldPosition(new V());
  const ang = (a, b, d) => { const u = a.clone().sub(b), q = d.clone().sub(b); return Math.acos(Math.max(-1, Math.min(1, u.dot(q) / (u.length() * q.length())))) * 180 / Math.PI; };
  g.manual = true; g.simPaused = false; g.timeScale = 1;
  g.resetSandbox('motor'); rig._cel = null;
  const p = w.player;
  { const dx = c.startX * (c.mx >= 0 ? 1 : -1) - p.x; if (c.mx) { p.x += dx; for (const f of p.feet) f.x += dx; } }
  if (c.mz && !c.mx) { const dz = -4 * Math.sign(c.mz) - p.z; p.z += dz; for (const f of p.feet) f.z += dz; }
  const ta = c.turn * Math.PI / 180, m0 = 1; // величина наклона стика сохраняется: mx: 0.45 — шаг
  const input = (f) => {
    if (f < c.go || f >= c.go + c.run) return { mx: 0, mz: 0 };
    if (c.turn && f >= c.go + c.turnAt) return { mx: (c.mx * Math.cos(ta) - c.mz * Math.sin(ta)) / m0, mz: (c.mx * Math.sin(ta) + c.mz * Math.cos(ta)) / m0 };
    return { mx: c.mx / m0, mz: c.mz / m0 };
  };
  const orig = g.input.fill; let cur = { mx: 0, mz: 0 };
  g.input.fill = function (out, e) { orig.call(this, out, e); out.mx = cur.mx; out.mz = cur.mz; out.digital = false; out.sprintHeld = c.sprint; out.controlHeld = false; };
  const rows = [], N = c.go + c.run + c.rest;
  try {
    for (let f = 0; f < 30; f++) { w.ball.x = 7 * (c.mx >= 0 ? 1 : -1) * (c.turn ? -1 : 1); w.ball.z = 4.2; w.ball.vx = w.ball.vz = 0; g.manualFrame(1 / 60); }
    for (let f = 0; f < N; f++) {
      cur = input(f);
      w.ball.vx = w.ball.vz = 0; w.ball.z = 4.2;
      g.manualFrame(1 / 60); rig._cel = null;
      const v = g.view, fx = Math.cos(v.yaw), fz = Math.sin(v.yaw), rx = -fz, rz = fx;
      const hips = wp(B.Hips), neck = wp(B.Neck || B.Head), sp = Math.hypot(p.vx, p.vz);
      const row = { f, t: f / 60, speed: sp, vx: p.vx, vz: p.vz, yaw: p.yaw,
        lean: Math.atan2((neck.x - hips.x) * fx + (neck.z - hips.z) * fz, neck.y - hips.y) * 180 / Math.PI,
        side: Math.atan2((neck.x - hips.x) * rx + (neck.z - hips.z) * rz, neck.y - hips.y) * 180 / Math.PI,
        hipY: hips.y, legs: [], hands: [] };
      ['Left', 'Right'].forEach((n, k) => {
        const up = wp(B[n + 'UpLeg']), kn = wp(B[n + 'Leg']), an = wp(B[n + 'Foot']);
        row.legs.push({ planted: p.feet[k].planted, knee: 180 - ang(up, kn, an), y: an.y, fwd: (an.x - hips.x) * fx + (an.z - hips.z) * fz, x: p.feet[k].x, z: p.feet[k].z });
        const sh = wp(B[n + 'Arm']), el = wp(B[n + 'ForeArm']), hd = wp(B[n + 'Hand']);
        row.hands.push({ fwd: (hd.x - sh.x) * fx + (hd.z - sh.z) * fz, y: hd.y, elbow: 180 - ang(sh, el, hd) });
      });
      rows.push(row);
    }
  } finally { g.input.fill = orig; }
  const r2 = (x) => Math.round(x * 100) / 100, r1 = (x) => Math.round(x * 10) / 10;
  const mm = (a) => [r1(Math.min(...a)), r1(Math.max(...a))];
  const top = Math.max(...rows.map((r) => r.speed));
  const i0 = c.go, i1 = c.go + (c.turn ? c.turnAt : c.run), iS = c.go + c.run;
  // разгон
  const acc = rows.slice(i0, i1), a90 = acc.find((r) => r.speed >= 0.9 * top), lift0 = acc.find((r) => !r.legs[0].planted || !r.legs[1].planted);
  const start = { t90: a90 ? r2(a90.t - i0 / 60) : null, lean: r1(Math.max(...acc.slice(0, 30).map((r) => r.lean))), firstStep: lift0 ? r2(lift0.t - i0 / 60) : null };
  // ровный бег
  const st = rows.slice(Math.round((i0 + i1) / 2), i1), strikes = [];
  for (let i = 1; i < st.length; i++) for (let k = 0; k < 2; k++) if (st[i].legs[k].planted && !st[i - 1].legs[k].planted) strikes.push({ t: st[i].t, x: st[i].legs[k].x, z: st[i].legs[k].z });
  const sT = [], sL = [];
  for (let i = 1; i < strikes.length; i++) { sT.push(strikes[i].t - strikes[i - 1].t); sL.push(Math.hypot(strikes[i].x - strikes[i - 1].x, strikes[i].z - strikes[i - 1].z)); }
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const swing = st.flatMap((r) => r.legs.filter((l) => !l.planted));
  const steady = {
    speed: r2(avg(st.map((r) => r.speed))), stepT: r2(avg(sT)), stepLen: r2(avg(sL)), lean: mm(st.map((r) => r.lean)),
    flight: r2(st.filter((r) => !r.legs[0].planted && !r.legs[1].planted).length / st.length),
    heel: r2(Math.max(...swing.map((l) => l.y))), back: r2(Math.min(...st.flatMap((r) => r.legs.map((l) => l.fwd)))), front: r2(Math.max(...st.flatMap((r) => r.legs.map((l) => l.fwd)))),
    knee: r1(Math.max(...swing.map((l) => l.knee))), bob: r1((Math.max(...st.map((r) => r.hipY)) - Math.min(...st.map((r) => r.hipY))) * 100),
    hand: mm(st.flatMap((r) => r.hands.map((h) => h.fwd * 100))), handY: [r2(Math.min(...st.flatMap((r) => r.hands.map((h) => h.y)))), r2(Math.max(...st.flatMap((r) => r.hands.map((h) => h.y))))],
    elbow: mm(st.flatMap((r) => r.hands.map((h) => h.elbow))),
  };
  // остановка
  const sp = rows.slice(iS), s03 = sp.find((r) => r.speed < 0.3); let steps = 0;
  for (let i = 1; i < sp.length; i++) for (let k = 0; k < 2; k++) if (sp[i].legs[k].planted && !sp[i - 1].legs[k].planted) steps++;
  const stop = { t: s03 ? r2(s03.t - iS / 60) : null, lean: r1(Math.min(...sp.slice(0, 30).map((r) => r.lean))), steps };
  const out = { cfg: c, top: r2(top), start, steady, stop };
  if (c.turn) {
    const tr = rows.slice(i1, iS), tin = input(i1), back = tr.find((r, i) => i > 3 && (r.vx * tin.mx + r.vz * tin.mz) >= 0.9 * top);
    out.turn = { dip: r2(Math.min(...tr.map((r) => r.speed))), t: back ? r2(back.t - i1 / 60) : null, side: mm(tr.slice(0, 40).map((r) => r.side)), lean: mm(tr.slice(0, 40).map((r) => r.lean)) };
  }
  if (c.trace) out.rows = rows.map((r) => ({ f: r.f, v: r2(r.speed), lean: r1(r.lean), side: r1(r.side), hip: r2(r.hipY), L: (r.legs[0].planted ? 'P' : '-') + r2(r.legs[0].fwd) + '/' + r2(r.legs[0].y), R: (r.legs[1].planted ? 'P' : '-') + r2(r.legs[1].fwd) + '/' + r2(r.legs[1].y) }));
  return out;
};
