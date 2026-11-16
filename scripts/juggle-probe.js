// Проба чеканки (dev-сборка, /?menu=0&autopause=0):  juggleProbe()   — подброс с места и серия подбивов
// Сводка: touches — число подбивов; у бьющей ноги в момент касания: knee — сгиб колена, ° (0 — прямая), fwd — вынос голеностопа
// вперёд от таза, м, y — высота голеностопа, м; kneeMax — наибольший сгиб бьющего колена за серию, °;
// support — сгиб опорного колена, ° (мин/макс); bob — ход таза по вертикали, см; lean — наклон корпуса, ° (мин/макс, < 0 — назад);
// hands — ход кистей по вертикали, см; ballTop — верхняя точка мяча, м; period — время между подбивами, с.
// trace: true — покадровые строки.
window.juggleProbe = function juggleProbe(cfg = {}) {
  const c = { frames: 330, trace: false, ...cfg };
  const g = window.__game, rig = g.rig, B = rig.bones, w = g.world;
  const V = rig.root.position.constructor, wp = (b) => b.getWorldPosition(new V());
  const ang = (a, b, d) => { const u = a.clone().sub(b), q = d.clone().sub(b); return Math.acos(Math.max(-1, Math.min(1, u.dot(q) / (u.length() * q.length())))) * 180 / Math.PI; };
  g.manual = true; g.simPaused = false; g.timeScale = 1;
  g.resetSandbox('free'); rig._cel = null;
  const p = w.player, b = w.ball;
  const orig = g.input.fill; let press = false;
  g.input.fill = function (out, e) { orig.call(this, out, e); out.mx = 0; out.mz = 0; out.jumpPressed = press; };
  const st = w.step.bind(w); let touched = 0, ended = false;
  w.step = (...a) => { st(...a); for (const e of w.events) { if (e.type === 'touch' && e.kind === 'juggle') touched++; if (e.type === 'juggle_end') ended = true; } };
  const rows = [], hits = [];
  const knee = (k) => { const n = k ? 'Right' : 'Left'; return 180 - ang(wp(B[n + 'UpLeg']), wp(B[n + 'Leg']), wp(B[n + 'Foot'])); };
  try {
    for (let f = 0; f < 20; f++) g.manualFrame(1 / 60);
    for (let f = 0; f < c.frames; f++) {
      press = f === 0; const before = touched, side = p.juggle ? p.juggle.side : 0;
      g.manualFrame(1 / 60); rig._cel = null;
      const v = g.view, fx = Math.cos(v.yaw), fz = Math.sin(v.yaw), hips = wp(B.Hips), neck = wp(B.Neck);
      const k = [knee(0), knee(1)], an = [wp(B.LeftFoot), wp(B.RightFoot)], hd = [wp(B.LeftHand), wp(B.RightHand)];
      const work = p.juggle ? (p.juggle.side > 0 ? 1 : 0) : -1;
      rows.push({ f, jug: !!p.juggle, work, k, hipY: hips.y, lean: Math.atan2((neck.x - hips.x) * fx + (neck.z - hips.z) * fz, neck.y - hips.y) * 180 / Math.PI, hy: [hd[0].y, hd[1].y], by: b.y,
        fwd: an.map((a) => (a.x - hips.x) * fx + (a.z - hips.z) * fz), ay: an.map((a) => a.y) });
      if (touched > before) { const i = side > 0 ? 1 : 0; hits.push({ f, foot: i, knee: Math.round(k[i]), fwd: +rows[rows.length - 1].fwd[i].toFixed(2), y: +an[i].y.toFixed(2) }); }
    }
  } finally { g.input.fill = orig; w.step = st; }
  const js = rows.filter((r) => r.jug && r.f > 40), r1 = (x) => Math.round(x * 10) / 10, mm = (a) => [r1(Math.min(...a)), r1(Math.max(...a))];
  if (!js.length) return { touches: touched, ended, note: 'чеканка не началась' };
  const per = []; for (let i = 1; i < hits.length; i++) per.push((hits[i].f - hits[i - 1].f) / 60);
  const out = {
    touches: touched, ended, period: r1(per.reduce((s, x) => s + x, 0) / Math.max(1, per.length) * 10) / 10,
    atTouch: hits.slice(1, 7), kneeMax: r1(Math.max(...js.map((r) => Math.max(r.k[0], r.k[1])))),
    support: mm(js.filter((r) => r.work >= 0).map((r) => r.k[1 - r.work])), bob: r1((Math.max(...js.map((r) => r.hipY)) - Math.min(...js.map((r) => r.hipY))) * 100),
    lean: mm(js.map((r) => r.lean)), hands: r1((Math.max(...js.flatMap((r) => r.hy)) - Math.min(...js.flatMap((r) => r.hy))) * 100), ballTop: r1(Math.max(...js.map((r) => r.by)) * 10) / 10,
  };
  if (c.trace) out.rows = rows.map((r) => [r.f, r.work, r.k.map(Math.round).join('/'), r.fwd.map((x) => x.toFixed(2)).join('/'), r.ay.map((x) => x.toFixed(2)).join('/'), r.hipY.toFixed(2), r.by.toFixed(2)].join(' '));
  return out;
};
