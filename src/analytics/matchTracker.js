// Учёт матчей для аналитики: начало, итог, причина, длительность. Чистая логика без Firebase — отправку делает send(name, params).
// События:
//   match_start — mode (bot | online), bot_level, match_number (номер матча на этом устройстве), session_match (номер в сессии)
//   match_end   — то же плюс result (win | loss | draw | abandoned), reason, duration_sec (реальное время, с паузами),
//                 play_sec (время по часам матча), points_me/opp, goals_me/opp, penalty_me (очки, потерянные за удержание), overtime
// reason для win/loss — что решило матч (одна шкала для обеих сторон, причина поражения — это reason при result = loss):
//   points            — в основное время по очкам за голы
//   hold_penalties    — проигравший потерял победу штрафами за удержание (без них не проиграл бы)
//   golden_goal       — дополнительное время, решил гол
//   golden_penalty    — дополнительное время, решил штраф за удержание
//   overtime_goals    — дополнительное время кончилось при равных очках, решили голы
//   goals_to_win      — досрочно, по числу голов (если в профиле задан goalsToWin)
// reason для draw: overtime_draw. Для abandoned: restart, quit_menu, quit_game, page_closed, disconnect,
//   opponent_left, opponent_timeout, server_restart (и другие причины закрытия комнаты от сервера как есть).

const COUNT_KEY = 'soccer-duel-desktop.matches.v1';

// Чем решён законченный матч. me — свой номер (0/1), winner — номер победителя или -1 (ничья)
export function classifyEnd({ me, winner, points, goals, overtime, penalties = [0, 0], decider = null, goalsToWin = 0 }) {
  if (winner < 0) return { result: 'draw', reason: 'overtime_draw' };
  const result = winner === me ? 'win' : 'loss';
  const loser = 1 - winner;
  let reason;
  if (goalsToWin && goals[winner] >= goalsToWin) reason = 'goals_to_win';
  else if (points[0] === points[1]) reason = 'overtime_goals'; // очки равны, а победитель есть — решили голы после дополнительного времени
  else if (overtime) reason = decider === 'penalty' ? 'golden_penalty' : 'golden_goal';
  else if (penalties[loser] > 0 && points[loser] + penalties[loser] >= points[winner]) reason = 'hold_penalties';
  else reason = 'points';
  return { result, reason };
}

export class MatchTracker {
  constructor(send, { now = () => performance.now(), storage = globalThis.localStorage } = {}) {
    this.send = send; this.now = now; this.storage = storage;
    this.m = null; // текущий матч
    this.sessionCount = 0;
  }

  get active() { return !!this.m; }

  // Новый матч. Если прежний не закончен (перезапуск из паузы), он уходит как брошенный
  start({ mode, botLevel = '', me = 0 }, w = null) {
    if (this.m) this.abort('restart', w);
    const n = this._bump();
    this.sessionCount++;
    this.m = { mode, botLevel, me, t0: this.now(), n, sn: this.sessionCount, goalPts: [0, 0], pens: [0, 0], overtime: false, decider: null };
    this.send('match_start', this._base());
  }

  // События симуляции: голы и штрафы копятся (по сети часть может не дойти — тогда штраф выводится из итоговых очков)
  onEvent(e) {
    const m = this.m;
    if (!m) return;
    if (e.type === 'goal' && e.by !== undefined && e.pts !== undefined) { m.goalPts[e.by] += e.pts; m.decider = 'goal'; }
    else if (e.type === 'hold_penalty' && e.pi !== undefined) { m.pens[e.pi] += -e.pts; m.decider = 'penalty'; }
    else if (e.type === 'overtime') m.overtime = true;
  }

  // Матч доигран. r — { winner, points, goals }, w — мир матча (часы, дополнительное время, профиль)
  finish(r, w = null) {
    const m = this.m;
    if (!m) return;
    if (w?.overtime) m.overtime = true;
    const pens = this._penalties(r.points);
    const { result, reason } = classifyEnd({
      me: m.me, winner: r.winner, points: r.points, goals: r.goals, overtime: m.overtime,
      penalties: pens, decider: m.decider, goalsToWin: w?.P?.match?.goalsToWin || 0,
    });
    this._end(result, reason, r.points, r.goals, pens, w);
  }

  // Матч прерван, не доигран
  abort(reason, w = null) {
    const m = this.m;
    if (!m) return;
    if (w?.overtime) m.overtime = true;
    const points = w?.points ? w.points.slice() : [0, 0], goals = w?.goals ? w.goals.slice() : [0, 0];
    this._end('abandoned', reason, points, goals, this._penalties(points), w);
  }

  // Штраф за удержание: накопленный из событий или, если события терялись, разница очков за голы и итоговых очков
  _penalties(points) {
    const m = this.m;
    return [0, 1].map((i) => Math.max(m.pens[i], m.goalPts[i] - (points[i] || 0), 0));
  }

  _end(result, reason, points, goals, pens, w) {
    const m = this.m, me = m.me, op = 1 - me;
    this.m = null;
    let playSec = 0;
    const M = w?.P?.match;
    if (M && M.duration > 0) playSec = Math.max(0, M.duration - (w.clock ?? M.duration)) + (w.overtime ? w.otT || 0 : 0);
    this.send('match_end', {
      ...this._base(m), result, reason,
      duration_sec: Math.round((this.now() - m.t0) / 1000),
      play_sec: Math.round(playSec),
      points_me: points[me] | 0, points_opp: points[op] | 0,
      goals_me: goals[me] | 0, goals_opp: goals[op] | 0,
      penalty_me: Math.round(pens[me]),
      overtime: m.overtime ? 1 : 0,
    });
  }

  _base(m = this.m) {
    const p = { mode: m.mode, match_number: m.n, session_match: m.sn };
    if (m.botLevel) p.bot_level = m.botLevel;
    return p;
  }

  _bump() {
    let n = 1;
    try { n = (Number(this.storage?.getItem(COUNT_KEY)) || 0) + 1; this.storage?.setItem(COUNT_KEY, String(n)); } catch { /* хранилище недоступно */ }
    return n;
  }
}
