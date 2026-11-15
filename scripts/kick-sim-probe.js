// Проба удара с места на уровне симуляции (dev-сборка, /?menu=0&autopause=0): геометрия захода и то, что видит игрок.
//   kickSimSweep()  — таблица по стартовым положениям игрока относительно мяча
// Для каждого старта: сколько кадров от нажатия до замаха и до контакта, попал ли по мячу, скорость мяча,
// ошибка направления относительно центра ворот, а также геометрия в момент начала замаха в осях удара:
//   back/side — где центр игрока относительно мяча (позади; в сторону опорной ноги), м;
//   open — разворот корпуса от линии удара к бьющей ноге, градусы (заход сбоку);
//   openHit / openEnd — тот же разворот в момент контакта и в конце удара (доворот через удар).
window.kickSimProbe = function kickSimProbe(cfg = {}) {
  const c = { dx: -0.55, dz: 0, yaw: 0, hold: 20, ...cfg }; // dx, dz — старт игрока относительно мяча, м
  const g = window.__game, w = g.world;
  g.manual = true; g.simPaused = false; g.timeScale = 1;
  g.resetSandbox('free');
  const p = w.player, b = w.ball;
  const tx = b.x + c.dx, tz = b.z + c.dz, sx = tx - p.x, sz = tz - p.z;
  p.x = tx; p.z = tz; p.yaw = c.yaw; p.vx = p.vz = 0;
  for (const f of p.feet) { f.x += sx; f.z += sz; f.yaw = c.yaw; }
  const events = [];
  const drive = (fn) => { const orig = g.input.fill; g.input.fill = function (out, e) { orig.call(this, out, e); Object.assign(out, fn()); }; try { g.manualFrame(1 / 60); } finally { g.input.fill = orig; } events.push(...w.events.map((e) => e.type)); };
  for (let i = 0; i < 10; i++) drive(() => ({}));
  const deg = (x) => Math.round(x * 180 / Math.PI);
  const wrap = (a) => { let d = a % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
  const out = { start: `${c.dx},${c.dz}`, windupAt: null, hitAt: null, endAt: null, hit: false };
  let kd = null, side = 1, seenKick = false;
  const open = () => deg(wrap(p.yaw - Math.atan2(kd.az, kd.ax)) * side);
  for (let f = 0; f < 200; f++) {
    drive(() => ({ kickHeld: f < c.hold, kickPressed: f === 0 }));
    const k = p.kick;
    if (k) { seenKick = true; kd = { ax: k.ax, az: k.az }; side = k.footSide; }
    if (k && k.phase === 'windup' && out.windupAt === null) {
      out.windupAt = f; out.foot = side > 0 ? 'П' : 'Л';
      const rx = b.x - p.x, rz = b.z - p.z;
      out.back = Math.round((rx * kd.ax + rz * kd.az) * 100) / 100; out.side = Math.round((rx * -kd.az + rz * kd.ax) * side * 100) / 100; out.open = open();
      const pf = p.feet[side > 0 ? 0 : 1], px = pf.x - b.x, pz = pf.z - b.z;
      out.plantBack = Math.round(-(px * kd.ax + pz * kd.az) * 100) / 100; out.plantSide = Math.round(-(px * -kd.az + pz * kd.ax) * side * 100) / 100;
    }
    if (k && k.phase === 'curl' && out.hitAt === null) {
      out.hitAt = f; out.hit = true; out.openHit = open();
      out.speed = Math.round(Math.hypot(b.vx, b.vy, b.vz) * 10) / 10;
      const gx = k.gx - b.x, gz = 0 - b.z;
      out.dirErrDeg = Math.round(wrap(Math.atan2(b.vz, b.vx) - Math.atan2(gz, gx)) * 180 / Math.PI * 10) / 10;
    }
    if (seenKick && !k) { out.endAt = f; out.openEnd = kd ? open() : null; break; }
  }
  out.events = [...new Set(events.filter((e) => /kick_/.test(e)))].join(',');
  return out;
};

window.KICK_STARTS = [[-0.55, 0], [-0.9, 0.5], [-0.9, -0.5], [-0.3, 0.6], [-0.3, -0.6], [0.5, 0.2], [-1.6, 0], [-1.2, 1.0]];
window.kickSimSweep = function kickSimSweep(cfg = {}) {
  return window.KICK_STARTS.map(([dx, dz]) => window.kickSimProbe({ dx, dz, ...cfg }));
};
