// Slide tackle probe (dev build, /?menu=0&autopause=0):  slideProbe()  — run-up, then the tackle
// Summary at the lowest point: pelvis / chest / head heights, m; tilt — torso lean back from vertical, deg; roll — torso roll
// onto the side, deg; lead — the smallest knee bend of the leading leg during the slide, trail — the trailing knee, deg; hands — heights of the hand on the
// turf side and of the other one, m; down / up — seconds from the start to the lowest point and from there back to standing.
// stop: n — stop n frames after the tackle starts (for a screenshot).
window.slideProbe = function slideProbe(cfg = {}) {
  const c = { run: 40, frames: 80, mx: 1, stop: -1, ...cfg };
  const g = window.__game, rig = g.rig, B = rig.bones, w = g.world;
  const V = rig.root.position.constructor, wp = (b) => b.getWorldPosition(new V());
  const ang = (a, b, d) => { const u = a.clone().sub(b), q = d.clone().sub(b); return Math.acos(Math.max(-1, Math.min(1, u.dot(q) / (u.length() * q.length())))) * 180 / Math.PI; };
  g.manual = true; g.simPaused = false; g.timeScale = 1;
  g.resetSandbox('motor'); rig._cel = null;
  const p = w.player;
  const orig = g.input.fill; let press = false, mx = c.mx;
  g.input.fill = function (out, e) { orig.call(this, out, e); out.mx = mx; out.mz = 0; out.digital = false; out.lobPressed = press; };
  const rows = [];
  try {
    for (let f = 0; f < c.run; f++) { w.ball.x = p.x + 2.2; w.ball.z = p.z + 0.25; w.ball.vx = w.ball.vz = 0; g.manualFrame(1 / 60); }
    for (let f = 0; f < c.frames; f++) {
      press = f === 0; if (f > 4) mx = 0;
      g.manualFrame(1 / 60); rig._cel = null;
      const v = g.view, fx = Math.cos(v.yaw), fz = Math.sin(v.yaw), rx = -fz, rz = fx;
      const hips = wp(B.Hips), neck = wp(B.Neck), head = wp(B.Head), ch = wp(B.Spine2), S = p.slide;
      const knee = (k) => { const n = k ? 'Right' : 'Left'; return 180 - ang(wp(B[n + 'UpLeg']), wp(B[n + 'Leg']), wp(B[n + 'Foot'])); };
      const lead = S ? S.foot : (rows.length ? rows[rows.length - 1].leadI : 1);
      const hl = wp(B.LeftHand).y, hr = wp(B.RightHand).y;
      rows.push({ f, slide: !!S, leadI: lead, hip: hips.y, chest: ch.y, head: head.y,
        tilt: -Math.atan2((neck.x - hips.x) * fx + (neck.z - hips.z) * fz, neck.y - hips.y) * 180 / Math.PI,
        roll: Math.atan2((neck.x - hips.x) * rx + (neck.z - hips.z) * rz, neck.y - hips.y) * 180 / Math.PI,
        lead: knee(lead), trail: knee(1 - lead), low: Math.min(hl, hr), high: Math.max(hl, hr), tk: wp(B[(lead ? 'Left' : 'Right') + 'Leg']), hipP: hips });
      if (c.stop === f) return { stopped: f };
    }
  } finally { g.input.fill = orig; }
  const r2 = (x) => Math.round(x * 100) / 100, sl = rows.filter((r) => r.slide);
  if (!sl.length) return { note: 'no slide' };
  const lo = sl.reduce((a, b) => (b.hip < a.hip ? b : a)), up = rows.find((r) => r.f > lo.f && r.hip > 0.9);
  // the tucked knee: its height at the lowest point and the largest jump of its position relative to the pelvis in one frame, cm
  let jump = 0; for (let i = 1; i < rows.length; i++) { const a = rows[i - 1], b = rows[i]; jump = Math.max(jump, Math.hypot((b.tk.x - b.hipP.x) - (a.tk.x - a.hipP.x), (b.tk.y - b.hipP.y) - (a.tk.y - a.hipP.y), (b.tk.z - b.hipP.z) - (a.tk.z - a.hipP.z))); }
  let bendJump = 0; for (let i = 1; i < rows.length; i++) bendJump = Math.max(bendJump, Math.abs(rows[i].trail - rows[i - 1].trail));
  return { frames: sl.length, tuckKneeY: r2(lo.tk.y), tuckKneeJumpCm: Math.round(jump * 100), tuckBendJumpDeg: Math.round(bendJump), pelvis: r2(lo.hip), chest: r2(lo.chest), head: r2(lo.head), tilt: Math.round(lo.tilt), roll: Math.round(lo.roll),
    lead: Math.round(Math.min(...sl.map((r) => r.lead))), trail: Math.round(lo.trail), hands: [r2(lo.low), r2(lo.high)], down: r2(lo.f / 60), up: up ? r2((up.f - lo.f) / 60) : null };
};
