// Проба сцены выхода перед сетевым матчем (dev-сборка, /?menu=0&autopause=0):
//   introProbe()              — прогон всей сцены с шагом 1/60 с;   introProbe({ pick: [1, 0] }) — другие походки
//   introProbe({ stop: 2.8 }) — остановиться на этой секунде (для кадра)
// Сводка:
//   walk    — крупный план, ходьба: speed — скорость каждого игрока, м/с; slip — путь стопы по покрытию, пока она стоит
//             (голеностоп у нижней точки), см за одну опору, наибольший; meetDist — расстояние между игроками в рукопожатии, м
//   shake   — рукопожатие: gapClip — расстояние между правыми кистями, как в клипах без подгонки, см (мин/макс за время
//             сцепки); gap — оно же после IK; y — высота кистей, м (мин/макс): качание руки; elbow — сгиб локтя, °
//   back    — общий план: homeAt — когда встали на места, с; endX — где стоят в конце (ввод мяча — ±4 м);
//             endYawErr — отклонение от «лицом к сопернику», °
//   pops    — наибольшее отношение скорости точки за кадр к средней у соседних (кисть, таз, голеностоп) отдельно для
//             крупного плана и общего; склейка между планами в счёт не идёт
window.introProbe = function introProbe(cfg = {}) {
  const c = { dur: 6.8, stop: -1, pick: [0, 1], ...cfg };
  const g = window.__game, R = [g.rig, g.rig2], B = [g.rig.bones, g.rig2.bones];
  const V = g.rig.root.position.constructor, wp = (b) => b.getWorldPosition(new V());
  const ang = (a, b, d) => { const u = a.clone().sub(b), q = d.clone().sub(b); return Math.acos(Math.max(-1, Math.min(1, u.dot(q) / (u.length() * q.length())))) * 180 / Math.PI; };
  g.manual = true; g.introPick = c.pick;
  g.introPreview(-1); g.introPreview(0);
  const rows = [], N = Math.round((c.stop >= 0 ? c.stop : c.dur) * 60);
  for (let f = 0; f <= N; f++) {
    const t = f / 60, fr = g.introPreview(t);
    // расстояние между кистями «как в клипе»: тот же кадр без IK
    let gapClip = null;
    if (fr.clip && fr.hw > 0.5) {
      R[0].updateClip(fr.roots[0], fr.layers[0]); R[1].updateClip(fr.roots[1], fr.layers[1]);
      gapClip = wp(B[0].RightHand).distanceTo(wp(B[1].RightHand));
      R[0].updateClip(fr.roots[0], fr.layers[0], { hand: fr.hands[0] }); R[1].updateClip(fr.roots[1], fr.layers[1], { hand: fr.hands[1] });
    }
    const h = [wp(B[0].RightHand), wp(B[1].RightHand)], hip = [wp(B[0].Hips), wp(B[1].Hips)];
    rows.push({ t, clip: fr.clip, hw: fr.hw, hip, gap: h[0].distanceTo(h[1]), gapClip, hy: [h[0].y, h[1].y], hand: h[0],
      elbow: 180 - ang(wp(B[0].RightArm), wp(B[0].RightForeArm), h[0]), an: [wp(B[0].LeftFoot), wp(B[0].RightFoot), wp(B[1].LeftFoot), wp(B[1].RightFoot)],
      v: fr.clip ? null : [{ x: fr.v[0].px, yaw: fr.v[0].yaw, sp: Math.hypot(fr.v[0].vx, fr.v[0].vz) }, { x: fr.v[1].px, yaw: fr.v[1].yaw }], out: fr.cam.out });
  }
  if (c.stop >= 0) return { stopped: c.stop };
  const r2 = (x) => Math.round(x * 100) / 100, r1 = (x) => Math.round(x * 10) / 10, mm = (a) => [r1(Math.min(...a)), r1(Math.max(...a))];
  const cl = rows.filter((r) => r.clip), sim = rows.filter((r) => !r.clip), grip = cl.filter((r) => r.hw > 0.97);
  const mid = cl.filter((r) => r.t > 0.8 && r.t < 1.4);
  const speed = [0, 1].map((i) => r2(Math.abs(mid[mid.length - 1].hip[i].x - mid[0].hip[i].x) / (mid[mid.length - 1].t - mid[0].t)));
  // скольжение: путь голеностопа по горизонтали, пока он у нижней точки
  let slip = 0;
  for (let k = 0; k < 4; k++) {
    const lo = Math.min(...cl.map((r) => r.an[k].y)); let acc = 0;
    for (let i = 1; i < cl.length; i++) { if (cl[i].an[k].y < lo + 0.02 && cl[i - 1].an[k].y < lo + 0.02 && cl[i].t < 1.9) acc += Math.hypot(cl[i].an[k].x - cl[i - 1].an[k].x, cl[i].an[k].z - cl[i - 1].an[k].z); else { slip = Math.max(slip, acc); acc = 0; } }
    slip = Math.max(slip, acc);
  }
  const pop = (rs, get) => {
    const sp = []; for (let i = 1; i < rs.length; i++) sp.push(get(rs[i]).distanceTo(get(rs[i - 1])) * 60);
    let worst = 0, at = 0;
    for (let i = 2; i < sp.length - 2; i++) { const nb = (sp[i - 2] + sp[i - 1] + sp[i + 1] + sp[i + 2]) / 4, k = sp[i] / Math.max(0.4, nb); if (k > worst) { worst = k; at = rs[i + 1].t; } }
    return [r2(worst), r2(at)];
  };
  const home = sim.find((r, i) => i > 20 && r.v[0].sp < 0.1), end = sim[sim.length - 1];
  const yawErr = (y, want) => { let d = (y - want) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return Math.round(Math.abs(d) * 180 / Math.PI); };
  g.introPreview(-1);
  return {
    cutAt: r2(sim[0].t),
    walk: { speed, slip: r1(slip * 100), meetDist: grip.length ? r2(grip[0].hip[0].distanceTo(grip[0].hip[1])) : null },
    shake: grip.length ? { secs: r2(grip.length / 60), gapClip: mm(grip.map((r) => r.gapClip * 100)), gap: mm(grip.map((r) => r.gap * 100)), y: [r2(Math.min(...grip.map((r) => r.hy[0]))), r2(Math.max(...grip.map((r) => r.hy[0])))], elbow: mm(grip.map((r) => r.elbow)) } : null,
    back: { homeAt: home ? r2(home.t) : null, endX: [r2(end.v[0].x), r2(end.v[1].x)], endYawErr: [yawErr(end.v[0].yaw, 0), yawErr(end.v[1].yaw, Math.PI)], camOutAt: r2((sim.find((r) => r.out > 0.99) || { t: -1 }).t) },
    pops: { clip: { hand: pop(cl, (r) => r.hand), hips: pop(cl, (r) => r.hip[0]), ankle: pop(cl, (r) => r.an[0]) }, sim: { hand: pop(sim, (r) => r.hand), hips: pop(sim, (r) => r.hip[0]), ankle: pop(sim, (r) => r.an[0]) } },
  };
};
