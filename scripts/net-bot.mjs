// Простой сетевой соперник для проверки онлайна в одиночку: входит в комнату по коду и играет через тот же
// протокол, что и обычный клиент (ввод по шагам, предсказание, сверка с сервером).
// Запуск: node scripts/net-bot.mjs <КОД> [адрес сервера]   (по умолчанию ws://127.0.0.1:8787)
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { World, emptyInput } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';
import { NetSession } from '../src/net/session.js';
import { NET_VERSION } from '../src/net/protocol.js';

const code = (process.argv[2] || '').toUpperCase();
let url = (process.argv[3] || 'ws://127.0.0.1:8787').replace(/^http/i, 'ws').replace(/\/+$/, '');
if (!url.endsWith('/ws')) url += '/ws';
if (!code) { console.error('Укажите код комнаты: node scripts/net-bot.mjs ABCDE [адрес сервера]'); process.exit(1); }

const world = new World(createProfile(), { seed: 1, duel: true });
world.recording = false;
const ws = new WebSocket(url);
const net = new NetSession(world, (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); });
const prev = {}, cur = {}, input = emptyInput();
let lastState = '', kickHold = 0, wasHeld = false, fix = 0, fixN = 0;

ws.on('open', () => ws.send(JSON.stringify({ t: 'join', v: NET_VERSION, code, name: 'Бот' })));
ws.on('message', (data) => {
  const m = JSON.parse(data.toString());
  net.handle(m, performance.now());
  if (m.t === 'joined') ws.send(JSON.stringify({ t: 'ready' }));
  if (m.t === 'error') { console.error('Ошибка входа:', m.code); process.exit(1); }
  if (m.t === 'closed') { console.log('Комната закрыта:', m.reason); process.exit(0); }
});
ws.on('close', () => { console.log('Соединение закрыто'); process.exit(0); });
ws.on('error', (e) => { console.error('Нет соединения с', url, e.message); process.exit(1); });

// Поведение: держаться между мячом и своими воротами; мяч на своей половине — подойти и пробить
function think() {
  const p = world.players[net.me], b = world.ball, mineHalf = b.x * p.side > 0.2;
  Object.assign(input, emptyInput());
  const tx = mineHalf ? b.x + p.side * 0.5 : p.side * 5.5, tz = mineHalf ? b.z : b.z * 0.6;
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
  if (d > 0.25 && !p.kick) { input.mx = dx / d; input.mz = dz / d; }
  const near = Math.hypot(b.x - p.x, b.z - p.z) < 1.6 && mineHalf;
  if (near && !p.kick && kickHold <= 0) kickHold = 30 + Math.floor(Math.random() * 30);
  if (kickHold > 0) { kickHold--; input.kickHeld = true; input.kickPressed = !wasHeld; input.mz = Math.sin(world.tick / 37) * 0.8; }
  wasHeld = input.kickHeld;
}

const dt = 1000 / world.P.simHz;
let last = performance.now(), acc = 0, pingAt = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(250, now - last); last = now;
  if (net.snap) {
    const p = world.players[Math.max(0, net.me)], bx = p.x, bz = p.z, had = net.hasState;
    net.reconcile(prev, cur);
    const q = world.players[net.me];
    if (had && net.playing) { fix = Math.max(fix, Math.hypot(q.x - bx, q.z - bz)); fixN++; }
  }
  net.serverEvents.length = 0;
  if (net.state !== lastState) {
    lastState = net.state;
    console.log(`[бот] ${net.state}` + (net.lobby ? ` · счёт ${net.lobby.goals.join(':')}` : ''));
    if (net.state === 'over') setTimeout(() => ws.send(JSON.stringify({ t: 'rematch' })), 1500);
  }
  if (!net.playing) { acc = 0; return; }
  let n = 0;
  while (acc >= dt && n < 16) { think(); net.step(input); acc -= dt; n++; }
  if (n === 16) acc = 0;
  net.flush();
  if (now - pingAt > 2000) {
    pingAt = now; ws.send(JSON.stringify({ t: 'ping', c: now }));
    console.log(`[бот] пинг ${Math.round(net.rtt)} мс · доигрывается шагов ${net.replayed} · макс. поправка своего игрока ${fix.toFixed(3)} м (${fixN} сверок) · счёт ${world.goals.join(':')}`);
    fix = 0; fixN = 0;
  }
}, 4);
