// Проба падения на спину и подъёма (dev-сервер, консоль): шортс-сцена «через себя» с продлённой живой частью.
//   await import('/scripts/getup-probe.js');
//   getupProbe()            → { worst: { rot, hip, foot }, minY, rows, gap } — за кадр 1/60 игрового времени: наибольший поворот кости
//                              (град), сдвиг таза и стопы (см); minY — самые низкие точки костей (м) с фазой; rows — смены фаз и рывки;
//                              gap — насколько таз рига отстаёт от игрока после подъёма, см
//   getupShot(2.9)          — кадр сцены в момент t живой части с камеры сбоку от игрока (ang — угол от направления взгляда)
//   getupProbe(2.0, 5.0, 'bike', 1) — то же с вводом: после подъёма игрок держит направление (move: 1 — вправо по экрану)
// Живая часть сцены на время пробы продлевается до 7 с и после каждого вызова возвращается как была.
const LIVE = 7;
function seek(t, id = 'bike') {
  const d = window.__game.shortsDirector;
  d.open(id); const live0 = d.scene.live; d.scene.live = LIVE; d.debugStart(id); d.scene.live = LIVE; d.debugTo('live', t);
  const p = window.__game.world.players[0];
  return { live0, res: p.fall ? `${p.fall.phase} ${p.fall.t.toFixed(2)}` : 'stand' };
}

window.getupShot = function getupShot(t, ang = 1.2, dist = 3.2, h = 0.9, id = 'bike') {
  const { live0, res } = seek(t, id), g = window.__game, sc = g.scene, p = g.world.players[0];
  g.shortsDirector.scene.live = live0;
  const hp = g.rig.bones.Hips.getWorldPosition(new g.rig.root.position.constructor()), a = (p.fall ? p.fall.yaw : p.yaw) + ang;
  sc.cine = { px: hp.x + Math.cos(a) * dist, py: h, pz: hp.z + Math.sin(a) * dist, lx: hp.x, ly: Math.max(0.35, hp.y * 0.8), lz: hp.z, out: 0 };
  sc.camera.fov = 45; sc.camera.updateProjectionMatrix(); sc.updateCamera(0, 0, 0, 1); sc.render(0);
  return res;
};

window.getupProbe = function getupProbe(from = 2.0, to = 5.0, id = 'bike', move = 0) {
  const g = window.__game, d = g.shortsDirector, V = g.rig.root.position.constructor, Q = g.rig.bones.Hips.quaternion.constructor;
  const { live0 } = seek(from, id);
  // ввод игрока: после подъёма держит направление (сценарий сцены свои нажатия дальше не даёт)
  const inputs0 = d.runner.inputs;
  if (move) d.runner.inputs = function () { const r = inputs0.call(this); if (!g.world.players[0].fall) r[0].mx = move; return r; };
  const names = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
  const low = ['Spine2', 'Neck', 'Head', 'LeftHand', 'RightHand', 'LeftForeArm', 'RightForeArm', 'LeftFoot', 'RightFoot', 'Hips'];
  const worst = { rot: 0, hip: 0, foot: 0 }, minY = {}, rows = [];
  let prev = null, lastPh = '', n = 0, gap = 0;
  while (n++ < 3000 && d.phase === 'live' && d.runner.t < to) {
    g.manualFrame(1 / 60);
    const p = g.world.players[0], ph = p.fall ? p.fall.phase + (p.kick ? '+kick' : '') : 'stand', t = d.runner.t;
    const cur = { t, q: names.map((nm) => g.rig.bones[nm].getWorldQuaternion(new Q())), hip: g.rig.bones.Hips.getWorldPosition(new V()),
      feet: ['LeftFoot', 'RightFoot'].map((nm) => g.rig.bones[nm].getWorldPosition(new V())) };
    for (const nm of low) {
      const y = g.rig.bones[nm].getWorldPosition(new V()).y;
      if (!minY[nm] || y < minY[nm][0]) minY[nm] = [Math.round(y * 100) / 100, ph, t.toFixed(2)];
    }
    if (ph === 'stand') { const hp = g.rig.bones.Hips.getWorldPosition(new V()); gap = Math.max(gap, Math.round(Math.hypot(hp.x - p.x, hp.z - p.z) * 100)); } // таз рига от игрока, см
    if (prev && t > prev.t) {
      const span = (t - prev.t) * 60; // замедление сцены: всё — на кадр 1/60 игрового времени
      let rot = 0, who = '';
      cur.q.forEach((q, i) => { const a = 2 * Math.acos(Math.min(1, Math.abs(q.dot(prev.q[i])))) * 57.3 / span; if (a > rot) { rot = a; who = names[i]; } });
      const hip = cur.hip.distanceTo(prev.hip) * 100 / span, foot = Math.max(...cur.feet.map((f, i) => f.distanceTo(prev.feet[i]))) * 100 / span;
      if (rot > worst.rot) { worst.rot = rot; worst.rotAt = `${ph} t=${t.toFixed(2)} ${who}`; }
      if (hip > worst.hip) { worst.hip = hip; worst.hipAt = `${ph} t=${t.toFixed(2)}`; }
      if (foot > worst.foot && !ph.startsWith('air')) { worst.foot = foot; worst.footAt = `${ph} t=${t.toFixed(2)}`; }
      if (ph !== lastPh || rot > 25) rows.push(`${ph} t=${t.toFixed(3)} поворот ${rot.toFixed(1)}° ${who} таз ${hip.toFixed(1)} см стопа ${foot.toFixed(1)} см слой ${(g.rig._gu?.rw ?? 0).toFixed(2)}`);
      lastPh = ph;
    }
    if (!prev || t > prev.t) prev = cur;
  }
  d.runner.inputs = inputs0; d.scene.live = live0;
  for (const k of ['rot', 'hip', 'foot']) worst[k] = Math.round(worst[k] * 10) / 10;
  return { worst, minY, rows, gap };
};
