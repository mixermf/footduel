// Проба ног в манёврах без мяча (dev-сборка, /?menu=0&autopause=0): развороты, бег спиной, стойка.
//   moveJointSweep() — таблица по манёврам; moveJointProbe(steps) — свой сценарий: [[кадров, ввод], ...]
// Что считается «сломанными ногами»:
//   back      — кадры, где колено позади линии бедро — стопа относительно таза (и на сколько см);
//   flip      — наибольший поворот колена вокруг этой линии за кадр, градусы;
//   cross     — кадры, где стопы перекрещены (левая правее правой в осях таза больше чем на 5 см);
//   reach     — наибольший недотяг голеностопа до точки стопы, см (нога «резиновая»);
//   twist     — наибольший разворот опорной стопы относительно таза, градусы (скручивание голени);
//   backSpeed — наибольшая скорость движения спиной вперёд, м/с; backTime — сколько секунд она выше 1,5 м/с;
//   slip      — наибольший сдвиг опорной стопы за кадр, см.
window.moveJointProbe = function moveJointProbe(steps, opt = {}) {
  const g = window.__game, rig = g.rig, B = rig.bones, w = g.world;
  const V = rig.root.position.constructor, Q = B.Hips.quaternion.constructor;
  const wp = (b) => b.getWorldPosition(new V());
  g.manual = true; g.simPaused = false; g.timeScale = 1;
  g.resetSandbox('motor');
  const p = w.player;
  { const dx = (opt.startX ?? -6) - p.x; p.x += dx; for (const f of p.feet) f.x += dx; }
  if (opt.ball) { w.ball.x = opt.ball[0]; w.ball.z = opt.ball[1]; }
  const ballPin = opt.ball || [7, 4];
  let input = {};
  const drive = () => {
    const b = w.ball; b.x = ballPin[0]; b.z = ballPin[1]; b.y = w.P.ball.radius; b.vx = b.vy = b.vz = 0;
    const orig = g.input.fill; g.input.fill = function (out, e) { orig.call(this, out, e); Object.assign(out, { digital: false, mx: 0, mz: 0 }, input); };
    try { g.manualFrame(1 / 60); } finally { g.input.fill = orig; }
  };
  const out = { frames: 0, backFrames: 0, backWorstCm: 0, flipMaxDeg: 0, crossFrames: 0, reachCm: 0, twistDeg: 0, backSpeed: 0, backTime: 0, slipCm: 0, kneeMax: 0, speedMax: 0 };
  const prev = [null, null], prevToe = [null, null];
  let skip = opt.warm ?? 0;
  for (const [n, inp] of steps) {
    input = inp;
    for (let i = 0; i < n; i++) {
      drive();
      if (skip-- > 0) continue;
      out.frames++;
      const v = g.view, fw = new V(Math.cos(v.yaw), 0, Math.sin(v.yaw)), rt = new V(-fw.z, 0, fw.x);
      const pf = new V(rig.F0.x, 0, rig.F0.z).applyQuaternion(B.Hips.getWorldQuaternion(new Q()).multiply(rig.rest.Hips.q.clone().invert()));
      const pr = new V(-pf.z, 0, pf.x);
      const sp = Math.hypot(p.vx, p.vz), bs = -(p.vx * fw.x + p.vz * fw.z);
      out.speedMax = Math.max(out.speedMax, sp); out.backSpeed = Math.max(out.backSpeed, bs); if (bs > 1.5) out.backTime += 1 / 60;
      const ank = [];
      ['Left', 'Right'].forEach((nm, k) => {
        const up = wp(B[nm + 'UpLeg']), kn = wp(B[nm + 'Leg']), an = wp(B[nm + 'Foot']), toe = wp(B[nm + 'ToeBase']);
        ank.push(an);
        const d = an.clone().sub(up).normalize(), off = kn.clone().sub(up); off.addScaledVector(d, -off.dot(d));
        const back = off.dot(pf);
        if (back < -0.03) { out.backFrames++; out.backWorstCm = Math.min(out.backWorstCm, Math.round(back * 100)); }
        const big = off.length() > 0.05, dk = off.clone().normalize();
        if (prev[k] && big) out.flipMaxDeg = Math.max(out.flipMaxDeg, Math.round(Math.acos(Math.max(-1, Math.min(1, dk.dot(prev[k])))) * 180 / Math.PI));
        prev[k] = big ? dk : null;
        const u = up.clone().sub(kn), s2 = an.clone().sub(kn);
        out.kneeMax = Math.max(out.kneeMax, Math.round(180 - Math.acos(Math.max(-1, Math.min(1, u.dot(s2) / (u.length() * s2.length())))) * 180 / Math.PI));
        const ft = v.feet[k];
        if (ft.planted) {
          const fd = toe.clone().sub(an); fd.y = 0; fd.normalize();
          out.twistDeg = Math.max(out.twistDeg, Math.round(Math.abs(Math.atan2(fd.dot(pr), fd.dot(pf))) * 180 / Math.PI));
          if (prevToe[k]) out.slipCm = Math.max(out.slipCm, Math.round(Math.hypot(toe.x - prevToe[k].x, toe.z - prevToe[k].z) * 1000) / 10);
          prevToe[k] = toe;
        } else prevToe[k] = null;
      });
      if ((ank[0].x - ank[1].x) * pr.x + (ank[0].z - ank[1].z) * pr.z > 0.05) out.crossFrames++;
      out.reachCm = Math.max(out.reachCm, Math.round(Math.max(rig.diag.reachErr[0], rig.diag.reachErr[1]) * 1000) / 10);
    }
  }
  out.backTime = Math.round(out.backTime * 100) / 100; out.backSpeed = Math.round(out.backSpeed * 100) / 100; out.speedMax = Math.round(out.speedMax * 100) / 100;
  return out;
};

// манёвры: имя → шаги [кадров, ввод]; опции — где стоит мяч (для стойки лицом к мячу)
window.MOVE_CASES = {
  'бег вперёд (эталон)': [[[90, { mx: 1 }]], { warm: 40 }],
  'разворот на бегу 180°': [[[70, { mx: 1 }], [50, { mx: -1 }]], { warm: 60 }],
  'разворот на спринте 180°': [[[80, { mx: 1, sprintHeld: true }], [50, { mx: -1, sprintHeld: true }]], { warm: 70 }],
  'разворот на бегу 135°': [[[70, { mx: 1 }], [50, { mx: -0.7, mz: 0.7 }]], { warm: 60 }],
  'поворот на бегу 90°': [[[70, { mx: 1 }], [50, { mz: 1 }]], { warm: 60 }],
  'стойка: отход спиной от мяча': [[[20, { guardHeld: true }], [90, { guardHeld: true, mx: -1 }]], { ball: [0, 0], startX: -2, warm: 30 }],
  'стойка: вбок': [[[20, { guardHeld: true }], [90, { guardHeld: true, mz: 1 }]], { ball: [0, 0], startX: -3, warm: 30 }],
  'бег от мяча → стойка (разворот к мячу)': [[[60, { mx: -1 }], [50, { mx: -1, guardHeld: true }]], { ball: [0, 0], startX: -2, warm: 50 }],
  'спринт от мяча → стойка': [[[70, { mx: -1, sprintHeld: true }], [50, { mx: -1, guardHeld: true }]], { ball: [0, 0], startX: -1.5, warm: 60 }],
};
window.moveJointSweep = function moveJointSweep() {
  return Object.entries(window.MOVE_CASES).map(([name, [steps, opt]]) => {
    const r = window.moveJointProbe(steps, opt);
    return `${name}: back ${r.backFrames}к/${r.backWorstCm}см flip ${r.flipMaxDeg} cross ${r.crossFrames} reach ${r.reachCm} twist ${r.twistDeg} slip ${r.slipCm} kneeMax ${r.kneeMax} | спиной ${r.backSpeed} м/с, ${r.backTime} с`;
  });
};
