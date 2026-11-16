// Проба «мяч летит мимо при зажатом ударе» (dev-сборка, /?menu=0&autopause=0):
//   chaseProbe({ lat: 1.8, speed: 12, h: 0.4 })   — мяч пролетает в lat метрах сбоку от игрока
// Сводка: moved — на сколько игрок сместился, м; vMax — наибольшая скорость, м/с; backMax — наибольшая скорость спиной вперёд, м/с;
// backM — путь, пройденный спиной вперёд, м; feetMin — наименьшее расстояние между голеностопами в движении, см;
// steps — число шагов (смен опорной ноги); skate — путь стоп по покрытию, пока они считаются опорными, см; phases — фазы удара по кадрам.
window.chaseProbe = function chaseProbe(cfg = {}) {
  const c = { lat: 1.8, speed: 12, h: 0.4, from: 7, hold: 90, frames: 110, vz: 0, ...cfg };
  const g = window.__game, rig = g.rig, B = rig.bones, w = g.world;
  const V = rig.root.position.constructor, wp = (b) => b.getWorldPosition(new V());
  const drive = (fn) => { const orig = g.input.fill; g.input.fill = function (out, e) { orig.call(this, out, e); Object.assign(out, fn()); }; try { g.manualFrame(1 / 60); } finally { g.input.fill = orig; } };
  g.manual = true; g.simPaused = false; g.timeScale = 1;
  g.resetSandbox('motor'); rig._cel = null;
  const p = w.player, b = w.ball, dir = -p.side; // к атакуемым воротам
  for (let i = 0; i < 40; i++) { b.x = p.x + dir * 12; b.z = p.z + 8; b.vx = b.vz = 0; drive(() => ({})); }
  b.x = p.x + dir * c.from; b.z = p.z + c.lat; b.y = c.h; b.vx = -dir * c.speed; b.vz = c.vz; b.vy = 1.2; b.wx = b.wy = b.wz = 0;
  const x0 = p.x, z0 = p.z;
  const out = { moved: 0, vMax: 0, backMax: 0, backM: 0, feetMin: 999, steps: 0, skate: 0, phases: '', events: '' };
  const st = w.step.bind(w); const evs = [];
  w.step = (...a) => { st(...a); for (const e of w.events) if (/kick|receive|body|touch/.test(e.type)) evs.push(e.type); };
  let lastPh = '', lastSup = -1, prevAn = null;
  try {
    for (let f = 0; f < c.frames; f++) {
      drive(() => ({ kickHeld: f < c.hold, kickPressed: f === 0 }));
      rig._cel = null;
      const k = p.kick, ph = k ? k.phase + (k.dynamic ? '*' : '') + (k.plan ? '+' : '') : '-';
      if (ph !== lastPh) { out.phases += (out.phases ? ' ' : '') + ph + '@' + f; lastPh = ph; }
      const sp = Math.hypot(p.vx, p.vz), back = -(p.vx * Math.cos(p.yaw) + p.vz * Math.sin(p.yaw));
      out.vMax = Math.max(out.vMax, sp); out.backMax = Math.max(out.backMax, back);
      if (back > 0.3) out.backM += back / 60;
      const an = [wp(B.LeftFoot), wp(B.RightFoot)];
      if (sp > 0.8) out.feetMin = Math.min(out.feetMin, Math.round(Math.hypot(an[0].x - an[1].x, an[0].z - an[1].z) * 100));
      const sup = p.feet[0].planted && !p.feet[1].planted ? 0 : p.feet[1].planted && !p.feet[0].planted ? 1 : -1;
      if (sup >= 0 && sup !== lastSup) { if (lastSup >= 0) out.steps++; lastSup = sup; }
      if (prevAn) for (let i = 0; i < 2; i++) if (p.feet[i].planted && an[i].y < 0.16) out.skate += Math.hypot(an[i].x - prevAn[i].x, an[i].z - prevAn[i].z) * 100;
      prevAn = an;
      if (c.stop === f) return { stopped: f };
    }
  } finally { w.step = st; }
  out.moved = +Math.hypot(p.x - x0, p.z - z0).toFixed(2); out.vMax = +out.vMax.toFixed(2); out.backMax = +out.backMax.toFixed(2); out.backM = +out.backM.toFixed(2);
  out.skate = Math.round(out.skate); out.events = [...new Set(evs)].join(',');
  return out;
};
