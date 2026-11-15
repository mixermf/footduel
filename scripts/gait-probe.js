// Проба походки для лаборатории (dev-сборка, адрес /?menu=0&autopause=0).
// Вставляется в консоль или выполняется автотестом; затем: gaitProbe({ scenario: 'motor', mx: 0.5, secs: 3 }).
// Кадры подаются вручную с шагом 1/60 с, поэтому числа повторяются от запуска к запуску.
// Меряет то, что видит глаз: каденс, длину шага, долю опоры и полёта, скольжение опорной стопы по костям после IK,
// ход таза и головы по вертикали, углы колена, размах рук, рывки (кадр быстрее соседних в разы).
window.gaitProbe = function gaitProbe(cfg = {}) {
  const g = window.__game, rig = g.rig, B = rig.bones;
  const V = rig.root.position.constructor;
  const c = { scenario: 'motor', mx: 1, mz: 0, control: false, sprint: false, secs: 3, warm: 1, fps: 60, startX: -8.5, ...cfg };
  g.manual = true; g.simPaused = false; g.timeScale = 1;
  g.resetSandbox(c.scenario);
  // песочница держит игрока на своей половине: старт от дальнего борта даёт около 8 м прямой
  { const p = g.world.player, dx = c.startX - p.x; p.x += dx; for (const f of p.feet) f.x += dx; }
  const orig = g.input.fill;
  g.input.fill = function (out, e) { orig.call(this, out, e); out.mx = c.mx; out.mz = c.mz; out.digital = false; out.controlHeld = c.control; out.sprintHeld = c.sprint; };
  const dt = 1 / c.fps, N = Math.round(c.secs * c.fps), W = Math.round(c.warm * c.fps);
  const wp = (b) => b.getWorldPosition(new V());
  const ang = (a, b, d) => { const u = a.clone().sub(b), w = d.clone().sub(b); return Math.acos(Math.max(-1, Math.min(1, u.dot(w) / (u.length() * w.length())))) * 180 / Math.PI; };
  const rows = [];
  try {
    for (let i = 0; i < N + W; i++) {
      // «без мяча»: песочница сама возвращает мяч игроку — держим его в дальнем углу
      if (c.scenario === 'motor') { const b = g.world.ball; b.x = 7; b.z = 4; b.y = g.world.P.ball.radius; b.vx = b.vy = b.vz = 0; }
      g.manualFrame(dt);
      if (i < W) continue;
      const p = g.world.player, v = g.view;
      const fx = Math.cos(v.yaw), fz = Math.sin(v.yaw);
      const hips = wp(B.Hips), head = wp(B.Head);
      const row = { t: (i - W) * dt, speed: Math.hypot(p.vx, p.vz), gp: v.gp, px: v.px, pz: v.pz, hipY: hips.y, headY: head.y,
        hipF: (hips.x - v.px) * fx + (hips.z - v.pz) * fz, reach: Math.max(rig.diag.reachErr[0], rig.diag.reachErr[1]), legs: [], hands: [] };
      ['Left', 'Right'].forEach((n, k) => {
        const up = wp(B[n + 'UpLeg']), kn = wp(B[n + 'Leg']), an = wp(B[n + 'Foot']), toe = wp(B[n + 'ToeBase']);
        const ft = v.feet[k];
        row.legs.push({ planted: ft.planted, knee: 180 - ang(up, kn, an), toe, ankleY: an.y, h: ft.h, pitch: rig.diag.pitch[k],
          fwd: (an.x - v.px) * fx + (an.z - v.pz) * fz, fx: ft.x, fz: ft.z });
        const hand = wp(B[n + 'Hand']), sh = wp(B[n + 'Arm']), el = wp(B[n + 'ForeArm']);
        row.hands.push({ fwd: (hand.x - sh.x) * fx + (hand.z - sh.z) * fz, y: hand.y, elbow: 180 - ang(sh, el, hand), p: hand });
      });
      rows.push(row);
    }
  } finally { g.input.fill = orig; }

  const r2 = (x) => Math.round(x * 100) / 100, cm = (x) => Math.round(x * 1000) / 10;
  const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { min: s[0], max: s[s.length - 1], med: s[s.length >> 1], mean: a.reduce((x, y) => x + y, 0) / a.length }; };
  const speed = stat(rows.map((r) => r.speed)).mean;
  // постановки стоп: переход мах → опора
  const strikes = [];
  for (let i = 1; i < rows.length; i++) for (let k = 0; k < 2; k++) {
    if (rows[i].legs[k].planted && !rows[i - 1].legs[k].planted) strikes.push({ i, k, t: rows[i].t, x: rows[i].legs[k].fx, z: rows[i].legs[k].fz, knee: rows[i].legs[k].knee, pitch: rows[i].legs[k].pitch, fwd: rows[i].legs[k].fwd });
  }
  const stepT = [], stepL = [];
  for (let i = 1; i < strikes.length; i++) { stepT.push(strikes[i].t - strikes[i - 1].t); stepL.push(Math.hypot(strikes[i].x - strikes[i - 1].x, strikes[i].z - strikes[i - 1].z)); }
  const n = rows.length;
  const duty = [0, 1].map((k) => rows.filter((r) => r.legs[k].planted).length / n);
  const flight = rows.filter((r) => !r.legs[0].planted && !r.legs[1].planted).length / n;
  const dbl = rows.filter((r) => r.legs[0].planted && r.legs[1].planted).length / n;
  // скольжение опоры: путь носка за одну опору (кость после IK), пока стопа стоит плоско
  let slipFrame = 0; const slipStance = []; let soleErr = 0;
  for (let k = 0; k < 2; k++) {
    let start = null, acc = 0;
    for (let i = 1; i < n; i++) {
      const a = rows[i - 1].legs[k], b = rows[i].legs[k];
      if (a.planted && b.planted) {
        const d = Math.hypot(b.toe.x - a.toe.x, b.toe.z - a.toe.z);
        slipFrame = Math.max(slipFrame, d); acc += d; start = start ?? i;
        if (b.pitch >= 0) soleErr = Math.max(soleErr, Math.abs(b.toe.y - rig.legs[k].toeH));
      } else if (start !== null) { slipStance.push(acc); start = null; acc = 0; }
    }
  }
  // рывки: скорость точки относительно корня; кадр быстрее медианы соседей
  const pop = (get) => {
    const sp = [];
    for (let i = 1; i < n; i++) { const a = get(rows[i - 1]), b = get(rows[i]); sp.push(Math.hypot(b.x - a.x - (rows[i].px - rows[i - 1].px), b.y - a.y, b.z - a.z - (rows[i].pz - rows[i - 1].pz)) / dt); }
    let worst = 0, at = 0;
    for (let i = 2; i < sp.length - 2; i++) { const nb = (sp[i - 2] + sp[i - 1] + sp[i + 1] + sp[i + 2]) / 4; const ratio = sp[i] / Math.max(0.3, nb); if (ratio > worst) { worst = ratio; at = rows[i + 1].t; } }
    return { max: r2(Math.max(...sp)), ratio: r2(worst), at: r2(at) };
  };
  // фаза нижней точки таза относительно постановки стопы (доля шага): ходьба ≈ 0 (двойная опора), бег ≈ 0,3–0,45 (середина опоры)
  const lowPh = [];
  for (let s = 0; s + 1 < strikes.length; s++) {
    let lo = Infinity, li = strikes[s].i;
    for (let i = strikes[s].i; i < strikes[s + 1].i; i++) if (rows[i].hipY < lo) { lo = rows[i].hipY; li = i; }
    lowPh.push((li - strikes[s].i) / Math.max(1, strikes[s + 1].i - strikes[s].i));
  }
  const kneeAll = stat(rows.flatMap((r) => r.legs.map((l) => l.knee)));
  const kneeStance = stat(rows.flatMap((r) => r.legs.filter((l) => l.planted).map((l) => l.knee)));
  const kneeSwing = stat(rows.flatMap((r) => r.legs.filter((l) => !l.planted).map((l) => l.knee)).concat([0]));
  const hip = stat(rows.map((r) => r.hipY)), head = stat(rows.map((r) => r.headY)), hipF = stat(rows.map((r) => r.hipF));
  const handF = [0, 1].map((k) => stat(rows.map((r) => r.hands[k].fwd)));
  const elbow = stat(rows.flatMap((r) => r.hands.map((h) => h.elbow)));
  const lift = stat(rows.flatMap((r) => r.legs.map((l) => l.h)));
  const fwd = stat(rows.flatMap((r) => r.legs.map((l) => l.fwd)));
  const stT = stepT.length ? stat(stepT) : { mean: 0, min: 0, max: 0 }, stL = stepL.length ? stat(stepL) : { mean: 0, min: 0, max: 0 };
  const P = g.world.P, T = Math.min(0.38, Math.max(0.27, 0.40 - 0.025 * speed));
  return {
    cfg: c, speed: r2(speed), mode: g.world.player.mode, possession: !!g.world.player.possession,
    stepTime: r2(stT.mean), stepTimeSpread: r2(stT.max - stT.min), cadencePerMin: stT.mean ? Math.round(60 / stT.mean) : 0,
    stepLen: r2(stL.mean), stepLenSpread: r2(stL.max - stL.min),
    duty: duty.map(r2), doubleSupport: r2(dbl), flight: r2(flight),
    strike: { kneeDeg: r2(stat(strikes.map((s) => s.knee).concat([0])).mean), pitch: r2(stat(strikes.map((s) => s.pitch).concat([0])).mean), aheadOfPelvis: r2(stat(strikes.map((s) => s.fwd).concat([0])).mean) },
    footReach: { back: r2(fwd.min), front: r2(fwd.max) }, footLift: r2(lift.max),
    kneeDeg: { stanceMin: r2(kneeStance.min), stanceMax: r2(kneeStance.max), swingMax: r2(kneeSwing.max), all: [r2(kneeAll.min), r2(kneeAll.max)] },
    slipCmPerFrame: cm(slipFrame), slipCmPerStance: slipStance.length ? cm(stat(slipStance).max) : 0, soleErrCm: cm(soleErr), reachMissCm: cm(Math.max(...rows.map((r) => r.reach))),
    pelvisBobCm: cm(hip.max - hip.min), pelvisMeanPct: Math.round(100 * hip.mean / rig.hipRestY), pelvisLowAtStepPhase: r2(lowPh.length ? stat(lowPh).mean : 0),
    pelvisForeAftCm: [cm(hipF.min), cm(hipF.max)], headBobCm: cm(head.max - head.min),
    handSwingCm: handF.map((h) => [cm(h.min), cm(h.max)]), elbowDeg: [r2(elbow.min), r2(elbow.max)],
    pops: { ankleL: pop((r) => ({ x: r.legs[0].toe.x, y: r.legs[0].toe.y, z: r.legs[0].toe.z })), handL: pop((r) => r.hands[0].p), handR: pop((r) => r.hands[1].p), hips: pop((r) => ({ x: r.px + 0, y: r.hipY, z: r.pz + 0 })) },
    clipRate: r2(0.8333 / (2 * T * (g.world.player.possession ? 0.9 : 1))), profile: P.version,
  };
};
