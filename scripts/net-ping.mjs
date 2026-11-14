// Замер задержки до сервера матчей по WebSocket: node scripts/net-ping.mjs [адрес]
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';

let url = (process.argv[2] || 'ws://127.0.0.1:8787').replace(/^http/i, 'ws').replace(/\/+$/, '');
if (!url.endsWith('/ws')) url += '/ws';
const ws = new WebSocket(url);
const rtts = [];
let n = 0;
ws.on('open', () => { const t = setInterval(() => { if (n++ >= 40) { clearInterval(t); done(); } else ws.send(JSON.stringify({ t: 'ping', c: performance.now() })); }, 50); });
ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.t === 'pong') rtts.push(performance.now() - m.c); });
ws.on('error', (e) => { console.error('Нет соединения с', url, e.message); process.exit(1); });
function done() {
  setTimeout(() => {
    rtts.sort((a, b) => a - b);
    const q = (p) => rtts[Math.min(rtts.length - 1, Math.floor(p * rtts.length))];
    console.log(`${url}: ответов ${rtts.length}/40 · пинг мин ${q(0).toFixed(0)} мс · медиана ${q(0.5).toFixed(0)} мс · 90% ${q(0.9).toFixed(0)} мс · макс ${q(1).toFixed(0)} мс`);
    ws.close(); process.exit(0);
  }, 1500);
}
