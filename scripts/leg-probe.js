// Проба ног по шортс-сцене (dev-сервер, консоль): покадровый прогон сцены и по каждому кадру у обоих игроков —
// сгиб колена (угол между бедром и голенью; анатомический предел ~150°), перегиб назад (колено позади линии
// бедро — стопа относительно корпуса) и скачок направления колена за кадр. Склейки камер не считаются скачком.
// Голеностоп: подъём стопы относительно голени (0 — как в стойке, > 0 — носок оттянут, < 0 — носок на себя;
// от стопы, стоящей ровно под вертикальной голенью; живой голеностоп даёт примерно −40…+60°, глубокий присед — до −40°) и скрут стопы вбок из плоскости сгиба колена (живой — до ~25°).
//   await import('/scripts/leg-probe.js'); legProbe('bike')
//   → { stat: { hyper, flipMax, kneeMax, plantarMax, dorsiMax, twistMax, ankleBad, frames }, rows: [кадры с нарушениями] }
window.legProbe = function legProbe(id, opt = {}) {
  const g = window.__game, d = g.shortsDirector, V = g.rig.root.position.constructor;
  const deg = (x) => Math.round(x * 180 / Math.PI);
  const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dot(b) / (a.length() * b.length()))));
  const wp = (b) => b.getWorldPosition(new V());
  d.open(id); d.debugStart(id);
  const rigs = [g.rig, g.rig2], prev = [[null, null], [null, null]], rows = [];
  const stat = { hyper: 0, flipMax: 0, kneeMax: 0, plantarMax: -99, dorsiMax: 99, twistMax: 0, ankleBad: 0, frames: 0 };
  // покой голеностопа — стопа ровно на покрытии под вертикальной голенью: угол носка ниже горизонта в позе модели
  // (если риг его знает); подъём стопы отсчитывается в плоскости сгиба колена от этого положения
  const ankle0 = rigs.map((rig) => [0, 1].map((i) => rig.legs?.[i]?.ankle0 ?? 0.716));
  stat.ankle0 = ankle0.map((a) => a.map(deg));
  let n = 0, lastKey = '';
  while (n++ < 9000 && d.phase !== 'outro' && d.phase !== 'done') {
    g.manualFrame(1 / 60);
    const key = d.phase + (d.phase === 'replay' ? d.replayIx : ''), cut = key !== lastKey;
    lastKey = key;
    rigs.forEach((rig, pi) => {
      const B = rig.bones, hips = wp(B.Hips), ax = wp(B.Neck).sub(hips).normalize();
      const hl = wp(B.LeftUpLeg), hr = wp(B.RightUpLeg), across = hr.clone().sub(hl).normalize(), front = new V().crossVectors(ax, across).normalize();
      ['Left', 'Right'].forEach((s, i) => {
        const up = i ? hr : hl, kn = wp(B[s + 'Leg']), an = wp(B[s + 'Foot']), to = wp(B[s + 'ToeBase']);
        const u = kn.clone().sub(up), v = an.clone().sub(kn), t = to.clone().sub(an);
        const bend = deg(ang(u, v));
        const dd = an.clone().sub(up).normalize(), off = kn.clone().sub(up);
        off.addScaledVector(dd, -off.dot(dd));
        const hyper = off.length() > 0.05 && off.dot(front) < -0.04 && off.dot(ax) < 0.02;
        const dir = off.length() > 0.05 ? off.clone().normalize() : null;
        const flip = dir && prev[pi][i] && !cut ? deg(ang(dir, prev[pi][i])) : 0;
        prev[pi][i] = dir;
        // ось сгиба колена; у прямой ноги — поперёк таза
        let hingeAx = new V().crossVectors(u, v);
        if (hingeAx.length() < 0.02 * u.length() * v.length()) hingeAx = across.clone(); else hingeAx.normalize();
        const sN = v.clone().normalize(), nN = new V().crossVectors(sN, hingeAx).normalize(), tN = t.clone().normalize();
        const plantar = deg(Math.atan2(tN.dot(sN), tN.dot(nN)) - ankle0[pi][i]);
        const twist = Math.abs(deg(Math.asin(Math.max(-1, Math.min(1, t.clone().normalize().dot(hingeAx))))));
        const ankleBad = plantar > 60 || plantar < -40 || twist > 25;
        stat.frames++; if (hyper) stat.hyper++; if (ankleBad) stat.ankleBad++;
        stat.flipMax = Math.max(stat.flipMax, flip); stat.kneeMax = Math.max(stat.kneeMax, bend);
        stat.plantarMax = Math.max(stat.plantarMax, plantar); stat.dorsiMax = Math.min(stat.dorsiMax, plantar); stat.twistMax = Math.max(stat.twistMax, twist);
        const p = g.world.players[pi];
        if (hyper || flip > 25 || bend > 150 || (opt.ankle !== false && ankleBad)) rows.push(`${key} t=${d.runner.t.toFixed(3)} p${pi} ${s[0]} сгиб ${bend}° скачок ${flip}° стопа ${plantar}° скрут ${twist}°${hyper ? ' ПЕРЕГИБ' : ''} удар=${p.kick?.phase || '-'}${p.kick?.bike ? '(через себя)' : ''} падение=${p.fall?.phase || '-'}`);
      });
    });
  }
  return { stat, rows };
};
