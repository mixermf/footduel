// Экраны сетевой игры: форма входа, комната ожидания, отсчёт, пауза при обрыве, итог матча.
// Тексты игроков выводятся только через textContent.
const NAME_KEY = 'soccer-duel-desktop.name.v1';
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

const ERRORS = {
  no_room: 'Комната не найдена. Проверьте код — или матч уже завершён.',
  room_full: 'В комнате уже двое игроков.',
  version: 'Версия игры устарела. Обновите страницу (Ctrl+F5).',
  server_full: 'Сервер переполнен. Попробуйте позже.',
};
const CLOSED = {
  opponent_left: 'Соперник вышел из матча.',
  opponent_timeout: 'Соперник не вернулся в игру.',
  server_restart: 'Сервер перезапускается. Создайте комнату заново через минуту.',
};

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
    const key = JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x));
    if (key === this._key) return;
    const keepFocus = this._key && v.kind === 'form';
    this._key = key;
    if (keepFocus) return;
    this._draw(v);
  }

  _view(net, now) {
    if (!net) return { kind: 'form', form: this.form };
    const s = net.session, L = s.lobby;
    if (s.error) return { kind: 'msg', title: 'Не удалось войти', text: ERRORS[s.error] || 'Ошибка: ' + s.error };
    if (s.closed) return { kind: 'msg', title: 'Матч прерван', text: CLOSED[s.closed] || 'Комната закрыта.' };
    if (net.status === 'failed') return { kind: 'msg', title: 'Сервер недоступен', text: 'Нет соединения с ' + net.url, retry: true };
    if (net.status === 'reconnecting') return { kind: 'msg', title: 'Связь потеряна', text: 'Переподключение… Матч на паузе, место за вами сохраняется.' };
    if (!L) return { kind: 'msg', title: 'Подключение…', text: net.url };
    const left = Math.max(0, Math.ceil((L.timer - (now - s.lobbyAt)) / 1000));
    const players = L.players.map((p, i) => (p ? { name: p.name, me: i === s.me, connected: p.connected, ready: p.ready, rematch: p.rematch } : null));
    const side = s.me === 0 ? 'Вы слева, в синем: атакуете правые ворота.' : 'Вы справа, в красном: атакуете левые ворота.';
    switch (L.state) {
      case 'waiting': return { kind: 'room', code: L.code, players, text: 'Ждём соперника. Отправьте ему код или ссылку.', copied: now < this._copied };
      case 'loading': return { kind: 'room', code: L.code, players, text: 'Соперник в комнате. Загрузка…', copied: false };
      case 'countdown': return { kind: 'count', n: Math.max(1, left), text: side, goalsToWin: L.goalsToWin };
      case 'paused': return { kind: 'msg', title: 'Соперник отключился', text: `Матч на паузе. Ждём возвращения: ${left} с.` };
      case 'over': {
        const win = L.winner === s.me, mine = L.goals[s.me], theirs = L.goals[1 - s.me];
        const me = players[s.me], other = players[1 - s.me];
        const note = !other ? 'Соперник вышел.' : me?.rematch ? 'Ждём согласия соперника…' : other.rematch ? 'Соперник хочет реванш.' : '';
        return { kind: 'over', title: win ? 'Победа!' : 'Поражение', score: `${mine} : ${theirs}`, note, canRematch: !!other && !me?.rematch };
      }
      default: return { kind: 'none' };
    }
  }

  _draw(v) {
    const root = this.root;
    this.primary = null;
    root.replaceChildren();
    root.className = v.kind === 'none' ? '' : 'open' + (v.kind === 'count' ? ' clear' : '');
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
      box.append(el('h1', '', create ? 'Создать комнату' : 'Войти в комнату'),
        el('p', '', create ? 'Вы получите код комнаты и ссылку для соперника.' : 'Введите код, который прислал соперник.'));
      const name = el('input'); name.maxLength = 16; name.placeholder = 'Ваше имя'; name.value = this.name; name.autocomplete = 'off';
      const code = el('input', 'code'); code.maxLength = 5; code.placeholder = 'КОД'; code.value = v.form.code; code.autocomplete = 'off'; code.spellcheck = false;
      code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
      const lab = (t, input) => { const l = el('label', 'field'); l.append(el('span', '', t), input); return l; };
      box.append(lab('Имя', name));
      if (!create) box.append(lab('Код комнаты', code));
      row.append(btn(create ? 'Создать' : 'Войти', () => {
        const c = code.value.trim();
        if (!create && c.length < 5) { code.focus(); return; }
        this.name = name.value.trim();
        this.h.submit(v.form.kind, c, name.value.trim());
      }, true), btn('Назад', () => this.h.leave()));
      box.append(row);
      root.append(box);
      (create || code.value ? name : code).focus();
      return;
    }
    if (v.kind === 'room') {
      box.append(el('h1', '', 'Комната'), el('div', 'net-code', v.code), el('p', '', v.text));
      const list = el('div', 'net-players');
      v.players.forEach((p, i) => {
        const r = el('div', 'net-player' + (i ? ' red' : ' blue'));
        r.append(el('span', '', p ? p.name + (p.me ? ' (вы)' : '') : 'свободно'), el('em', '', !p ? '—' : p.ready ? 'готов' : 'загрузка'));
        list.append(r);
      });
      box.append(list);
      row.append(btn(v.copied ? 'Ссылка скопирована' : 'Скопировать ссылку', () => {
        navigator.clipboard?.writeText(roomLink(v.code)).then(() => { this._copied = performance.now() + 1500; }, () => {});
      }, true), btn('Выйти', () => this.h.leave()));
    } else if (v.kind === 'count') {
      box.classList.add('count');
      box.append(el('div', 'net-count', String(v.n)), el('p', '', v.text), el('p', '', `Матч до ${v.goalsToWin} голов.`));
    } else if (v.kind === 'over') {
      box.append(el('h1', '', v.title), el('div', 'net-code', v.score), el('p', '', v.note));
      if (v.canRematch) row.append(btn('Реванш', () => this.h.rematch(), true));
      row.append(btn('Выйти', () => this.h.leave(), !v.canRematch));
    } else {
      box.append(el('h1', '', v.title), el('p', '', v.text));
      if (v.retry) row.append(btn('Повторить', () => this.h.retry(), true));
      row.append(btn('Выйти в меню', () => this.h.leave(), !v.retry));
    }
    if (row.childElementCount) box.append(row);
    root.append(box);
    this.primary?.focus();
  }
}
