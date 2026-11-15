// Проба удара через себя (dev-сборка, /?menu=0&autopause=0):
//   bikeProbe({ h: 2.4, dx: 0, dz: 0.05 })           — сводка по удару, падению и подъёму
//   bikeProbe({ h: 2.4, stop: 'hit' | 'lead' | 'down' | 'rise', after: 0 }) — остановиться на кадре (для снимка)
// h — высота мяча над полем, dx/dz — смещение мяча от игрока вдоль поля и вбок, м.
// Суставы: knee — наибольший сгиб колена (180° — нога сложена пополам, анатомический предел ~150°);
// hyper — кадры, где колено разогнуто «в обратную сторону» относительно корпуса; flip — рывок колена за кадр, градусы;
// reachCm — недотяг стопы; scissor — наибольшая разность высот стоп до контакта и после (ножницы), м;
// tiltHit — наклон корпуса назад в момент контакта, градусы; lie — наименьшая высота таза, м; upSec — время от приземления до стойки.
window.bikeProbe = function bikeProbe(cfg = {}) {
  const c = { h: 2.4, dx: 0, dz: 0.05, hold: 40, stop: null, after: 0, fly: false, vx: 0, ...cfg }; // fly: face the goal (flying side volley), vx: ball speed toward the player
  const g = window.__game, rig = g.rig, B = rig.bones, w = g.world;
  const V = rig.root.position.constructor;
  const wp = (b) => b.getWorldPosition(new V());
  const deg = (x) => Math.round(x * 180 / Math.PI);
  const drive = (fn) => { const orig = g.input.fill; g.input.fill = function (out, e) { orig.call(this, out, e); Object.assign(out, fn()); }; try { g.manualFrame(1 / 60); } finally { g.input.fill = orig; } };
  g.manual = true; g.simPaused = false; g.timeScale = 1;
  g.resetSandbox('motor'); rig._cel = null;
  const p = w.player, b = w.ball;
  if (!c.fly) for (let i = 0; i < 45; i++) drive(() => ({ mx: -1 }));
  for (let i = 0; i < 30; i++) drive(() => ({}));
  b.x = p.x + c.dx; b.z = p.z + c.dz; b.y = c.h; b.vx = -c.vx; b.vy = b.vz = 0;
  const out = { kicked: false, bike: false, kneeMax: 0, hyper: 0, flip: 0, reachCm: 0, scissorPre: 0, scissorPost: 0, tiltHit: null, tiltMax: 0, rollMax: 0, lie: 9, jumpCm: 0, frames: 0, upSec: null, legMin: 9, phases: '' };
  const prev = [null, null]; const trace = []; let pelPrev = null, footPrev = null;
  out.sink = 0; out.pelJerk = 0; out.footSlide = 0; out.headMin = 9;
  let hitF = -1, landF = -1, upF = -1, stopLeft = -1, lastPh = '';
  for (let f = 0; f < 260; f++) {
    drive(() => ({ kickHeld: f < c.hold, kickPressed: f === 0 }));
    rig._cel = null;
    const k = p.kick, fl = p.fall;
    if (k && (k.bike || k.fly)) out.bike = true;
    const ph = k ? k.phase : fl ? 'fall:' + fl.phase : '';
    if (ph !== lastPh) { out.phases += (out.phases ? ' ' : '') + ph + '@' + f; lastPh = ph; }
    if (k && k.phase === 'curl' && hitF < 0) { hitF = f; out.kicked = true; }
    const active = (k && (k.bike || k.fly || c.fly) && k.phase !== 'charge' && k.phase !== 'ready') || fl || (hitF >= 0 && upF < 0);
    if (hitF >= 0 && landF < 0 && p.y <= 0) landF = f;
    if (landF >= 0 && upF < 0 && !fl && !k) { upF = f; out.upSec = Math.round((upF - landF) / 60 * 100) / 100; }
    if (active) {
      out.frames++;
      out.jumpCm = Math.max(out.jumpCm, Math.round(p.y * 100));
      const hips = wp(B.Hips), neck = wp(B.Neck), ax = neck.clone().sub(hips).normalize();
      const fw = new V(Math.cos(g.view.yaw), 0, Math.sin(g.view.yaw)), rt = new V(-fw.z, 0, fw.x);
      const tilt = c.fly ? deg(Math.acos(Math.max(-1, Math.min(1, ax.y)))) : deg(Math.atan2(-ax.dot(fw), ax.y)), roll = deg(Math.asin(Math.max(-1, Math.min(1, ax.dot(rt)))));
      out.tiltMax = Math.max(out.tiltMax, tilt); out.rollMax = Math.max(out.rollMax, Math.abs(roll));
      if (f === hitF) out.tiltHit = tilt;
      out.lie = Math.min(out.lie, Math.round((hips.y - g.view.py) * 100) / 100);
      // «вперёд» для колена — по корпусу: ось таз — шея и поперечная ось таза задают плоскость тела
      const hl = wp(B.LeftUpLeg), hr = wp(B.RightUpLeg), across = hr.clone().sub(hl).normalize(), front = new V().crossVectors(ax, across).normalize();
      const an = [wp(B.LeftFoot), wp(B.RightFoot)], ff = [0, 0], kn2 = [0, 0];
      const hipInv = B.Hips.getWorldQuaternion(B.Hips.quaternion.clone()).invert();
      ['Left', 'Right'].forEach((n, i) => {
        const up = i ? hr : hl, kn = wp(B[n + 'Leg']), a = an[i];
        const u = kn.clone().sub(up), v2 = a.clone().sub(kn);
        const bendA = deg(Math.acos(Math.max(-1, Math.min(1, u.dot(v2) / (u.length() * v2.length())))));
        out.kneeMax = Math.max(out.kneeMax, bendA);
        const d = a.clone().sub(up).normalize(), off = kn.clone().sub(up); off.addScaledVector(d, -off.dot(d));
        // колено должно выходить из плоскости тела вперёд (или вверх, когда нога вдоль корпуса), а не назад
        if (off.length() > 0.05 && off.dot(front) < -0.04 && off.dot(ax) < 0.02) out.hyper++;
        const big = off.length() > 0.05, dk = off.clone().normalize().applyQuaternion(hipInv); // in the pelvis frame: the body itself spins
        if (prev[i] && big) { const fd = deg(Math.acos(Math.max(-1, Math.min(1, dk.dot(prev[i]))))); out.flip = Math.max(out.flip, fd); ff[i] = fd; }
        kn2[i] = bendA;
        prev[i] = big ? dk : null;
        out.legMin = Math.min(out.legMin, Math.round(a.distanceTo(up) * 100) / 100);
      });
      const dh = Math.abs(an[0].y - an[1].y);
      if (hitF < 0) out.scissorPre = Math.max(out.scissorPre, Math.round(dh * 100) / 100); else if (landF < 0) out.scissorPost = Math.max(out.scissorPost, Math.round(dh * 100) / 100);
      // ground contact: how deep any body part goes below the turf (cm); pelvis vertical speed jump between frames (m/s);
      // how far the feet slide while the player is on the ground (cm)
      const names = ['Head', 'LeftHand', 'RightHand', 'LeftForeArm', 'RightForeArm', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot', 'Hips', 'Spine2'];
      let low = 9, lowN = '';
      for (const n of names) { const y = wp(B[n]).y; if (y < low) { low = y; lowN = n; } }
      const margin = { Head: 0.1, Hips: 0.1, Spine2: 0.1 }[lowN] || 0.04;
      out.sink = Math.max(out.sink, Math.round((margin - low) * 100));
      out.headMin = Math.min(out.headMin, Math.round(wp(B.Head).y * 100) / 100);
      if (fl && fl.phase !== 'air') {
        if (pelPrev !== null) out.pelJerk = Math.max(out.pelJerk, Math.round(Math.abs((hips.y - pelPrev.y) - pelPrev.d) * 60 * 10) / 10);
        if (footPrev) for (let i = 0; i < 2; i++) if (an[i].y < 0.2 && footPrev[i].y < 0.2) out.footSlide += Math.hypot(an[i].x - footPrev[i].x, an[i].z - footPrev[i].z) * 100; // only feet that are on the turf
        footPrev = [an[0].clone(), an[1].clone()];
      }
      pelPrev = { y: hips.y, d: pelPrev ? hips.y - pelPrev.y : 0 };
      if (c.trace && (fl || hitF >= 0)) trace.push([f, fl ? fl.phase[0] + fl.k.toFixed(2) : '-', 'pel' + hips.y.toFixed(2), 'tilt' + tilt, 'low' + low.toFixed(2) + lowN, 'head' + wp(B.Head).y.toFixed(2), 'hands' + wp(B.LeftHand).y.toFixed(2) + '/' + wp(B.RightHand).y.toFixed(2), 'flip' + ff.join('/'), 'knee' + kn2.join('/'), 're' + rig.diag.reachErr.map((x) => Math.round(x * 100)).join('/'), 'yaw' + deg(g.view.yaw)].join(' '));
      out.reachCm = Math.max(out.reachCm, Math.round(Math.max(rig.diag.reachErr[0], rig.diag.reachErr[1]) * 1000) / 10);
    }
    if (c.stop && stopLeft < 0) {
      const at = c.stop === 'hit' ? f === hitF : c.stop === 'lead' ? !!(k && k.phase === 'swing') : c.stop === 'down' ? !!(fl && fl.phase === 'down' && fl.k >= 1) : c.stop === 'rise' ? !!(fl && fl.phase === 'rise') : false;
      if (at) stopLeft = c.after;
    }
    if (stopLeft >= 0) { if (stopLeft === 0) return { stopped: c.stop, frame: f, py: p.y, fall: fl && { phase: fl.phase, k: fl.k, roll: fl.roll } }; stopLeft--; }
    if (upF >= 0 && f > upF + 10) break;
  }
  out.footSlide = Math.round(out.footSlide);
  if (c.trace) out.trace = trace;
  return out;
};
