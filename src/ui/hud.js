// Компактный HUD и меню паузы. Меню полностью управляется клавиатурой или геймпадом.
import { t } from '../i18n/i18n.js';

// значение пункта меню: строка или функция (тогда текст берётся в момент отрисовки — так меню переводится на лету)
const val = (v) => (typeof v === 'function' ? v() : v);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export class Hud {
  constructor(root, overlay) {
    this.root = root; this.overlay = overlay;
    this.score = el('div', 'hud-score');
    this.state = el('div', 'hud-state');
    this.bars = el('div', 'hud-bars');
    this.charge = el('div', 'bar', '<label><span data-l></span><span data-v></span></label><i><b></b></i>');
    this.superBar = el('div', 'bar off', '<label><span data-l></span><span data-v></span></label><i><b></b></i>');
    this.bars.append(this.charge, this.superBar);
    this.hint = el('div', 'hud-hint');
    this.toast = el('div', 'hud-toast');
    root.append(this.score, this.state, this.bars, this.hint, this.toast);
    this._toastT = 0; this._hintKey = ''; this._scoreKey = ''; this._stateKey = '';
    this.menu = null;
    this.relocalize();
  }

  // смена языка: подписи полос, сброс кэшей строк (перерисуются в следующем кадре) и открытое меню
  relocalize() {
    this.charge.querySelector('[data-l]').textContent = t('hud.charge');
    this.superBar.querySelector('[data-l]').textContent = t('hud.super');
    this._hintKey = this._scoreKey = this._stateKey = ''; this._superKey = -1;
    if (this.menu) this._renderMenu();
  }

  // Служебное сообщение. Со стикерами (src/ui/stickers.js): крупное — стикер «вау», обычное — тихая заметка снизу.
  showToast(text, { big = false, ms = 900 } = {}) {
    if (this.points && this.points.busy && !big) return; // идёт разбор очков за гол: мелкие подсказки его не перекрывают
    if (this.stickers) { if (big) this.stickers.big(text); else this.stickers.note(text, Math.max(ms, 900)); return; }
    this.toast.textContent = text;
    this.toast.className = 'hud-toast show' + (big ? ' big' : '');
    this._toastT = ms / 1000;
  }

  // net — данные сетевой дуэли ({ me, lobby, rtt, replayed }) или null для песочницы
  update(dt, world, input, extra, net = null) {
    const p = net ? world.players[net.me] : world.player, k = p.kick;
    if (net) {
      // дуэль: табло очков с часами (src/ui/points.js)
      const L = net.lobby, names = [0, 1].map((i) => (L && L.players[i] ? L.players[i].name : '—'));
      this.score.style.display = 'none';
      if (this.points) { if (!this.points.visible) this.points.setVisible(true); this.points.update(dt, world, net.me, names, performance.now()); }
    } else {
      this.score.style.display = '';
      if (this.points?.visible) this.points.setVisible(false);
      const sk = world.score.scored + ':' + world.score.conceded;
      if (sk !== this._scoreKey) {
        this._scoreKey = sk;
        this.score.innerHTML = `<span>${t('hud.scored')}</span><b>${world.score.scored}</b><span>${t('hud.conceded')}</span><b>${world.score.conceded}</b>`;
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
      this.superBar.querySelector('[data-v]').textContent = sc >= 1 ? t('hud.ready') : scKey + '%';
    }
    const mode = t(p.fall && p.fall.phase !== 'air' ? (p.fall.phase === 'rise' ? 'mode.rise' : p.fall.phase === 'land' ? 'mode.land' : 'mode.down') : p.slide ? 'mode.slide' : p.reach ? 'mode.reach' : p.juggle ? 'mode.juggle' : p.lunge ? 'mode.lunge' : p.mode === 'guard' ? 'mode.guard' : p.mode === 'sprint' ? 'mode.sprint' : p.mode === 'control' ? 'mode.control' : 'mode.run')
      + (p.juggle?.n ? ' ×' + p.juggle.n : '');
    const phase = t(!k ? (p.possession ? 'phase.control' : 'phase.free')
      : k.plan ? 'phase.plan' : k.phase === 'charge' ? 'phase.charge' : k.phase === 'ready' ? 'phase.ready' : k.phase === 'curl' ? 'phase.curl' : 'phase.strike');
    const title = net && net.title ? net.title : net ? `${t('hud.net')}${net.lobby ? ' · ' + net.lobby.code : ''} · ${t('hud.ping', { ms: Math.round(net.rtt) })}${net.rtt > 110 ? t('hud.pingHigh') : ''}` : t('hud.sandbox');
    const st = `${title} · <b>${mode}</b> · ${phase}${extra ? ' · ' + extra : ''}`;
    if (st !== this._stateKey) { this._stateKey = st; this.state.innerHTML = st; }
    const has = world._hasBall(p); // тот же признак, по которому симуляция выбирает действие кнопок
    const hk = input.lastDevice + JSON.stringify(input.keys) + (net ? 'n' : 's') + (has ? 'b' : '');
    if (hk !== this._hintKey) {
      this._hintKey = hk;
      const h = (a) => `<kbd>${input.hintFor(a)}</kbd>`;
      const move = `<kbd>${t(input.lastDevice === 'keyboard' ? 'hint.arrows' : 'hint.stick')}</kbd>`;
      const guard = input.lastDevice === 'keyboard' ? h('guard') : h('faceGoal');
      // подсказка зависит от того, у игрока ли мяч: те же кнопки делают разное
      this.hint.innerHTML = (has
        ? `<b>${t('hint.withBall')}</b> ${move} ${t('hint.runDir')} · ${h('kick')} ${t('hint.kick')} · ${h('lob')} ${t('hint.lob')} · ${h('super')} ${t('hint.super')} · ${h('jump')} ${t('hint.juggle')} · ${h('sprint')} ${t('hint.sprint')}`
        : `<b>${t('hint.noBall')}</b> ${move} ${t('hint.run')} · ${h('kick')} ${t('hint.kick')} · ${h('lob')} ${t('hint.tackle')} · ${guard} ${t('hint.guard')} · ${h('jump')} ${t('hint.jump')} · ${h('sprint')} ${t('hint.sprint')}`)
        + ` · ${h('pause')} ${t('hint.pause')}`
        + (input.lastDevice === 'keyboard' && !net ? ` · <kbd>R</kbd> ${t('hint.ball')} · <kbd>F</kbd> ${t('hint.serve')} · <kbd>G</kbd> ${t('hint.wall')}` : '');
    }
    this.stickers?.update(dt);
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
    box.append(el('h1', '', val(m.title)), el('p', '', val(m.note)));
    m.items.forEach((it, i) => {
      const row = el('div', 'item' + (i === m.sel ? ' sel' : ''), `<span>${val(it.label)}</span><em>${it.value ? it.value() : ''}</em>`);
      row.addEventListener('click', () => { m.sel = i; it.act?.(); if (this.menu) this._renderMenu(); });
      box.append(row);
    });
    if (m.controls) {
      const tb = el('table');
      tb.innerHTML = val(m.controls).map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
      box.append(tb);
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
