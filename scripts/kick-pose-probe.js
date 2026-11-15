// Проба позы удара с места для сравнения с раскадровкой референса (dev-сборка, /?menu=0&autopause=0).
//   kickPoseProbe({ hold: 40 })  — hold: сколько кадров держать кнопку удара (40 — полный заряд)
// Возвращает три ключевых момента: замах (стопа дальше всего позади), контакт, проводка (стопа выше всего после контакта).
// Углы в градусах. lean: + вперёд, − назад. side: + наклон от бьющей ноги к опорной. open: + таз/грудь развёрнуты
// к бьющей ноге (игрок подошёл сбоку), − довернулись за линию удара. armOpp/armSame: отведение плеча от линии корпуса
// и вынос вперёд (+) или назад (−) у руки, противоположной бьющей ноге, и у руки с её стороны.
window.kickPoseProbe = function kickPoseProbe(cfg = {}) {
  const c = { hold: 40, scenario: 'free', wait: 40, ...cfg }; // wait — кадров от подачи до нажатия (для подач в сценариях)
  const g = window.__game, rig = g.rig, B = rig.bones;
  const V = rig.root.position.constructor, Q = B.Hips.quaternion.constructor;
  const wp = (b) => b.getWorldPosition(new V());
  const deg = (x) => Math.round(x * 180 / Math.PI);
  const ang = (a, b, d) => { const u = a.clone().sub(b), w = d.clone().sub(b); return Math.acos(Math.max(-1, Math.min(1, u.dot(w) / (u.length() * w.length())))); };
  const drive = (fn) => { const orig = g.input.fill; g.input.fill = function (out, e) { orig.call(this, out, e); Object.assign(out, fn()); }; try { g.manualFrame(1 / 60); } finally { g.input.fill = orig; } };
  g.manual = true; g.simPaused = false; g.timeScale = 1;
  g.resetSandbox(c.scenario); rig._cel = null;
  for (let i = 0; i < c.wait; i++) drive(() => ({}));
  const rows = [];
  let started = false, hitIdx = -1, kdir = null;
  for (let f = 0; f < c.hold + 90; f++) {
    drive(() => ({ kickHeld: f < c.hold, kickPressed: f === 0 }));
    rig._cel = null;
    const p = g.world.player, k = p.kick, v = g.view;
    const lk = rig.sp.kLeg ? rig.sp.kLeg.x : 0;
    if (!rig._kOn && lk < 0.05) { if (started) break; continue; }
    started = true;
    const side = rig._kSide, n = side > 0 ? 'Right' : 'Left', o = side > 0 ? 'Left' : 'Right';
    // оси — по линии удара, а не по корпусу: корпус в ударе поворачивается, референс снят относительно направления удара
    if (k) kdir = Math.atan2(k.az, k.ax);
    const ky = kdir === null ? v.yaw : kdir;
    const fw = new V(Math.cos(ky), 0, Math.sin(ky)), rt = new V(-fw.z, 0, fw.x);
    const hips = wp(B.Hips), chest = wp(B.Neck), axis = chest.clone().sub(hips).normalize();
    const facing = (bone, name) => new V(rig.F0.x, 0, rig.F0.z).applyQuaternion(bone.getWorldQuaternion(new Q()).multiply(rig.rest[name].q.clone().invert()));
    const yawOf = (d) => Math.atan2(d.dot(rt), d.dot(fw)) * side;
    const arm = (nm) => { const s = wp(B[nm + 'Arm']), e = wp(B[nm + 'ForeArm']), d = e.clone().sub(s).normalize(); return { abd: deg(Math.acos(Math.max(-1, Math.min(1, -d.dot(axis))))), fwd: Math.round(d.dot(fw) * 100) / 100, out: Math.round(d.dot(rt) * (nm === 'Right' ? 1 : -1) * 100) / 100 }; };
    const up = wp(B[n + 'UpLeg']), kn = wp(B[n + 'Leg']), an = wp(B[n + 'Foot']);
    const pu = wp(B[o + 'UpLeg']), pk = wp(B[o + 'Leg']), pa = wp(B[o + 'Foot']);
    if (k && k.phase === 'curl' && hitIdx < 0) hitIdx = rows.length;
    rows.push({ kc: Math.round(rig._kc * 100) / 100, clip: rig._kClip.name,
      lean: deg(Math.atan2(axis.dot(fw), axis.y)), side: deg(Math.atan2(-axis.dot(rt) * side, axis.y)),
      open: deg(yawOf(facing(B.Hips, 'Hips'))), chestOpen: deg(yawOf(facing(B.Spine2, 'Spine2'))),
      armOpp: arm(o), armSame: arm(n),
      kickKnee: deg(Math.PI - ang(up, kn, an)), plantKnee: deg(Math.PI - ang(pu, pk, pa)),
      footFwd: Math.round(((an.x - up.x) * fw.x + (an.z - up.z) * fw.z) * 100) / 100, footH: Math.round((an.y - v.py) * 100) / 100,
      thigh: deg(Math.atan2((kn.x - up.x) * fw.x + (kn.z - up.z) * fw.z, up.y - kn.y)), // + бедро вперёд, − назад
      thighOut: deg(Math.asin(Math.max(-1, Math.min(1, ((kn.x - up.x) * rt.x + (kn.z - up.z) * rt.z) * side / kn.distanceTo(up))))), // отведение бедра в сторону
      kneeAboveHipCm: Math.round((kn.y - up.y) * 100), // > 0 — колено выше тазобедренного сустава
      pelvis: Math.round(100 * (hips.y - v.py) / rig.hipRestY), // высота таза над опорой игрока, % от стойки
      dyn: !!(k && k.dyn), py: v.py, reach: Math.max(rig.diag.reachErr[0], rig.diag.reachErr[1]) });
  }
  if (hitIdx < 0) return { error: 'удара не было', rows: rows.length };
  const hit = rows[hitIdx];
  const extra = { dyn: hit.dyn, jumpCm: Math.round(hit.py * 100), planH: Math.round(rig.diag.plan.h * 100) / 100, reachCm: Math.round(Math.max(...rows.map((r) => r.reach)) * 1000) / 10 };
  let bi = 0, fi = hitIdx;
  for (let i = 0; i <= hitIdx; i++) if (rows[i].footFwd < rows[bi].footFwd) bi = i;
  for (let i = hitIdx; i < rows.length; i++) if (rows[i].footH > rows[fi].footH) fi = i;
  const kneeMax = Math.max(...rows.slice(0, hitIdx + 1).map((r) => r.kickKnee));
  return { clip: rows[hitIdx].clip, ...extra, backswing: rows[bi], contact: rows[hitIdx], follow: rows[fi], kneeMaxBeforeContact: kneeMax,
    timing: { backswingToContact: Math.round((hitIdx - bi) / 60 * 100) / 100, contactToFollowPeak: Math.round((fi - hitIdx) / 60 * 100) / 100, total: Math.round(rows.length / 60 * 100) / 100 } };
};
