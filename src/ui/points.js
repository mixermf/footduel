// Очки дуэли на экране: табло с часами, разбор очков за гол (строки бонусов, итог, перелёт в табло), предупреждение
// и штраф за удержание, финальный баннер. Всё рисуется по событиям симуляции; само табло следует за world.points.
import { sparks } from './stickers.js';
import { t } from '../i18n/i18n.js';

const KIT = ['#4dc3ff', '#ff6b6b'], GOLD = '#ffd34d';
// русские подписи бонусов — для лаборатории и скриптов; на экран идут переводы bonus.* (src/i18n/i18n.js)
export const BONUS_LABEL = {
  goal: 'Гол', own: 'Автогол', post: 'От штанги', bar: 'От перекладины', volley: 'С лёта', jump: 'В прыжке', fly: 'Сбоку в полёте',
  bike: 'Через себя', juggle: 'С чеканки', firstTime: 'В касание', lob: 'Парашют', long: 'Издалека', power: 'Пушка', wall: 'От борта',
  super: 'Суперудар', defl: 'Рикошет',
};
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
// текст-стикер: data-t нужен второму слою (градиент в ::after)
const txt = (cls, text) => { const e = el('div', cls, text); e.dataset.t = text; return e; };
const setTxt = (e, text) => { e.textContent = text; e.dataset.t = text; };
const fmt = (n) => (n < 0 ? '−' : '') + Math.abs(Math.round(n));
const clockText = (s) => { const c = Math.ceil(Math.max(0, s)); return Math.floor(c / 60) + ':' + String(c % 60).padStart(2, '0'); };

export class PointsHud {
  // project(x, y, z) → { x, y } в пикселях экрана или null
  constructor(root, project) {
    this.root = root; this.project = project;
    this.board = el('div', 'pts-board');
    this.side = [0, 1].map((i) => {
      const box = el('div', 'pts-side s' + i), name = el('span', 'pts-name'), num = el('b', 'pts-num'), hold = el('div', 'pts-hold');
      if (i === 0) box.append(name, num); else box.append(num, name);
      box.append(hold);
      return { box, name, num, hold, shown: 0, lock: null, holdKey: '' };
    });
    this.clock = el('div', 'pts-clock');
    this.board.append(this.side[0].box, this.clock, this.side[1].box);
    this.count = el('div', 'pts-count'); // крупная цифра последних 10 секунд
    this.stack = el('div', 'pts-stack');
    this.flash = el('div', 'pts-flash');
    this.final = el('div', 'pts-final');
    root.append(this.board, this.count, this.stack, this.flash, this.final);
    this._sec = -1; this._clockKey = ''; this._stackT = 0; this.visible = false;
    this.setVisible(false);
  }

  get busy() { return this.visible && this._stackT > 0; }

  setVisible(on) {
    this.visible = on;
    this.board.style.display = on ? '' : 'none';
    if (!on) { this.stack.replaceChildren(); this.final.className = 'pts-final'; this.count.className = 'pts-count'; }
  }

  // смена языка: строки табло пересоберутся в следующем кадре
  relocalize() { this._clockKey = ''; for (const s of this.side) s.holdKey = '#'; }

  reset() {
    for (const s of this.side) { s.shown = 0; s.lock = null; s.num.textContent = '0'; }
    this.stack.replaceChildren(); this.final.className = 'pts-final'; this._sec = -1;
    clearTimeout(this._flyTimer); this._pending = null; this._pen = [null, null];
    this.onReset?.();
  }

  // Розыгрыш с центра: разбор гола не должен висеть над полем — итог сразу летит в табло, строки гаснут
  endGoal(now) {
    const P = this._pending;
    if (!P) return;
    this._pending = null; clearTimeout(this._flyTimer);
    if (!reduced && P.total.isConnected && P.total.style.visibility !== 'hidden') this._fly(P.total, P.side.num);
    if (P.side.lock && P.side.lock.start > now + 400) P.side.lock.start = now + 400;
    this.stack.classList.add('out'); this._stackT = 0;
  }

  // каждый кадр: имена, очки (с отложенным счётом после гола), часы, плашка удержания
  update(dt, world, me, names, now) {
    if (!this.visible) return;
    const H = world.P.match.hold;
    for (let i = 0; i < 2; i++) {
      const s = this.side[i], target = world.points[i];
      if (s.name.textContent !== names[i]) s.name.textContent = names[i];
      s.box.classList.toggle('me', i === me);
      if (s.lock) {
        // очки за гол: число стоит, пока итог летит в табло, затем отсчитывается вверх
        const L = s.lock, u = Math.min(1, Math.max(0, (now - L.start) / L.dur));
        s.shown = Math.round(L.from + (L.to - L.from) * (1 - (1 - u) ** 3));
        if (u >= 1) {
          const big = L.big; s.lock = null;
          s.num.classList.remove('bump'); void s.num.offsetWidth; s.num.classList.add('bump');
          s.box.classList.remove('hit', 'gold'); void s.box.offsetWidth; s.box.classList.add('hit'); if (big) s.box.classList.add('gold');
          this.onArrive?.(i, big);
        }
      } else s.shown = target;
      const shownTxt = fmt(s.shown);
      if (s.num.textContent !== shownTxt) s.num.textContent = shownTxt;
      s.num.classList.toggle('neg', s.shown < 0);
      // плашка удержания: с порога предупреждения — сколько держит, после порога — штраф
      const p = world.players[i], held = p && world.phase === 'play' ? p.holdT || 0 : 0;
      const key = held >= H.warn ? (held >= H.grace ? 'pen' : 'warn' + held.toFixed(1)) : '';
      if (key !== s.holdKey) {
        s.holdKey = key;
        s.hold.className = 'pts-hold' + (key ? (key === 'pen' ? ' on pen' : ' on') : '');
        s.hold.textContent = !key ? '' : key === 'pen' ? t('pts.penalty', { n: H.perSec }) : t(i === me ? 'pts.holdMe' : 'pts.holdThem', { s: held.toFixed(1) });
      }
    }
    // часы: последние 30 с — жёлтые, последние 10 — красные, крупные, с отсчётом
    const ot = world.overtime, left = ot ? Math.max(0, world.P.match.overtime - world.otT) : world.clock;
    const text = ot ? t('pts.golden') + ' · ' + clockText(left) : clockText(left);
    const cls = 'pts-clock' + (ot ? ' ot' : left <= 10 ? ' crit' : left <= 30 ? ' warn' : '');
    if (text + cls !== this._clockKey) { this._clockKey = text + cls; this.clock.textContent = text; this.clock.className = cls; }
    const sec = Math.ceil(left);
    if (!ot && left <= 10 && left > 0 && world.phase === 'play' && sec !== this._sec) {
      this._sec = sec;
      this.clock.classList.remove('tick'); void this.clock.offsetWidth; this.clock.classList.add('tick');
      this.count.textContent = String(sec); this.count.className = 'pts-count'; void this.count.offsetWidth; this.count.className = 'pts-count on';
      this.onTick?.(sec);
    } else if (left > 10 || ot) this.count.className = 'pts-count';
    if (this._stackT > 0) { this._stackT -= dt; if (this._stackT <= 0) this.stack.classList.add('out'); }
  }

  // Гол: шапка-стикер, строки бонусов капсулами по одной, итог-«одометр» с бликом, перелёт итога по дуге в число забившего.
  // Возвращает силу тряски.
  goal(e, me, now) {
    const by = e.by, pts = e.pts || 0, mine = by === me, tone = mine ? 'gold' : 'foe';
    this.stack.replaceChildren(); this.stack.className = 'pts-stack' + (pts >= 400 ? ' x3' : pts >= 200 ? ' x2' : '');
    // девятка: база corner вместо goal — своя шапка и больше искр
    const corner = e.bonus?.[0]?.[0] === 'corner';
    const head = txt('pts-head ' + tone + (mine ? '' : ' small'), t(corner ? (mine ? 'pts.corner' : 'pts.foeCorner') : mine ? 'pts.goal' : 'pts.foeGoal'));
    if (mine) sparks(head, corner ? 26 : pts >= 200 ? 18 : 12, 'gold'); // чужой гол — мельче и без искр
    this.stack.append(head);
    const lines = (e.bonus || []).filter((b) => b[0] !== 'goal'); // «В девятку +500» остаётся строкой: это главная награда
    const shown = lines.slice(0, 4), step = reduced ? 0 : 90, lead = reduced ? 0 : 160;
    shown.forEach(([k, v], j) => {
      const row = el('div', 'pts-line' + (j % 2 ? ' l' : ''));
      row.append(el('span', 'pts-lbl', t('bonus.' + k)), el('b', 'pts-val', '+' + v));
      row.style.animationDelay = lead + j * step + 'ms';
      this.stack.append(row);
    });
    if (lines.length > 4) { const r = el('div', 'pts-line more'); r.append(el('span', 'pts-lbl', t('pts.more', { n: lines.length - 4 }))); r.style.animationDelay = lead + 4 * step + 'ms'; this.stack.append(r); }
    const total = txt('pts-total ' + tone, '+0');
    const t0 = lead + Math.max(shown.length, 1) * step + (reduced ? 0 : 80);
    total.style.animationDelay = t0 + 'ms';
    this.stack.append(total);
    if (pts >= 400) { const tag = el('div', 'pts-tag', t('pts.legend')); tag.style.animationDelay = t0 + 400 + 'ms'; this.stack.append(tag); }
    // итог «крутится» от 0 до pts за 380 мс: каждое новое число чуть подпрыгивает, на последнем — удар и блик
    const startCount = performance.now() + t0, dur = reduced ? 1 : 380;
    let lastClick = 0, shownN = -1, lastTxt = 0;
    const tick = () => {
      if (!total.isConnected) return;
      const t = performance.now(), u = Math.min(1, Math.max(0, (t - startCount) / dur));
      const n = Math.round(pts * (1 - (1 - u) ** 3));
      // число меняется не чаще ~22 раз в секунду: каждая смена — перерисовка крупного текста с обводкой
      if (n !== shownN && (u >= 1 || t - lastTxt >= 45)) {
        shownN = n; lastTxt = t; setTxt(total, '+' + n);
        if (!reduced && u < 1) total.style.scale = String(1 + 0.05 * ((n & 1) ? 1 : -0.4));
        if (u > 0 && u < 1 && t - lastClick > 70) { lastClick = t; this.onCount?.(u); }
      }
      if (u < 1) { requestAnimationFrame(tick); return; }
      total.style.scale = ''; total.classList.add('done'); this.onCount?.(1, pts);
    };
    requestAnimationFrame(tick);
    // перелёт итога в табло забившего; число табло стоит до прилёта
    const flyAt = t0 + dur + (reduced ? 0 : 180), arrive = flyAt + (reduced ? 0 : 400);
    const s = this.side[by];
    s.lock = { from: (e.total ?? pts) - pts, to: e.total ?? pts, start: now + arrive, dur: reduced ? 1 : 380, big: pts >= 200 };
    clearTimeout(this._flyTimer);
    this._pending = reduced ? null : { total, side: s };
    if (!reduced) this._flyTimer = setTimeout(() => { this._pending = null; this._fly(total, s.num); }, flyAt);
    // вспышка экрана для крупных голов
    if (pts >= 200 && !reduced) { this.flash.className = 'pts-flash'; void this.flash.offsetWidth; this.flash.className = 'pts-flash on' + (pts >= 400 ? ' gold' : ''); }
    this.stack.classList.remove('out');
    this._stackT = Math.min(2.2, (arrive + 250) / 1000);
    return corner ? 0.34 : pts >= 400 ? 0.3 : pts >= 200 ? 0.2 : 0.12;
  }

  // перелёт по дуге: вверх и в сторону табло, с уменьшением; за ним два «призрака»-шлейфа
  _fly(from, to) {
    if (!from.isConnected) return;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const dx = b.left + b.width / 2 - a.left - a.width / 2, dy = b.top + b.height / 2 - a.top - a.height / 2;
    const lift = Math.min(-60, dy - 80); // вершина дуги выше обеих точек
    const frames = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8, y = 2 * (1 - u) * u * lift + u * u * dy; // квадратичная кривая по y, по x — равномерно
      frames.push({ transform: `translate(${dx * u}px, ${y}px) scale(${1 - 0.62 * u}) rotate(${-6 * u}deg)`, opacity: i === 8 ? 0.7 : 1 });
    }
    const tone = from.classList.contains('foe') ? 'foe' : 'gold';
    const make = (extra) => {
      const c = txt('pts-fly pts-total ' + tone + extra, from.dataset.t || from.textContent);
      c.style.left = a.left + 'px'; c.style.top = a.top + 'px'; c.style.fontSize = getComputedStyle(from).fontSize; c.style.animation = 'none';
      return c;
    };
    // призраки добавляются раньше основного: шортс-режим поправляет координаты последнего элемента root
    const ghosts = [make(' ghost'), make(' ghost')];
    const c = make('');
    this.root.append(...ghosts, c);
    const opt = { duration: 400, easing: 'cubic-bezier(.45, 0, .75, .5)', fill: 'forwards' };
    c.animate(frames, opt);
    // у призраков свои ключевые кадры: прозрачность в кадрах перебила бы класс .ghost
    ghosts.forEach((g, i) => { const k = i ? 0.15 : 0.35; g.animate(frames.map((f) => ({ ...f, opacity: f.opacity * k })), { ...opt, delay: 45 * (i + 1) }); });
    // шортс-режим поправляет left/top главного сразу после вызова: призраки берут его координаты
    queueMicrotask(() => ghosts.forEach((g) => { g.style.left = c.style.left; g.style.top = c.style.top; }));
    from.style.visibility = 'hidden';
    setTimeout(() => { c.remove(); ghosts.forEach((g) => g.remove()); }, 540);
  }

  // штраф за удержание: красное число над головой игрока и встряска его очков
  penalty(e, world) {
    const p = world.players[e.pi], s = this.side[e.pi];
    s.num.classList.remove('shake'); void s.num.offsetWidth; s.num.classList.add('shake');
    const at = p && this.project(p.x, (p.y || 0) + 2.0, p.z);
    if (!at) return;
    // одна подпись на игрока: пока штраф идёт, сумма растёт («−50» → «−100»), подпись подпрыгивает заново
    const now = performance.now(), prev = this._pen?.[e.pi];
    const sum = prev && now - prev.at < 1400 && prev.f.isConnected ? prev.sum + e.pts : e.pts;
    if (prev) { prev.f.remove(); clearTimeout(prev.timer); }
    const f = txt('pts-float bad', '▼ ' + fmt(sum));
    f.style.left = at.x + 'px'; f.style.top = at.y + 'px';
    this.root.append(f);
    (this._pen || (this._pen = [null, null]))[e.pi] = { f, sum, at: now, timer: setTimeout(() => f.remove(), 950) };
  }

  // итог матча: победа, поражение или ничья со счётом
  finish(winner, me, points, names) {
    const res = t(winner < 0 ? 'pts.draw' : winner === me ? 'pts.win' : 'pts.loss');
    const h = txt('pts-final-h ' + (winner === me || winner < 0 ? 'gold' : 'bad'), res);
    this.final.replaceChildren(h, el('div', 'pts-final-s', `${names[0]}  ${fmt(points[0])} : ${fmt(points[1])}  ${names[1]}`));
    if (winner === me) sparks(h, 22, 'gold');
    this.final.style.setProperty('--win', winner < 0 ? GOLD : KIT[winner]);
    this.final.className = 'pts-final'; void this.final.offsetWidth; this.final.className = 'pts-final on';
    setTimeout(() => { this.final.className = 'pts-final'; }, 2600);
  }
}
