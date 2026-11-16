// Проба сцены выхода перед сетевым матчем (dev-сборка, /?menu=0&autopause=0):
//   introProbe()            — прогон всей сцены с шагом 1/60 с
//   introProbe({ stop: 2.8 }) — остановиться на этой секунде (для кадра)
// Сводка: meetAt — когда игроки встали друг перед другом, с; meetDist — расстояние между ними, м; walkSpeed — скорость
// сближения, м/с; handGap — расстояние между правыми кистями во время рукопожатия, см (мин/макс); handY — высота кистей, м;
// elbow — сгиб локтя правой руки первого игрока в рукопожатии, ° (мин/макс); pumps — число качаний; leaveAt — когда пошли
// назад; homeAt — когда встали на свои места; endX — где стоят в конце, м (ввод мяча — ±4); endYawErr — отклонение от
// направления «лицом к сопернику», °; slip — наибольший путь опорной стопы по покрытию за одну опору, см;
// pops — наибольшее отношение скорости точки за кадр к средней у соседних кадров (кисть, таз, голеностоп).
window.introProbe = function introProbe(cfg = {}) {
  const c = { dur: 7, stop: -1, ...cfg };
  const g = window.__game, B = [g.rig.bones, g.rig2.bones];
  const V = g.rig.root.position.constructor, wp = (b) => b.getWorldPosition(new V());
  const ang = (a, b, d) => { const u = a.clone().sub(b), q = d.clone().sub(b); return Math.acos(Math.max(-1, Math.min(1, u.dot(q) / (u.length() * q.length())))) * 180 / Math.PI; };
  g.manual = true;
  g.introPreview(0); g.introPreview(-1); g.introPreview(0); // сцена — с начала
  const rows = [], N = Math.round((c.stop >= 0 ? c.stop : c.dur) * 60);
  for (let f = 0; f <= N; f++) {
    const t = f / 60, fr = g.introPreview(t), v = fr.v;
    const h = [wp(B[0].RightHand), wp(B[1].RightHand)];
    rows.push({ t, x: [v[0].px, v[1].px], z: [v[0].pz, v[1].pz], yaw: [v[0].yaw, v[1].yaw], sp: Math.hypot(v[0].vx, v[0].vz), w: fr.aux[0].hand.w, gap: h[0].distanceTo(h[1]), hy: [h[0].y, h[1].y], hand: h[0],
      elbow: 180 - ang(wp(B[0].RightArm), wp(B[0].RightForeArm), h[0]), hips: wp(B[0].Hips), an: [wp(B[0].LeftFoot), wp(B[0].RightFoot)], pl: [v[0].feet[0].planted, v[0].feet[1].planted], out: fr.cam.out });
  }
  if (c.stop >= 0) return { stopped: c.stop };
  const r2 = (x) => Math.round(x * 100) / 100, r1 = (x) => Math.round(x * 10) / 10;
  const sh = rows.filter((r) => r.w > 0.95), walk = rows.filter((r) => r.t > 0.7 && r.t < 1.6);
  const meet = rows.find((r) => r.t > 0.6 && r.sp < 0.1), leave = rows.find((r) => r.t > 3 && r.sp > 0.5), home = rows.find((r) => leave && r.t > leave.t + 0.3 && r.sp < 0.1);
  let pumps = 0; for (let i = 2; i < sh.length; i++) if ((sh[i - 1].hy[0] - sh[i - 2].hy[0]) > 0 && (sh[i].hy[0] - sh[i - 1].hy[0]) <= 0) pumps++;
  const pop = (get, a = 0, b = c.dur) => {
    const rs = rows.filter((r) => r.t >= a && r.t <= b), sp = [];
    for (let i = 1; i < rs.length; i++) sp.push(get(rs[i]).distanceTo(get(rs[i - 1])) * 60);
    let worst = 0, at = 0;
    for (let i = 2; i < sp.length - 2; i++) { const nb = (sp[i - 2] + sp[i - 1] + sp[i + 1] + sp[i + 2]) / 4, k = sp[i] / Math.max(0.4, nb); if (k > worst) { worst = k; at = rs[i + 1].t; } }
    return [r2(worst), r2(at)];
  };
  let slip = 0;
  for (let k = 0; k < 2; k++) { let acc = 0; for (let i = 1; i < rows.length; i++) { if (rows[i].pl[k] && rows[i - 1].pl[k]) acc += Math.hypot(rows[i].an[k].x - rows[i - 1].an[k].x, rows[i].an[k].z - rows[i - 1].an[k].z); else { slip = Math.max(slip, acc); acc = 0; } } }
  const end = rows[rows.length - 1], mm = (a) => [r1(Math.min(...a)), r1(Math.max(...a))];
  const yawErr = (y, want) => { let d = (y - want) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return Math.round(Math.abs(d) * 180 / Math.PI); };
  g.introPreview(-1);
  return {
    meetAt: meet ? r2(meet.t) : null, meetDist: meet ? r2(Math.hypot(meet.x[0] - meet.x[1], meet.z[0] - meet.z[1])) : null,
    walkSpeed: r2(walk.reduce((s, r) => s + r.sp, 0) / Math.max(1, walk.length)),
    handGap: sh.length ? mm(sh.map((r) => r.gap * 100)) : null, handY: sh.length ? [r2(Math.min(...sh.flatMap((r) => r.hy))), r2(Math.max(...sh.flatMap((r) => r.hy)))] : null,
    elbow: sh.length ? mm(sh.map((r) => r.elbow)) : null, pumps,
    leaveAt: leave ? r2(leave.t) : null, homeAt: home ? r2(home.t) : null,
    endX: [r2(end.x[0]), r2(end.x[1])], endYawErr: [yawErr(end.yaw[0], 0), yawErr(end.yaw[1], Math.PI)], camOutAt: r2((rows.find((r) => r.out > 0.99) || { t: -1 }).t),
    slip: r1(slip * 100), pops: { hand: pop((r) => r.hand), hips: pop((r) => r.hips), ankle: pop((r) => r.an[0]) },
  };
};
