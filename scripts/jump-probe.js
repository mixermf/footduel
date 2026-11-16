// Проба прыжка (dev-сборка, /?menu=0&autopause=0):
//   jumpProbe({ run: 0 | 1 | 2 })              — сводка: стоя, с бега, со спринта
//   jumpProbe({ run: 1, stop: 12 })            — остановиться через 12 кадров после нажатия (для снимка)
//   jumpProbe({ trace: true })                 — покадровая таблица
// Сводка: pre — кадры от нажатия до отрыва и глубина подседа, см; kneeOff — сгиб колен в момент отрыва, градусы
// (0 — нога прямая); toeOff — наклон стопы носком вниз в момент отрыва, градусы; tuck — наибольший сгиб колен в полёте;
// legApex — расстояние таз — голеностоп в верхней точке, доля длины ноги; kneeLand — сгиб колен в кадре касания;
// dip — наибольшая просадка таза после касания, см, и за сколько кадров; pelJerk — скачок скорости таза за кадр, м/с;
// armUp — высота кистей над плечами в верхней точке, см; under — стопа ниже покрытия, см; slide — скольжение стоп после касания, см.
window.jumpProbe = function jumpProbe(cfg = {}) {
  const c = { run: 0, stop: -1, trace: false, guard: false, ...cfg };
  const g = window.__game, rig = g.rig, B = rig.bones, w = g.world;
  const V = rig.root.position.constructor;
  const wp = (b) => b.getWorldPosition(new V());
  const deg = (x) => Math.round(x * 180 / Math.PI);
  const drive = (fn) => { const orig = g.input.fill; g.input.fill = function (out, e) { orig.call(this, out, e); Object.assign(out, fn()); }; try { g.manualFrame(1 / 60); } finally { g.input.fill = orig; } };
  g.manual = true; g.simPaused = false; g.timeScale = 1;
  g.resetSandbox('motor'); rig._cel = null;
  const p = w.player, b = w.ball;
  const park = () => { b.x = p.x - 9 * p.side; b.z = p.z + 7; b.y = 0.11; b.vx = b.vy = b.vz = 0; };
  const move = c.run ? { mx: -p.side, sprintHeld: c.run > 1 } : c.guard ? { guardHeld: true } : {};
  for (let i = 0; i < 70; i++) { park(); drive(() => move); }
  const base = { pel: wp(B.Hips).y, ankle: Math.min(wp(B.LeftFoot).y, wp(B.RightFoot).y) };
  const legLen = wp(B.LeftUpLeg).distanceTo(wp(B.LeftLeg)) + wp(B.LeftLeg).distanceTo(wp(B.LeftFoot));
  const out = { pre: 0, preDip: 0, kneeOff: null, toeOff: null, tuck: 0, legApex: null, kneeLand: null, dip: 0, dipAt: 0, pelJerk: 0, jerkAt: 0, armUp: null, under: 0, slide: 0, air: 0, apexCm: 0, pelTop: 0 };
  const trace = [];
  let offF = -1, landF = -1, prevPel = null, prevD = 0, prevFeet = null, apexF = -1, prevPy = 0;
  for (let f = 0; f < 110; f++) {
    park(); drive(() => ({ ...move, jumpPressed: f === 0 }));
    rig._cel = null;
    const hips = wp(B.Hips), an = [wp(B.LeftFoot), wp(B.RightFoot)], toe = [wp(B.LeftToeBase), wp(B.RightToeBase)];
    const knee = ['Left', 'Right'].map((n, i) => { const up = wp(B[n + 'UpLeg']), kn = wp(B[n + 'Leg']); const u = kn.clone().sub(up), v = an[i].clone().sub(kn); return deg(Math.acos(Math.max(-1, Math.min(1, u.dot(v) / (u.length() * v.length()))))); });
    const pitch = [0, 1].map((i) => deg(Math.atan2(an[i].y - toe[i].y, Math.hypot(toe[i].x - an[i].x, toe[i].z - an[i].z)))); // > 0 — носок ниже голеностопа
    const leg = ['Left', 'Right'].map((n, i) => +(wp(B[n + 'UpLeg']).distanceTo(an[i]) / legLen).toFixed(2));
    const hand = Math.max(wp(B.LeftHand).y, wp(B.RightHand).y) - Math.max(wp(B.LeftArm).y, wp(B.RightArm).y);
    const neck = wp(B.Neck), ax = neck.clone().sub(hips).normalize(), fw = new V(Math.cos(g.view.yaw), 0, Math.sin(g.view.yaw));
    const lean = deg(Math.atan2(ax.dot(fw), ax.y));
    const air = p.y > 0;
    if (air && offF < 0) { offF = f; out.pre = f; out.kneeOff = knee.join('/'); out.toeOff = pitch.join('/'); }
    if (offF < 0) out.preDip = Math.max(out.preDip, Math.round((base.pel - hips.y) * 100));
    if (air) { out.air++; out.tuck = Math.max(out.tuck, knee[0], knee[1]); out.apexCm = Math.max(out.apexCm, Math.round(p.y * 100)); out.pelTop = Math.max(out.pelTop, +(hips.y).toFixed(2)); }
    if (air && apexF < 0 && p.y < prevPy) { apexF = f; out.legApex = leg.join('/'); out.armUp = Math.round(hand * 100); out.kneeApex = knee.join('/'); }
    if (offF >= 0 && !air && landF < 0) { landF = f; out.kneeLand = knee.join('/'); }
    if (landF >= 0) {
      const d = Math.round((base.pel - hips.y) * 100);
      if (d > out.dip) { out.dip = d; out.dipAt = f - landF; }
      if (prevFeet) for (let i = 0; i < 2; i++) out.slide += Math.hypot(an[i].x - prevFeet[i].x, an[i].z - prevFeet[i].z) * 100 * (c.run ? 0 : 1);
      prevFeet = [an[0].clone(), an[1].clone()];
    }
    const dPel = prevPel === null ? 0 : hips.y - prevPel;
    if (prevPel !== null && f > 0) { const j = Math.round(Math.abs(dPel - prevD) * 60 * 10) / 10; if (j > out.pelJerk) { out.pelJerk = j; out.jerkAt = f; } }
    prevD = dPel; prevPel = hips.y; prevPy = p.y;
    out.under = Math.max(out.under, Math.round((base.ankle - Math.min(an[0].y, an[1].y)) * 100));
    if (c.trace) trace.push([f, 'py' + p.y.toFixed(2), 'pel' + (hips.y - p.y).toFixed(2), 'knee' + knee.join('/'), 'ank' + an.map((a) => (a.y - p.y).toFixed(2)).join('/'), 'toe' + pitch.join('/'), 'leg' + leg.join('/'), 'hand' + Math.round(hand * 100), 'lean' + lean].join(' '));
    if (c.stop === f) return { stopped: f, py: p.y };
    if (landF >= 0 && f > landF + 40) break;
  }
  out.slide = Math.round(out.slide);
  out.offF = offF; out.apexF = apexF; out.landF = landF;
  if (c.trace) out.trace = trace;
  return out;
};
