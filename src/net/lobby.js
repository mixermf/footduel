// Экраны сетевой игры: форма входа, комната ожидания, отсчёт, пауза при обрыве, итог матча.
// Тексты игроков выводятся только через textContent.
const NAME_KEY = 'soccer-duel-desktop.name.v1';
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

import { t, plural, getLang } from '../i18n/i18n.js';

// коды ошибок и закрытия комнаты приходят с сервера; текст — по языку игрока
const ERR_KEYS = ['no_room', 'room_full', 'version', 'server_full'];
const CLOSED_KEYS = ['opponent_left', 'opponent_timeout', 'server_restart'];
const errText = (c) => (ERR_KEYS.includes(c) ? t('net.err.' + c) : t('net.err.other', { code: c }));
const closedText = (c) => (CLOSED_KEYS.includes(c) ? t('net.closed.' + c) : t('net.closed.other'));

export function roomLink(code) {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('room', code);
  return u.toString();
}

export class Lobby {
  // handlers: { submit(kind, code, name), leave(), rematch(), retry() }
  constructor(root, handlers) {
    this.root = root; this.h = handlers;
    this.form = null; this._key = ''; this.primary = null; this._copied = 0;
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.h.leave(); }
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); this.primary?.click(); }
    });
  }

  get name() { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } }
  set name(v) { try { localStorage.setItem(NAME_KEY, v); } catch { /* нет доступа к хранилищу */ } }

  openForm(kind, code = '') { this.form = { kind, code }; this._key = ''; }
  close() { this.form = null; this._key = ''; this.root.className = ''; this.root.replaceChildren(); this.primary = null; }

  // команды геймпада: подтверждение — основное действие экрана, назад — выход
  input(cmd) { if (cmd === 'confirm') this.primary?.click(); else if (cmd === 'back') this.h.leave(); }

  // net — NetClient или null (до отправки формы). Перерисовка только при смене содержимого.
  render(net, now) {
    const v = this._view(net, now);
    const key = getLang() + JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x));
    if (key === this._key) return;
    const keepFocus = this._key && v.kind === 'form';
    this._key = key;
    if (keepFocus) return;
    this._draw(v);
  }

  _view(net, now) {
    if (!net) return { kind: 'form', form: this.form };
    const s = net.session, L = s.lobby;
    if (s.error) return { kind: 'msg', title: t('net.joinFail'), text: errText(s.error) };
    if (s.closed) return { kind: 'msg', title: t('net.aborted'), text: closedText(s.closed) };
    if (net.status === 'failed') return { kind: 'msg', title: t('net.down'), text: t('net.noConn', { url: net.url }), retry: true };
    if (net.status === 'reconnecting') return { kind: 'msg', title: t('net.lost'), text: t('net.reconnecting') };
    if (!L) return { kind: 'msg', title: t('net.connecting'), text: net.url };
    const left = Math.max(0, Math.ceil((L.timer - (now - s.lobbyAt)) / 1000));
    const players = L.players.map((p, i) => (p ? { name: p.name, me: i === s.me, connected: p.connected, ready: p.ready, rematch: p.rematch } : null));
    const side = t(s.me === 0 ? 'net.sideLeft' : 'net.sideRight');
    switch (L.state) {
      case 'waiting': return { kind: 'room', code: L.code, players, text: t('net.waiting'), copied: now < this._copied };
      case 'loading': return { kind: 'room', code: L.code, players, text: t('net.loading'), copied: false };
      case 'countdown': return { kind: 'count', n: Math.max(1, left), text: side, goalsToWin: L.goalsToWin, duration: L.duration,
        vs: L.intro && left > 2 ? L.players.map((p) => (p ? `${p.name} · ${p.num || ''}` : '')).join('   —   ') : '' };
      case 'paused': return { kind: 'msg', title: t('net.oppGone'), text: t('net.pausedWait', { s: left }) };
      case 'over': {
        const win = L.winner === s.me, sc = L.points || L.goals, mine = sc[s.me], theirs = sc[1 - s.me];
        const me = players[s.me], other = players[1 - s.me];
        const note = !other ? t('net.oppLeft') : me?.rematch ? t('net.waitRematch') : other.rematch ? t('net.oppRematch') : '';
        return { kind: 'over', title: t(L.winner < 0 ? 'result.draw' : win ? 'result.win' : 'result.loss'), score: `${mine} : ${theirs}` + (L.points ? t('net.goals', { a: L.goals[s.me], b: L.goals[1 - s.me] }) : ''), note, canRematch: !!other && !me?.rematch };
      }
      default: return { kind: 'none' };
    }
  }

  _draw(v) {
    const root = this.root;
    this.primary = null;
    root.replaceChildren();
    root.className = v.kind === 'none' ? '' : 'open' + (v.kind === 'count' ? ' clear' : '') + (v.vs ? ' intro' : ''); // сцена выхода: без затемнения, имена — внизу кадра
    if (v.kind === 'none') return;
    const box = el('div', 'menu net');
    const btn = (label, fn, primary) => {
      const b = el('button', primary ? 'primary' : '', label);
      b.type = 'button';
      b.addEventListener('click', fn);
      if (primary) this.primary = b;
      return b;
    };
    const row = el('div', 'net-actions');

    if (v.kind === 'form') {
      const create = v.form.kind === 'create';
      box.append(el('h1', '', t(create ? 'net.createTitle' : 'net.joinTitle')),
        el('p', '', t(create ? 'net.createNote' : 'net.joinNote')));
      const name = el('input'); name.maxLength = 16; name.placeholder = t('net.namePh'); name.value = this.name; name.autocomplete = 'off';
      const code = el('input', 'code'); code.maxLength = 5; code.placeholder = t('net.codePh'); code.value = v.form.code; code.autocomplete = 'off'; code.spellcheck = false;
      code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
      const lab = (t, input) => { const l = el('label', 'field'); l.append(el('span', '', t), input); return l; };
      box.append(lab(t('net.name'), name));
      if (!create) box.append(lab(t('net.code'), code));
      row.append(btn(t(create ? 'net.create' : 'net.join'), () => {
        const c = code.value.trim();
        if (!create && c.length < 5) { code.focus(); return; }
        this.name = name.value.trim();
        this.h.submit(v.form.kind, c, name.value.trim());
      }, true), btn(t('net.back'), () => this.h.leave()));
      box.append(row);
      root.append(box);
      (create || code.value ? name : code).focus();
      return;
    }
    if (v.kind === 'room') {
      box.append(el('h1', '', t('net.room')), el('div', 'net-code', v.code), el('p', '', v.text));
      const list = el('div', 'net-players');
      v.players.forEach((p, i) => {
        const r = el('div', 'net-player' + (i ? ' red' : ' blue'));
        r.append(el('span', '', p ? p.name + (p.me ? t('net.youTag') : '') : t('net.free')), el('em', '', !p ? '—' : t(p.ready ? 'net.ready' : 'net.loadingShort')));
        list.append(r);
      });
      box.append(list);
      row.append(btn(t(v.copied ? 'net.copied' : 'net.copy'), () => {
        navigator.clipboard?.writeText(roomLink(v.code)).then(() => { this._copied = performance.now() + 1500; }, () => {});
      }, true), btn(t('net.leave'), () => this.h.leave()));
    } else if (v.kind === 'count') {
      box.classList.add('count');
      const min = Math.round(v.duration / 60);
      const rule = v.duration ? t('net.rulePoints', { min, minWord: plural(min, 'min') }) : t('net.ruleGoals', { n: v.goalsToWin, goalWord: plural(v.goalsToWin, 'goal') });
      if (v.vs) box.append(el('p', 'net-vs', v.vs), el('p', '', rule));
      else box.append(el('div', 'net-count', String(v.n)), el('p', '', v.text), el('p', '', rule));
    } else if (v.kind === 'over') {
      box.append(el('h1', '', v.title), el('div', 'net-code', v.score), el('p', '', v.note));
      if (v.canRematch) row.append(btn(t('net.rematch'), () => this.h.rematch(), true));
      row.append(btn(t('net.leave'), () => this.h.leave(), !v.canRematch));
    } else {
      box.append(el('h1', '', v.title), el('p', '', v.text));
      if (v.retry) row.append(btn(t('net.retry'), () => this.h.retry(), true));
      row.append(btn(t('net.toMenu'), () => this.h.leave(), !v.retry));
    }
    if (row.childElementCount) box.append(row);
    root.append(box);
    this.primary?.focus();
  }
}
