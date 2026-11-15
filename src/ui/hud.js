// Компактный HUD и меню паузы. Меню полностью управляется клавиатурой или геймпадом.
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export class Hud {
  constructor(root, overlay) {
    this.root = root; this.overlay = overlay;
    this.score = el('div', 'hud-score');
    this.state = el('div', 'hud-state');
    this.bars = el('div', 'hud-bars');
    this.charge = el('div', 'bar', '<label><span>Сила удара</span><span data-v></span></label><i><b></b></i>');
    this.superBar = el('div', 'bar off', '<label><span>Суперудар</span><span data-v></span></label><i><b></b></i>');
    this.bars.append(this.charge, this.superBar);
    this.hint = el('div', 'hud-hint');
    this.toast = el('div', 'hud-toast');
    root.append(this.score, this.state, this.bars, this.hint, this.toast);
    this._toastT = 0; this._hintKey = ''; this._scoreKey = ''; this._stateKey = '';
    this.menu = null;
  }

  showToast(text, { big = false, ms = 900 } = {}) {
    this.toast.textContent = text;
    this.toast.className = 'hud-toast show' + (big ? ' big' : '');
    this._toastT = ms / 1000;
  }

  // net — данные сетевой дуэли ({ me, lobby, rtt, replayed }) или null для песочницы
  update(dt, world, input, extra, net = null) {
    const p = net ? world.players[net.me] : world.player, k = p.kick;
    if (net) {
      const L = net.lobby, names = [0, 1].map((i) => (L && L.players[i] ? L.players[i].name : '—'));
      const sk = 'n' + world.goals.join(':') + names.join('|') + net.me;
      if (sk !== this._scoreKey) {
        this._scoreKey = sk;
        this.score.replaceChildren();
        const part = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; this.score.append(e); };
        part('span', 'blue' + (net.me === 0 ? ' me' : ''), names[0]); part('b', '', String(world.goals[0]));
        part('b', '', String(world.goals[1])); part('span', 'red' + (net.me === 1 ? ' me' : ''), names[1]);
      }
    } else {
      const sk = world.score.scored + ':' + world.score.conceded;
      if (sk !== this._scoreKey) {
        this._scoreKey = sk;
        this.score.innerHTML = `<span>Забито</span><b>${world.score.scored}</b><span>Пропущено</span><b>${world.score.conceded}</b>`;
      }
    }
    const charge = k ? k.charge : 0;
    this.charge.querySelector('b').style.width = Math.round(charge * 100) + '%';
    this.charge.querySelector('[data-v]').textContent = k ? Math.round(charge * 100) + '%' : '';
    const sc = p.superCharge || 0, scKey = Math.round(sc * 100);
    if (scKey !== this._superKey) {
      this._superKey = scKey;
      this.superBar.className = 'bar' + (sc >= 1 ? ' full' : ' off');
      this.superBar.querySelector('b').style.width = scKey + '%';
      this.superBar.querySelector('[data-v]').textContent = sc >= 1 ? 'готов' : scKey + '%';
    }
    const mode = p.fall && p.fall.phase !== 'air' ? (p.fall.phase === 'rise' ? 'Встаёт' : p.fall.phase === 'land' ? 'Приземление' : 'Упал') : p.slide ? 'Подкат' : p.reach ? 'Тянется за мячом' : p.juggle ? 'Чеканка' + (p.juggle.n ? ' ×' + p.juggle.n : '') : p.lunge ? 'Рывок' : p.mode === 'guard' ? 'Защитная стойка' : p.mode === 'sprint' ? 'Спринт' : p.mode === 'control' ? 'Близкий контроль' : 'Бег';
    const phase = !k ? (p.possession ? 'мяч под контролем' : 'без мяча')
      : k.plan ? 'выход на мяч — удар в касание'
        : k.phase === 'charge' ? 'заряд — направления управляют прицелом'
        : k.phase === 'ready' ? 'подход к мячу' : k.phase === 'curl' ? 'ПОДКРУТКА' : 'удар';
    const title = net ? `Сеть${net.lobby ? ' · ' + net.lobby.code : ''} · пинг ${Math.round(net.rtt)} мс${net.rtt > 110 ? ' (высокий)' : ''}` : 'Песочница';
    const st = `${title} · <b>${mode}</b> · ${phase}${extra ? ' · ' + extra : ''}`;
    if (st !== this._stateKey) { this._stateKey = st; this.state.innerHTML = st; }
    const has = !!(p.possession || p.juggle);
    const hk = input.lastDevice + JSON.stringify(input.keys) + (net ? 'n' : 's') + (has ? 'b' : '');
    if (hk !== this._hintKey) {
      this._hintKey = hk;
      const h = (a) => `<kbd>${input.hintFor(a)}</kbd>`;
      const move = input.lastDevice === 'keyboard' ? '<kbd>стрелки</kbd>' : '<kbd>левый стик</kbd>';
      const guard = input.lastDevice === 'keyboard' ? h('guard') : h('faceGoal');
      // подсказка зависит от того, у игрока ли мяч: те же кнопки делают разное
      this.hint.innerHTML = (has
        ? `<b>С мячом:</b> ${move} бег и направление · ${h('kick')} удар · ${h('lob')} навес · ${h('super')} суперудар · ${h('jump')} чеканка · ${h('sprint')} ускорение`
        : `<b>Без мяча:</b> ${move} бег · ${h('kick')} удар · ${h('lob')} подкат · ${h('super')} дотянуться · ${h('jump')} прыжок · ${guard} стойка · ${h('sprint')} ускорение`)
        + ` · ${h('pause')} пауза`
        + (input.lastDevice === 'keyboard' && !net ? ' · <kbd>R</kbd> мяч · <kbd>F</kbd> подача · <kbd>G</kbd> щит' : '');
    }
    if (this._toastT > 0) { this._toastT -= dt; if (this._toastT <= 0) this.toast.classList.remove('show'); }
  }

  // ---------- меню паузы ----------
  openMenu(title, note, items, controls) {
    this.menu = { title, note, items, controls, sel: 0 };
    this.overlay.classList.add('open');
    this._renderMenu();
  }

  closeMenu() { this.menu = null; this.overlay.classList.remove('open'); this.overlay.innerHTML = ''; }

  _renderMenu() {
    const m = this.menu;
    const box = el('div', 'menu');
    box.append(el('h1', '', m.title), el('p', '', m.note));
    m.items.forEach((it, i) => {
      const row = el('div', 'item' + (i === m.sel ? ' sel' : ''), `<span>${it.label}</span><em>${it.value ? it.value() : ''}</em>`);
      row.addEventListener('click', () => { m.sel = i; it.act?.(); if (this.menu) this._renderMenu(); });
      box.append(row);
    });
    if (m.controls) {
      const t = el('table');
      t.innerHTML = m.controls.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
      box.append(t);
    }
    this.overlay.innerHTML = '';
    this.overlay.append(box);
  }

  menuInput(cmd) {
    const m = this.menu;
    if (!m) return;
    const it = m.items[m.sel];
    if (cmd === 'up') m.sel = (m.sel + m.items.length - 1) % m.items.length;
    else if (cmd === 'down') m.sel = (m.sel + 1) % m.items.length;
    else if (cmd === 'left') it.adjust?.(-1);
    else if (cmd === 'right') it.adjust?.(1);
    else if (cmd === 'confirm') it.act?.();
    if (this.menu) this._renderMenu();
  }
}
