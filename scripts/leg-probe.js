// Проба ног по шортс-сцене (dev-сервер, консоль): покадровый прогон сцены и по каждому кадру у обоих игроков —
// сгиб колена (угол между бедром и голенью; анатомический предел ~150°), перегиб назад (колено позади линии
// бедро — стопа относительно корпуса) и скачок направления колена за кадр. Склейки камер не считаются скачком.
//   await import('/scripts/leg-probe.js'); legProbe('bike')
//   → { stat: { hyper, flipMax, kneeMax, frames }, rows: [кадры с нарушениями] }
window.legProbe = function legProbe(id) {
  const g = window.__game, d = g.shortsDirector, V = g.rig.root.position.constructor;
  const deg = (x) => Math.round(x * 180 / Math.PI);
  const wp = (b) => b.getWorldPosition(new V());
  d.open(id); d.debugStart(id);
  const rigs = [g.rig, g.rig2], prev = [[null, null], [null, null]], rows = [], stat = { hyper: 0, flipMax: 0, kneeMax: 0, frames: 0 };
  let n = 0, lastKey = '';
  while (n++ < 9000 && d.phase !== 'outro' && d.phase !== 'done') {
    g.manualFrame(1 / 60);
    const key = d.phase + (d.phase === 'replay' ? d.replayIx : ''), cut = key !== lastKey;
    lastKey = key;
    rigs.forEach((rig, pi) => {
      const B = rig.bones, hips = wp(B.Hips), ax = wp(B.Neck).sub(hips).normalize();
      const hl = wp(B.LeftUpLeg), hr = wp(B.RightUpLeg), across = hr.clone().sub(hl).normalize(), front = new V().crossVectors(ax, across).normalize();
      ['Left', 'Right'].forEach((s, i) => {
        const up = i ? hr : hl, kn = wp(B[s + 'Leg']), an = wp(B[s + 'Foot']);
        const u = kn.clone().sub(up), v = an.clone().sub(kn);
        const bend = deg(Math.acos(Math.max(-1, Math.min(1, u.dot(v) / (u.length() * v.length())))));
        const dd = an.clone().sub(up).normalize(), off = kn.clone().sub(up);
        off.addScaledVector(dd, -off.dot(dd));
        const hyper = off.length() > 0.05 && off.dot(front) < -0.04 && off.dot(ax) < 0.02;
        const dir = off.length() > 0.05 ? off.clone().normalize() : null;
        const flip = dir && prev[pi][i] && !cut ? deg(Math.acos(Math.max(-1, Math.min(1, dir.dot(prev[pi][i]))))) : 0;
        prev[pi][i] = dir;
        stat.frames++; if (hyper) stat.hyper++;
        stat.flipMax = Math.max(stat.flipMax, flip); stat.kneeMax = Math.max(stat.kneeMax, bend);
        const p = g.world.players[pi];
        if (hyper || flip > 25 || bend > 150) rows.push(`${key} t=${d.runner.t.toFixed(3)} p${pi} ${s[0]} сгиб ${bend}° скачок ${flip}°${hyper ? ' ПЕРЕГИБ' : ''} удар=${p.kick?.phase || '-'} падение=${p.fall?.phase || '-'}`);
      });
    });
  }
  return { stat, rows };
};
