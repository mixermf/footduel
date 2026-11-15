// Проба выхода из удара (dev-сборка, /?menu=0&autopause=0): что происходит с ногой и телом после контакта.
//   followProbe({ hold: 40 })              — удар с места, после удара игрок ничего не нажимает
//   followProbe({ hold: 40, move: [1, 0] }) — сразу после контакта игрок бежит (mx, mz): тело должно перейти в бег без рывка
// Времена — секунды после контакта. Проба отвечает на вопросы «нога отдёргивается?» и «тело продолжает движение?»:
//   footPeak      — наибольшая высота голеностопа после контакта и когда она достигнута;
//   landAt        — когда бьющая стопа встала на покрытие; landAhead — насколько впереди корпуса по линии удара, м;
//   dropMax       — наибольшая скорость опускания голеностопа, м/с (резкий сброс ноги = большое число);
//   ankleAccMax   — наибольшее изменение скорости голеностопа за кадр, м/с (рывок);
//   bodyTravel    — сколько корпус прошёл вперёд по линии удара после контакта, м; bodySpeedAt — его скорость в разные моменты;
//   settleAt      — когда поза удара полностью отпущена (вес клипа в ноге < 0,05);
//   turnAfter     — доворот корпуса после контакта, градусы.
window.followProbe = function followProbe(cfg = {}) {
  const c = { hold: 40, scenario: 'free', wait: 40, move: null, secs: 1.2, ...cfg };
  const g = window.__game, rig = g.rig, B = rig.bones, w = g.world;
  const V = rig.root.position.constructor;
  const wp = (b) => b.getWorldPosition(new V());
  g.manual = true; g.simPaused = false; g.timeScale = 1;
  g.resetSandbox(c.scenario); rig._cel = null;
  let hit = false, input = {};
  const drive = () => { const orig = g.input.fill; g.input.fill = function (out, e) { orig.call(this, out, e); Object.assign(out, input); }; try { g.manualFrame(1 / 60); } finally { g.input.fill = orig; } };
  for (let i = 0; i < c.wait; i++) drive();
  const p = w.player, rows = [];
  let kd = null, side = 1, hitF = -1, yawHit = 0, posHit = null;
  for (let f = 0; f < c.hold + 60 + Math.round(c.secs * 60); f++) {
    input = hit && c.move ? { mx: c.move[0], mz: c.move[1], digital: false } : { kickHeld: f < c.hold, kickPressed: f === 0 };
    drive(); rig._cel = null;
    const k = p.kick;
    if (k) { kd = { ax: k.ax, az: k.az }; side = k.footSide; }
    if (k && k.phase === 'curl' && !hit) { hit = true; hitF = f; yawHit = p.yaw; posHit = { x: p.x, z: p.z }; }
    if (!hit) continue;
    const n = side > 0 ? 'Right' : 'Left', an = wp(B[n + 'Foot']), ft = p.feet[side > 0 ? 1 : 0];
    rows.push({ t: (f - hitF) / 60, an, rel: new V(an.x - g.view.px, an.y - g.view.py, an.z - g.view.pz), planted: ft.planted, simH: ft.h,
      ahead: (ft.x - p.x) * kd.ax + (ft.z - p.z) * kd.az, travel: (p.x - posHit.x) * kd.ax + (p.z - posHit.z) * kd.az, speed: Math.hypot(p.vx, p.vz),
      legK: rig.sp.kLeg ? rig.sp.kLeg.x : 0, wKick: rig.sp.wKick ? rig.sp.wKick.x : 0, yaw: p.yaw, hipY: rig.diag.pelvisY, phase: k ? k.phase : '-' });
    if (rows.length >= Math.round(c.secs * 60)) break;
  }
  if (!hit) return { error: 'удара не было' };
  const r2 = (x) => Math.round(x * 100) / 100;
  const sp = rows.map((r, i) => (i ? r.rel.distanceTo(rows[i - 1].rel) * 60 : 0));
  const vy = rows.map((r, i) => (i ? (r.rel.y - rows[i - 1].rel.y) * 60 : 0));
  let peak = rows[0], land = null, acc = 0, accAt = 0, settle = null;
  rows.forEach((r, i) => {
    if (r.rel.y > peak.rel.y) peak = r;
    if (!land && i > 2 && r.planted) land = r;
    if (i > 1) { const a = Math.abs(sp[i] - sp[i - 1]); if (a > acc) { acc = a; accAt = r.t; } }
    if (settle === null && r.t > 0.1 && r.legK < 0.05 && r.wKick < 0.05) settle = r.t;
  });
  const at = (t) => rows[Math.min(rows.length - 1, Math.round(t * 60))];
  let dyaw = rows[rows.length - 1].yaw - yawHit; if (dyaw > Math.PI) dyaw -= 2 * Math.PI; if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
  return { footPeak: { h: r2(peak.rel.y), at: r2(peak.t) }, landAt: land ? r2(land.t) : null, landAhead: land ? r2(land.ahead) : null,
    dropMax: r2(-Math.min(...vy)), ankleAccMax: r2(acc), ankleAccAt: r2(accAt),
    bodyTravel: r2(rows[rows.length - 1].travel), bodySpeedAt: { '0.1': r2(at(0.1).speed), '0.3': r2(at(0.3).speed), '0.6': r2(at(0.6).speed) },
    settleAt: settle, turnAfter: Math.round(dyaw * side * -180 / Math.PI), kickEndsAt: r2((rows.find((r) => r.phase === '-') || { t: 0 }).t),
    trace: rows.filter((_, i) => i % 6 === 0).map((r) => `${r2(r.t)}:h${r2(r.rel.y)} ${r.planted ? 'P' : 's'} v${r2(r.speed)}`).join(' ') };
};
