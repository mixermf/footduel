// Игровые «стикеры» HUD: награды за трюки и приёмы. Три уровня:
//  S — мелкая подпись над игроком (приём, чеканка ×N), всплывает и уходит вверх;
//  M — трюк-стикер у игрока («С ЛЁТА», «В КАСАНИЕ»), шлёп с искрами; одновременно один, слабый трюк не перебивает сильный;
//  L — «вау» ближе к центру («СУПЕРУДАР», «ЧЕРЕЗ СЕБЯ», «ГОЛ!»), коротко, чтобы не закрывать игру.
// Плюс «заметка» — тихая строка снизу по центру для служебных сообщений и инструкций (вместо крупного тоста).
// Только изображение: никаких таймеров в симуляции, всё живёт на CSS-анимациях (src/ui/styles.css, блок «стикеры»).
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// роли цвета: свой игрок, соперник, золото (бонусы, рекорды), штраф
export const TONE = { me: 'me', foe: 'foe', gold: 'gold', bad: 'bad' };
const LIFE = { s: 800, m: 1050, l: 1250 }; // мс; совпадает с длительностью анимаций в CSS

// искры-ромбики, разлетающиеся из центра node (CSS-анимация stkSpark); при сниженной анимации не рисуются
export function sparks(node, n, tone) {
  if (reduced) return;
  for (let i = 0; i < n; i++) {
    const s = el('i', 'stk-spark ' + tone);
    s.style.setProperty('--a', (i / n) * 360 + (Math.random() - 0.5) * 30 + 'deg');
    s.style.setProperty('--d', 60 + Math.random() * 70 + 'px');
    s.style.animationDelay = Math.random() * 60 + 'ms';
    node.append(s);
  }
}

export class Stickers {
  // project(x, y, z) → { x, y } в координатах HUD или null
  constructor(root, project) {
    this.root = root; this.project = project;
    this.layer = el('div', 'stk-layer');
    this.noteEl = el('div', 'hud-note');
    root.append(this.layer, this.noteEl);
    this.m = null; // текущий трюк-стикер { node, prio, until }
    this.s = []; // подписи S, не больше двух
    this.l = null; this._lUntil = 0;
    this._noteT = 0;
    this.busy = () => false; // идёт разбор очков за гол — тогда M и S не показываем, чтобы не перекрывать его
  }

  // точка над игроком в пикселях HUD, с поправкой, чтобы стикер не залезал под табло и за края
  _anchor(p, lift = 2.3) {
    const at = p && this.project(p.x, (p.y || 0) + lift, p.z);
    if (!at) return null;
    const W = this.root.clientWidth || innerWidth, H = this.root.clientHeight || innerHeight;
    return { x: Math.max(110, Math.min(W - 110, at.x)), y: Math.max(130, Math.min(H - 140, at.y)) };
  }

  // текст со слоями: обводка-подложка в самом элементе, градиент с белой кромкой — в ::after (data-t)
  _label(cls, text) { const t = el('span', cls, text); t.dataset.t = text; return t; }

  _sparks(node, n, tone) { sparks(node, n, tone); }

  // после вставки: сдвинуть стикер, чтобы он целиком был в кадре (длинные надписи иначе срезает край)
  _fit(node) {
    const W = this.root.clientWidth || innerWidth, half = node.offsetWidth / 2 + 12;
    const x = parseFloat(node.style.left);
    if (half * 2 < W) node.style.left = Math.max(half, Math.min(W - half, x)) + 'px';
  }

  // S: мелкая подпись над игроком. n — число в подписи (растёт размер: чеканка ×7 крупнее, чем ×3)
  pop(text, p, tone = TONE.me, n = 0) {
    if (this.busy()) return;
    const at = this._anchor(p, 2.05);
    if (!at) return;
    // новая подпись поднимает старые; больше двух не держим
    for (const q of this.s) q.lift += 30, q.node.style.setProperty('--lift', -q.lift + 'px');
    while (this.s.length >= 2) this.s.shift().node.remove();
    const node = el('div', 'stk stk-s ' + tone);
    node.style.left = at.x + (Math.random() - 0.5) * 24 + 'px'; node.style.top = at.y + 'px';
    node.style.setProperty('--k', Math.min(1.6, 1 + Math.max(0, n - 3) * 0.08).toFixed(2));
    node.append(this._label('stk-t', text));
    this.layer.append(node); this._fit(node);
    const item = { node, lift: 0 };
    this.s.push(item);
    setTimeout(() => { node.remove(); this.s = this.s.filter((q) => q !== item); }, LIFE.s);
  }

  // M: трюк-стикер у игрока. prio: чем выше, тем важнее; слабый трюк не сбивает сильный, пока тот на экране
  trick(text, p, { tone = TONE.me, prio = 1 } = {}) {
    if (this.busy()) return;
    const now = performance.now();
    if (this.m && now < this.m.until && this.m.prio > prio) return;
    const at = this._anchor(p);
    if (!at) return;
    if (this.m) this.m.node.remove();
    const node = el('div', 'stk stk-m ' + tone);
    node.style.left = at.x + 'px'; node.style.top = at.y + 'px';
    node.style.setProperty('--r', (Math.random() < 0.5 ? -5 : 4) + 'deg');
    node.append(this._label('stk-t', text));
    this._sparks(node, 10, tone);
    this.layer.append(node); this._fit(node);
    this.m = { node, prio, until: now + 500 };
    setTimeout(() => node.remove(), LIFE.m);
  }

  // L: крупный «вау» над серединой экрана; sub — мелкая подпись под ним
  big(text, { tone = TONE.gold, sub = '' } = {}) {
    const now = performance.now();
    if (this.l) this.l.remove();
    if (this.m) { this.m.node.remove(); this.m = null; }
    const node = el('div', 'stk stk-l ' + tone);
    node.style.setProperty('--r', (Math.random() < 0.5 ? -4 : 3) + 'deg');
    node.append(this._label('stk-t', text));
    if (sub) node.append(el('span', 'stk-sub', sub));
    this._sparks(node, 16, tone);
    const flare = el('i', 'stk-flare'); node.prepend(flare);
    this.layer.append(node);
    this.l = node; this._lUntil = now + LIFE.l;
    setTimeout(() => { node.remove(); if (this.l === node) this.l = null; }, LIFE.l);
  }

  // тихая заметка: служебное и инструкции. Не мигает и не прыгает, снизу по центру
  note(text, ms = 1200) {
    this.noteEl.textContent = text;
    this.noteEl.classList.add('on');
    this._noteT = ms / 1000;
  }

  update(dt) {
    if (this._noteT > 0) { this._noteT -= dt; if (this._noteT <= 0) this.noteEl.classList.remove('on'); }
  }

  // гол: стикеры трюков не должны перекрывать разбор очков — убрать всё, что сейчас на экране
  hush() {
    this.layer.replaceChildren(); this.m = null; this.s = []; this.l = null;
  }

  clear() {
    this.layer.replaceChildren(); this.m = null; this.s = []; this.l = null;
    this.noteEl.classList.remove('on'); this._noteT = 0;
  }
}
