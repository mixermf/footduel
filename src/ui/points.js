// Очки дуэли на экране: табло с часами, разбор очков за гол (строки бонусов, итог, перелёт в табло), предупреждение
// и штраф за удержание, финальный баннер. Всё рисуется по событиям симуляции; само табло следует за world.points.
const KIT = ['#4dc3ff', '#ff6b6b'], GOLD = '#ffd34d';
export const BONUS_LABEL = {
  goal: 'Гол', own: 'Автогол', post: 'От штанги', bar: 'От перекладины', volley: 'С лёта', jump: 'В прыжке', fly: 'Сбоку в полёте',
  bike: 'Через себя', juggle: 'С чеканки', firstTime: 'В касание', lob: 'Парашют', long: 'Издалека', power: 'Пушка', wall: 'От борта',
  super: 'Суперудар', defl: 'Рикошет',
};
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
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

  reset() {
    for (const s of this.side) { s.shown = 0; s.lock = null; s.num.textContent = '0'; }
    this.stack.replaceChildren(); this.final.className = 'pts-final'; this._sec = -1;
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
        if (u >= 1) { s.lock = null; s.num.classList.remove('bump'); void s.num.offsetWidth; s.num.classList.add('bump'); }
      } else s.shown = target;
      const t = fmt(s.shown);
      if (s.num.textContent !== t) s.num.textContent = t;
      s.num.classList.toggle('neg', s.shown < 0);
      // плашка удержания: с порога предупреждения — сколько держит, после порога — штраф
      const p = world.players[i], held = p && world.phase === 'play' ? p.holdT || 0 : 0;
      const key = held >= H.warn ? (held >= H.grace ? 'pen' : 'warn' + held.toFixed(1)) : '';
      if (key !== s.holdKey) {
        s.holdKey = key;
        s.hold.className = 'pts-hold' + (key ? (key === 'pen' ? ' on pen' : ' on') : '');
        s.hold.textContent = !key ? '' : key === 'pen' ? `▼ ШТРАФ −${H.perSec}/с` : `⚠ ${i === me ? 'ДЕРЖИШЬ' : 'ДЕРЖИТ'} МЯЧ ${held.toFixed(1)} с`;
      }
    }
    // часы: последние 30 с — жёлтые, последние 10 — красные, крупные, с отсчётом
    const ot = world.overtime, left = ot ? Math.max(0, world.P.match.overtime - world.otT) : world.clock;
    const text = ot ? 'ЗОЛОТОЙ ГОЛ · ' + clockText(left) : clockText(left);
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

  // Гол: шапка, строки бонусов по одной, итог со счётом вверх, перелёт итога в число забившего. Возвращает силу тряски.
  goal(e, me, now) {
    const by = e.by, pts = e.pts || 0, mine = by === me;
    this.stack.replaceChildren(); this.stack.className = 'pts-stack' + (pts >= 400 ? ' x3' : pts >= 200 ? ' x2' : '');
    const head = el('div', 'pts-head', mine ? 'ГОЛ!' : 'ГОЛ СОПЕРНИКА');
    head.style.color = mine ? GOLD : KIT[by];
    this.stack.append(head);
    const lines = (e.bonus || []).filter((b) => b[0] !== 'goal');
    const shown = lines.slice(0, 4), step = reduced ? 0 : 160;
    shown.forEach(([k, v], j) => {
      const row = el('div', 'pts-line', `▲ ${BONUS_LABEL[k] || k} +${v}`);
      row.style.animationDelay = (j + 1) * step + 'ms';
      this.stack.append(row);
    });
    if (lines.length > 4) { const r = el('div', 'pts-line', `+ ещё ${lines.length - 4}`); r.style.animationDelay = 5 * step + 'ms'; this.stack.append(r); }
    const total = el('div', 'pts-total', '+0');
    total.style.color = mine ? GOLD : KIT[by];
    const t0 = (shown.length + 1) * step + 120;
    total.style.animationDelay = t0 + 'ms';
    if (pts >= 400) total.dataset.tag = 'ЛЕГЕНДАРНО';
    this.stack.append(total);
    // итог считается от 0 до pts за 500 мс
    const startCount = performance.now() + t0;
    const tick = () => {
      const u = Math.min(1, Math.max(0, (performance.now() - startCount) / 500));
      total.textContent = '+' + Math.round(pts * (1 - (1 - u) ** 3));
      if (u < 1 && total.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // перелёт итога в табло забившего; число табло стоит до прилёта
    const flyAt = t0 + (reduced ? 0 : 900), arrive = flyAt + (reduced ? 0 : 450);
    const s = this.side[by];
    s.lock = { from: (e.total ?? pts) - pts, to: e.total ?? pts, start: now + arrive, dur: reduced ? 1 : 400 };
    if (!reduced) setTimeout(() => this._fly(total, s.num), flyAt);
    // вспышка экрана для крупных голов
    if (pts >= 200 && !reduced) { this.flash.className = 'pts-flash'; void this.flash.offsetWidth; this.flash.className = 'pts-flash on' + (pts >= 400 ? ' gold' : ''); }
    this.stack.classList.remove('out');
    this._stackT = Math.min(2.6, (arrive + 600) / 1000);
    return pts >= 400 ? 0.3 : pts >= 200 ? 0.2 : 0.12;
  }

  _fly(from, to) {
    if (!from.isConnected) return;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const c = el('div', 'pts-fly', from.textContent);
    c.style.color = from.style.color;
    c.style.left = a.left + 'px'; c.style.top = a.top + 'px'; c.style.fontSize = getComputedStyle(from).fontSize;
    this.root.append(c);
    requestAnimationFrame(() => {
      c.style.transform = `translate(${b.left + b.width / 2 - a.left - a.width / 2}px, ${b.top + b.height / 2 - a.top - a.height / 2}px) scale(0.4)`;
      c.style.opacity = '0.6';
    });
    from.style.visibility = 'hidden';
    setTimeout(() => c.remove(), 470);
  }

  // штраф за удержание: число над головой игрока и встряска его очков
  penalty(e, world) {
    const p = world.players[e.pi], s = this.side[e.pi];
    s.num.classList.remove('shake'); void s.num.offsetWidth; s.num.classList.add('shake');
    const at = p && this.project(p.x, (p.y || 0) + 2.0, p.z);
    if (!at) return;
    const f = el('div', 'pts-float', '▼ ' + fmt(e.pts));
    f.style.left = at.x + 'px'; f.style.top = at.y + 'px';
    this.root.append(f);
    setTimeout(() => f.remove(), 950);
  }

  // итог матча: победа, поражение или ничья со счётом
  finish(winner, me, points, names) {
    const res = winner < 0 ? 'НИЧЬЯ' : winner === me ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
    this.final.replaceChildren(el('div', 'pts-final-h', res), el('div', 'pts-final-s', `${names[0]}  ${fmt(points[0])} : ${fmt(points[1])}  ${names[1]}`));
    this.final.style.setProperty('--win', winner < 0 ? GOLD : KIT[winner]);
    this.final.className = 'pts-final'; void this.final.offsetWidth; this.final.className = 'pts-final on';
    setTimeout(() => { this.final.className = 'pts-final'; }, 2600);
  }
}
