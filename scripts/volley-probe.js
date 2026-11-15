// Сводная проба удара с лёта (dev-сборка, /?menu=0&autopause=0). Нужны joint-probe.js и kick-pose-probe.js:
//   await import('/scripts/joint-probe.js'); await import('/scripts/kick-pose-probe.js'); await import('/scripts/volley-probe.js');
//   volleyProbe()
// По каждой подаче: колено бьющей ноги в контакте и наибольшее до контакта (градусы сгиба), колено выше таза (см),
// отведение рук в замахе и в контакте (градусы от корпуса), недотяг стопы (см), кадры «колено назад» и рывок колена за кадр.
window.VOLLEY_CASES = [['thigh', 30], ['thigh', 45], ['chest', 30], ['chest', 45], ['high', 40], ['high', 60]];
window.volleyProbe = function volleyProbe() {
  const rows = window.VOLLEY_CASES.map(([s, w]) => {
    const r = window.kickPoseProbe({ scenario: s, wait: w, hold: 4 });
    const j = window.jointProbe(s, w, 4);
    if (r.error) return { case: s + '@' + w, error: r.error };
    return {
      case: s + '@' + w, jumpCm: r.jumpCm, planH: r.planH,
      kneeHit: r.contact.kickKnee, kneeMax: r.kneeMaxBeforeContact, kneeAboveHip: Math.max(r.backswing.kneeAboveHipCm, r.contact.kneeAboveHipCm),
      thighHit: r.contact.thigh, armsBack: r.backswing.armOpp.abd + '/' + r.backswing.armSame.abd, armsHit: r.contact.armOpp.abd + '/' + r.contact.armSame.abd,
      lean: r.contact.lean, side: r.contact.side, pelvis: r.contact.pelvis,
      reachCm: Math.max(r.reachCm, j.reachCm), back: j.backFrames + 'к/' + j.backWorstCm + 'см', flip: j.flipMaxDeg,
    };
  });
  const num = rows.filter((r) => !r.error);
  const sum = {
    kneeHit: Math.max(...num.map((r) => r.kneeHit)), kneeAboveHip: Math.max(...num.map((r) => r.kneeAboveHip)),
    reachCm: Math.max(...num.map((r) => r.reachCm)), flip: Math.max(...num.map((r) => r.flip)),
    backFrames: num.reduce((a, r) => a + parseInt(r.back, 10), 0),
  };
  return { sum, rows };
};
