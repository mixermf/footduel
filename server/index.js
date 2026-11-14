// Сервер Soccer Duel: раздаёт собранный клиент (dist/) и ведёт сетевые матчи по WebSocket (/ws).
// Запуск: node server/index.js. Порт — из переменной PORT (Railway задаёт её сам), по умолчанию 8787.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { NET_VERSION } from '../src/net/protocol.js';

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 200;
// Список разрешённых источников через запятую (https://example.com). Пусто — разрешены все.
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.map': 'application/json',
};

const rooms = new Map();
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без похожих символов: O/0, I/1, L
function newCode() {
  for (let n = 0; n < 50; n++) {
    let c = '';
    for (let i = 0; i < 5; i++) c += ALPHABET[randomInt(ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

// ---------- HTTP: проверка состояния и статика ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    let players = 0;
    for (const r of rooms.values()) players += r.count;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, v: NET_VERSION, rooms: rooms.size, players, uptime: Math.round(process.uptime()) }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(DIST, rel);
  if (!file.startsWith(DIST + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(DIST, 'index.html');
      if (!path.extname(rel) && fs.existsSync(index)) return sendFile(index, res, req, false);
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(fs.existsSync(index) ? 'Не найдено' : 'Сервер матчей работает. Клиент не собран: выполните npm run build.');
      return;
    }
    sendFile(file, res, req, rel.startsWith('/assets/'));
  });
});

function sendFile(file, res, req, immutable) {
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// ---------- WebSocket: комнаты ----------
const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 8192,
  verifyClient: ({ origin }) => ALLOWED.length === 0 || !origin || ALLOWED.includes(origin),
});

wss.on('connection', (ws) => {
  const ctx = { room: null, slot: -1, n: 0, t0: performance.now() };
  const conn = {
    send(str) { if (ws.readyState === 1 && ws.bufferedAmount < 1 << 20) ws.send(str); },
    close() { ws.close(); },
  };
  const fail = (code) => conn.send(JSON.stringify({ t: 'error', code }));
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    // защита от потока сообщений: не больше 600 за секунду
    const now = performance.now();
    if (now - ctx.t0 > 1000) { ctx.t0 = now; ctx.n = 0; }
    if (++ctx.n > 600) { ws.close(1008, 'rate'); return; }
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (ctx.room && !ctx.room.closed && ctx.room.slots[ctx.slot]?.conn === conn) {
      ctx.room.message(ctx.slot, m);
      if (m.t === 'leave') ctx.room = null;
      return;
    }
    if (m.t === 'ping') { conn.send(JSON.stringify({ t: 'pong', c: Number(m.c) || 0 })); return; }
    if (m.t !== 'create' && m.t !== 'join' && m.t !== 'rejoin') return;
    if (m.v !== NET_VERSION) { fail('version'); return; }
    if (m.t === 'create') {
      const code = rooms.size < MAX_ROOMS ? newCode() : null;
      if (!code) { fail('server_full'); return; }
      const room = new Room(code);
      rooms.set(code, room);
      ctx.room = room; ctx.slot = room.join(conn, m.name);
      return;
    }
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room || room.closed) { fail('no_room'); return; }
    const slot = m.t === 'join' ? room.join(conn, m.name) : room.rejoin(conn, String(m.token || ''), m.seq);
    if (slot < 0) { fail(m.t === 'join' ? 'room_full' : 'no_room'); return; }
    ctx.room = room; ctx.slot = slot;
  });

  ws.on('close', () => { if (ctx.room) ctx.room.drop(ctx.slot, conn, false); });
});

// обрыв без закрытия соединения: проверка раз в 10 секунд
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 10000).unref();

// игровой цикл: комнаты считаются по реальному времени с накоплением, таймер лишь будит цикл
let last = performance.now();
setInterval(() => {
  const now = performance.now(), dt = Math.min(250, now - last);
  last = now;
  for (const [code, room] of rooms) {
    room.update(dt);
    if (room.closed) rooms.delete(code);
  }
}, 4);

function shutdown() {
  for (const room of rooms.values()) room.close('server_restart');
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, HOST, () => console.log(`[soccer-duel] сервер слушает ${HOST}:${PORT}, протокол v${NET_VERSION}`));
