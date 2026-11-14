// Соединение с сервером матчей: WebSocket, вход в комнату, переподключение, пинг.
import { NetSession } from './session.js';
import { NET_VERSION, REJOIN_MS } from './protocol.js';

// Адрес сервера: ?server=… → VITE_SERVER_URL → в разработке локальный сервер :8787 → тот же хост, что отдал страницу.
export function serverUrl() {
  let base = new URLSearchParams(location.search).get('server') || import.meta.env.VITE_SERVER_URL;
  if (!base) {
    base = import.meta.env.DEV ? `ws://${location.hostname}:8787`
      : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  }
  base = base.replace(/^http/i, 'ws').replace(/\/+$/, '');
  return base.endsWith('/ws') ? base : base + '/ws';
}

export class NetClient {
  constructor(world, url = serverUrl()) {
    this.url = url;
    this.session = new NetSession(world, (o) => this._send(o));
    this.ws = null; this.status = 'idle'; // idle | connecting | open | reconnecting | failed | closed
    this.first = null; this.done = false; this.retryUntil = 0; this._pingAt = 0; this._timer = 0;
  }

  create(name) { this.first = { t: 'create', v: NET_VERSION, name }; this._open(); }
  join(code, name) { this.first = { t: 'join', v: NET_VERSION, code, name }; this._open(); }

  retry() { if (this.status === 'failed') this._open(); }

  leave() {
    this.done = true;
    clearTimeout(this._timer);
    this._send({ t: 'leave' });
    const ws = this.ws; this.ws = null;
    if (ws) { try { ws.close(); } catch { /* уже закрыт */ } }
    this.status = 'closed';
  }

  _send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }

  _open() {
    const s = this.session;
    if (this.status !== 'reconnecting') this.status = 'connecting';
    let ws;
    try { ws = new WebSocket(this.url); } catch { this.status = 'failed'; return; }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      if (s.token) { s.resetInput(); this._send({ t: 'rejoin', v: NET_VERSION, code: s.code, token: s.token, seq: s.seq }); }
      else this._send(this.first);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      if (m.t === 'joined') {
        const fresh = !s.token;
        this.status = 'open'; this.retryUntil = 0;
        s.handle(m, performance.now());
        if (fresh) this._send({ t: 'ready' }); // модели и сцена загружены ещё при запуске игры
        return;
      }
      s.handle(m, performance.now());
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.done || s.closed || s.error) { this.status = 'closed'; return; }
      const inMatch = s.token && ['countdown', 'play', 'paused'].includes(s.state);
      const now = performance.now();
      if (inMatch) {
        // обрыв посреди матча: сервер держит место, пробуем вернуться
        if (!this.retryUntil) this.retryUntil = now + REJOIN_MS;
        if (now < this.retryUntil) { this.status = 'reconnecting'; this._timer = setTimeout(() => this._open(), 1000); return; }
      }
      this.status = 'failed';
    };
    ws.onerror = () => {};
  }

  update(now) {
    if (this.status === 'open' && now - this._pingAt > 1000) { this._pingAt = now; this._send({ t: 'ping', c: now }); }
  }
}
