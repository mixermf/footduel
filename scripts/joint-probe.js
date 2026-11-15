// Проба суставов в ударе для лаборатории (dev-сборка, адрес /?menu=0&autopause=0).
// Вставляется в консоль или выполняется автотестом; затем: jointSweep() — таблица по сценариям подач.
// Ловит то, что глаз видит как «сломанную ногу»:
//   back   — кадры, где колено ушло назад за линию бедро — голеностоп относительно таза (и на сколько см);
//   flip   — наибольший поворот колена вокруг этой линии за один кадр, градусы (перескок = рывок);
//   ankle  — диапазон угла стопа — голень, градусы;
//   corr / cut — длина поправки клипа к симуляции и её срезанная часть, м.
window.jointProbe = function jointProbe(scn, pressAt, hold, opt = {}) {
  const g = window.__game, rig = g.rig, B = rig.bones;
  const V = rig.root.position.constructor, Q = B.Hips.quaternion.constructor;
  const wp = (b) => b.getWorldPosition(new V());
  const drive = (fn) => { const orig = g.input.fill; g.input.fill = function (out, e) { orig.call(this, out, e); Object.assign(out, fn()); }; try { g.manualFrame(1 / 60); } finally { g.input.fill = orig; } };
  g.manual = true; g.simPaused = false; g.timeScale = 1;
  rig.packClips = opt.pack !== false; rig.adapt.kickLeg = opt.leg !== false;
  g.resetSandbox(scn); rig._cel = null;
  const out = { kicked: false, clip: '', dyn: false, ballY: 0, frames: 0, backFrames: 0, backWorstCm: 0, flipMaxDeg: 0, ankleMin: 180, ankleMax: 0, corrMax: 0, cutMax: 0, reachCm: 0, readyAtWindup: null, halfAt: null, hitAt: null, planH: null };
  const prev = [null, null];
  let f = 0, k = null;
  // упреждение: насколько поза удара уже набрана к началу замаха и на каком кадре она набрана наполовину
  const trackPlan = () => {
    const pl = rig.diag.plan;
    if (!pl) return;
    if (k && k.phase === 'windup' && out.readyAtWindup === null) out.readyAtWindup = Math.round(pl.w * 100) / 100;
    if (pl.w >= 0.5 && out.halfAt === null) out.halfAt = f;
    if (k && k.phase === 'curl' && out.hitAt === null) { out.hitAt = f; out.planH = Math.round(pl.h * 100) / 100; }
  };
  for (f = 0; f < pressAt + hold + 70; f++) {
    drive(() => ({ kickHeld: f >= pressAt && f < pressAt + hold, kickPressed: f === pressAt }));
    rig._cel = null;
    k = g.world.player.kick;
    if (k) out.kicked = true;
    if (k && k.phase === 'swing') { out.dyn = !!k.dyn; out.ballY = Math.round(g.world.ball.y * 100) / 100; out.clip = rig._kClip.name; }
    const lk = rig.sp.kLeg ? rig.sp.kLeg.x : 0;
    if (!(rig._kOn || lk > 0.05)) { prev[0] = prev[1] = null; trackPlan(); continue; }
    out.frames++;
    const fwd = new V(rig.F0.x, 0, rig.F0.z).applyQuaternion(B.Hips.getWorldQuaternion(new Q()).multiply(rig.rest.Hips.q.clone().invert()));
    ['Left', 'Right'].forEach((n, i) => {
      const up = wp(B[n + 'UpLeg']), kn = wp(B[n + 'Leg']), an = wp(B[n + 'Foot']), toe = wp(B[n + 'ToeBase']);
      const d = an.clone().sub(up).normalize();
      const off = kn.clone().sub(up); off.addScaledVector(d, -off.dot(d));
      const back = off.dot(fwd);
      if (back < -0.03) { out.backFrames++; out.backWorstCm = Math.min(out.backWorstCm, Math.round(back * 100)); }
      const big = off.length() > 0.05, dirK = off.clone().normalize();
      if (prev[i] && big) out.flipMaxDeg = Math.max(out.flipMaxDeg, Math.round(Math.acos(Math.max(-1, Math.min(1, dirK.dot(prev[i])))) * 180 / Math.PI));
      prev[i] = big ? dirK : null;
      const a = Math.acos(Math.max(-1, Math.min(1, -an.clone().sub(kn).normalize().dot(toe.clone().sub(an).normalize())))) * 180 / Math.PI;
      out.ankleMin = Math.min(out.ankleMin, Math.round(a)); out.ankleMax = Math.max(out.ankleMax, Math.round(a));
    });
    // недотяг: на сколько голеностоп не достал до точки стопы из симуляции (IK упёрся в длину ноги), см
    if (k) out.reachCm = Math.max(out.reachCm, Math.round(Math.max(rig.diag.reachErr[0], rig.diag.reachErr[1]) * 1000) / 10);
    trackPlan();
    out.corrMax = Math.max(out.corrMax, Math.round(rig.diag.kick.corr * 100) / 100); out.cutMax = Math.max(out.cutMax, Math.round(rig.diag.kick.cut * 100) / 100);
  }
  return out;
};

// сценарий, кадр нажатия удара после подачи, сколько кадров держать кнопку
window.JOINT_CASES = [['free', 40, 4], ['free', 40, 40], ['low', 30, 4], ['low', 45, 4], ['thigh', 30, 4], ['thigh', 45, 4], ['chest', 30, 4], ['chest', 45, 4],
  ['high', 40, 4], ['high', 60, 4], ['wall', 40, 4], ['wall', 70, 4]];
window.jointSweep = function jointSweep(opt = {}) {
  const rows = window.JOINT_CASES.map(([s, at, h]) => {
    const r = window.jointProbe(s, at, h, opt);
    return { case: `${s}@${at}/${h}`, ...(r.kicked ? { clip: r.clip + (r.dyn ? ' dyn' : ''), ballY: r.ballY, back: `${r.backFrames}к/${r.backWorstCm}см`, flip: r.flipMaxDeg, ankle: `${r.ankleMin}-${r.ankleMax}`, corr: r.corrMax, cut: r.cutMax, reachCm: r.reachCm,
      planH: r.planH, readyAtWindup: r.readyAtWindup, leadSec: r.hitAt !== null && r.halfAt !== null ? Math.round((r.hitAt - r.halfAt) / 60 * 100) / 100 : null } : { clip: 'нет удара' }) };
  });
  const sum = rows.reduce((a, r) => { const m = /^(\d+)к\/(-?\d+)/.exec(r.back || ''); if (m) { a.backFrames += Number(m[1]); a.backWorstCm = Math.min(a.backWorstCm, Number(m[2])); } a.flipMax = Math.max(a.flipMax, r.flip || 0); a.reachMaxCm = Math.max(a.reachMaxCm, r.reachCm || 0); return a; }, { backFrames: 0, backWorstCm: 0, flipMax: 0, reachMaxCm: 0 });
  return { sum, rows };
};
