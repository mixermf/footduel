// Дуэль и сеть: второй игрок в симуляции, сохранение состояния, комната сервера, предсказание клиента.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, emptyInput } from '../src/sim/world.js';
import { createProfile } from '../src/sim/profile.js';
import { Room } from '../server/room.js';
import { NetSession } from '../src/net/session.js';
import { REJOIN_MS, COUNTDOWN_MS } from '../src/net/protocol.js';

const inp = (o = {}) => Object.assign(emptyInput(), o);
const TICK = 1000 / 120;

test('дуэль: оба игрока на своих половинах, игрок справа бьёт влево и забивает', () => {
  const w = new World(createProfile(), { seed: 3, duel: true });
  assert.equal(w.players.length, 2);
  assert.ok(w.players[0].x < 0 && w.players[1].x > 0);
  // оба бегут к центру: линию не пересекает ни один
  for (let i = 0; i < 360; i++) w.step(inp({ mx: 1 }), inp({ mx: -1 }));
  assert.ok(w.players[0].x < 0, 'игрок 0 остался слева');
  assert.ok(w.players[1].x > 0, 'игрок 1 остался справа');

  // мяч у правого игрока: удар должен лететь к левым воротам
  w.reset('duel');
  w._kickoff(1, true);
  let kick = null, goal = null;
  for (let i = 0; i < 900 && !goal; i++) {
    w.step(inp(), inp({ kickHeld: i < 60, kickPressed: i === 0 }));
    for (const e of w.events) {
      if (e.type === 'kick') { kick = e; assert.ok(w.ball.vx < -5, 'мяч после удара летит влево'); }
      if (e.type === 'goal') goal = e;
    }
  }
  assert.ok(kick, 'удар состоялся');
  assert.equal(kick.pi, 1, 'событие помечено номером игрока');
  if (goal) { assert.equal(goal.by, 1); assert.deepEqual(w.goals, [0, 1]); assert.equal(w.kickTo, 0, 'мяч вводит пропустивший'); }
});

test('дуэль: матч до нужного числа голов, затем ввод остановлен до сброса', () => {
  const P = createProfile();
  P.match.goalsToWin = 2;
  const w = new World(P, { seed: 5, duel: true });
  const shoot = () => { const b = w.ball; b.x = 7; b.y = 0.5; b.z = 0; b.vx = 20; b.vy = 0; b.vz = 0; };
  let over = null;
  for (let n = 0; n < 2; n++) {
    shoot();
    for (let i = 0; i < 400; i++) {
      w.step(inp(), inp());
      for (const e of w.events) if (e.type === 'match_over') over = e;
      if (w.phase === 'play' && w.goals[0] === n + 1) break;
      if (w.phase === 'over') break;
    }
  }
  assert.deepEqual(w.goals, [2, 0]);
  assert.equal(w.phase, 'over');
  assert.equal(over.winner, 0);
  const x = w.players[0].x;
  for (let i = 0; i < 120; i++) w.step(inp({ kickPressed: i === 0, kickHeld: true }), inp());
  assert.equal(w.players[0].kick, null, 'после конца матча удары не начинаются');
  assert.equal(w.phase, 'over');
  assert.ok(Math.abs(w.players[0].x - x) < 1e-9);
});

test('состояние: сохранение через JSON и восстановление дают ту же траекторию', () => {
  const a = new World(createProfile(), { seed: 9, duel: true });
  const b = new World(createProfile(), { seed: 1, duel: true });
  const script = (i) => [
    inp({ mx: Math.sin(i / 40), mz: Math.cos(i / 55), sprintHeld: i % 200 > 120, kickHeld: i % 150 < 40, kickPressed: i % 150 === 0, jumpPressed: i % 260 === 130 }),
    inp({ mx: -Math.cos(i / 35), mz: Math.sin(i / 60), kickHeld: i % 170 < 30, kickPressed: i % 170 === 0, receivePressed: i % 90 === 0 }),
  ];
  for (let i = 0; i < 500; i++) a.step(...script(i));
  for (let k = 0; k < 6; k++) {
    b.loadState(JSON.parse(JSON.stringify(a.saveState())));
    assert.equal(b.hash(), a.hash());
    for (let i = 500 + k * 150; i < 650 + k * 150; i++) { a.step(...script(i)); b.step(...script(i)); }
    assert.equal(b.hash(), a.hash(), 'расхождение после восстановления, отрезок ' + k);
  }
});

// ---------- стенд: комната и два клиента с задержкой сети ----------
function rig({ delay = 6, jitter = 0 } = {}) {
  const room = new Room('TEST1', 7);
  const wire = []; // { at, fn }
  let now = 0, rnd = 12345;
  const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  const later = (fn) => wire.push({ at: now + delay + Math.floor(rand() * (jitter + 1)), fn });
  const clients = [0, 1].map(() => {
    const c = { world: new World(createProfile(), { seed: 1, duel: true }), slot: -1, prev: {}, cur: {}, maxOwnFix: 0, live: [] };
    c.world.recording = false;
    c.conn = { send: (str) => later(() => c.net.handle(JSON.parse(str), now * TICK)), close() {} };
    c.net = new NetSession(c.world, (obj) => { const s = JSON.stringify(obj); later(() => room.message(c.slot, JSON.parse(s))); });
    return c;
  });
  const pump = (ticks, inputs = () => [inp(), inp()]) => {
    for (let n = 0; n < ticks; n++) {
      now++;
      // сообщения доставляются по порядку (как TCP), даже при разной задержке
      while (wire.length && wire[0].at <= now) wire.shift().fn();
      const ins = inputs(now);
      for (let i = 0; i < 2; i++) {
        const c = clients[i];
        if (c.net.snap) {
          const before = c.net.hasState ? { x: c.world.players[i].x, z: c.world.players[i].z } : null;
          c.net.reconcile(c.prev, c.cur);
          if (before && c.net.playing) c.maxOwnFix = Math.max(c.maxOwnFix, Math.hypot(c.world.players[i].x - before.x, c.world.players[i].z - before.z));
        }
        if (c.net.playing) {
          c.net.step(ins[i]);
          for (const e of c.world.events) c.live.push(e);
          if (now % 2 === 0) c.net.flush();
        }
      }
      room.update(TICK);
    }
  };
  return { room, clients, pump, get now() { return now; } };
}

function startMatch(r) {
  r.clients[0].slot = r.room.join(r.clients[0].conn, 'Аня');
  r.clients[1].slot = r.room.join(r.clients[1].conn, '<b>Боб</b>');
  r.pump(20);
  r.room.message(0, { t: 'ready' }); r.room.message(1, { t: 'ready' });
  r.pump(Math.ceil(COUNTDOWN_MS / TICK) + 30);
}

test('комната: создание, вход, готовность, отсчёт, игра; третий не входит', () => {
  const r = rig();
  r.clients[0].slot = r.room.join(r.clients[0].conn, 'Аня');
  r.pump(10);
  assert.equal(r.room.state, 'waiting');
  assert.equal(r.clients[0].net.me, 0);
  assert.equal(r.clients[0].net.code, 'TEST1');
  r.clients[1].slot = r.room.join(r.clients[1].conn, '<b>Боб</b>');
  r.pump(10);
  assert.equal(r.room.state, 'loading');
  assert.equal(r.clients[1].net.lobby.players[1].name, 'bБоб/b', 'разметка из имени убрана');
  assert.equal(r.room.join({ send() {}, close() {} }, 'лишний'), -1);
  r.room.message(0, { t: 'ready' });
  r.pump(10);
  assert.equal(r.room.state, 'loading', 'ждём второго');
  r.room.message(1, { t: 'ready' });
  r.pump(10);
  assert.equal(r.room.state, 'countdown');
  assert.equal(r.clients[0].net.state, 'countdown');
  assert.ok(r.clients[1].net.snap || r.clients[1].net.hasState, 'стартовое состояние пришло до начала');
  r.pump(Math.ceil(COUNTDOWN_MS / TICK) + 20);
  assert.equal(r.room.state, 'play');
  assert.ok(r.clients[0].net.playing && r.clients[1].net.playing);
});

test('синхронизация: свой игрок отзывается сразу, после остановки миры сходятся с сервером', () => {
  for (const net of [{ delay: 3 }, { delay: 9, jitter: 4 }]) {
    const r = rig(net);
    startMatch(r);
    const t0 = r.room.world.tick;
    // игрок 0 ведёт мяч вправо и бьёт; игрок 1 бежит по диагонали
    r.pump(1, () => [inp({ mx: 1 }), inp({ mz: 1 })]);
    assert.ok(r.clients[0].world.players[0].vx > 0, 'клиент двинул своего игрока в тот же шаг, не дожидаясь сервера');
    assert.equal(r.room.world.players[0].vx, 0, 'сервер этот ввод ещё не получил');
    r.pump(150, (n) => [inp({ mx: 1 }), inp({ mz: n % 80 < 40 ? 1 : -1, mx: -0.5, digital: false })]);
    r.pump(60, (n) => [inp({ kickHeld: true, kickPressed: false }), inp({ mx: -1 })]);
    r.pump(200, () => [inp(), inp()]);
    r.pump(120);
    assert.ok(r.room.world.tick - t0 > 400, 'сервер считал матч');
    const s = r.room.world;
    for (let i = 0; i < 2; i++) {
      const c = r.clients[i], w = c.world;
      for (let j = 0; j < 2; j++) {
        assert.ok(Math.abs(w.players[j].x - s.players[j].x) < 1e-6 && Math.abs(w.players[j].z - s.players[j].z) < 1e-6, `клиент ${i}: игрок ${j} совпал с сервером`);
      }
      assert.ok(Math.hypot(w.ball.x - s.ball.x, w.ball.z - s.ball.z) < 0.05, `клиент ${i}: мяч совпал с сервером`);
      // при ровной сети собственное предсказание почти не исправляется; с джиттером — небольшие поправки
      assert.ok(c.maxOwnFix < (net.jitter ? 0.25 : 0.05), `клиент ${i}: поправка своего игрока ${c.maxOwnFix.toFixed(4)} м`);
      assert.ok(c.net.pending.length < 60, 'неподтверждённый ввод не копится');
    }
    assert.ok(r.clients[0].live.some((e) => e.type === 'touch' && e.pi === 0), 'свои касания клиент слышит из предсказания');
  }
});

test('события соперника и голы приходят с сервера; конец матча и реванш', () => {
  const r = rig();
  r.room.world.P.match.goalsToWin = 1;
  startMatch(r);
  const b = r.room.world.ball;
  b.x = 7; b.y = 0.5; b.z = 0; b.vx = 20; b.vy = 0; b.vz = 0;
  r.pump(120);
  assert.equal(r.room.state, 'over');
  for (const c of r.clients) {
    assert.equal(c.net.state, 'over');
    assert.equal(c.net.lobby.winner, 0);
    assert.deepEqual(c.net.lobby.goals, [1, 0]);
    assert.ok(c.net.serverEvents.some((e) => e.type === 'goal' && e.by === 0));
    assert.ok(c.net.serverEvents.some((e) => e.type === 'match_over'));
  }
  r.room.message(0, { t: 'rematch' });
  r.pump(20);
  assert.equal(r.room.state, 'over');
  assert.equal(r.clients[1].net.lobby.players[0].rematch, true);
  r.room.message(1, { t: 'rematch' });
  r.pump(20);
  assert.equal(r.room.state, 'countdown');
  assert.deepEqual(r.room.world.goals, [0, 0]);
  r.pump(Math.ceil(COUNTDOWN_MS / TICK) + 20);
  assert.equal(r.room.state, 'play');
  assert.equal(r.clients[0].world.phase, 'play');
});

test('обрыв связи: пауза, возврат по токену продолжает матч; без возврата комната закрывается', () => {
  const r = rig();
  startMatch(r);
  r.pump(100, () => [inp({ mx: 1 }), inp({ mx: -1 })]);
  const tick = r.room.world.tick, token = r.clients[1].net.token;
  r.room.drop(1, r.clients[1].conn, false);
  r.pump(30);
  assert.equal(r.room.state, 'paused');
  assert.equal(r.clients[0].net.state, 'paused');
  assert.equal(r.clients[0].net.lobby.players[1].connected, false);
  r.pump(200);
  assert.equal(r.room.world.tick, tick, 'на паузе матч стоит');
  assert.equal(r.room.rejoin(r.clients[1].conn, 'чужой-токен', 0), -1);
  r.clients[1].net.resetInput();
  assert.equal(r.room.rejoin(r.clients[1].conn, token, r.clients[1].net.seq), 1);
  r.pump(400);
  assert.equal(r.room.state, 'play');
  r.pump(120, () => [inp(), inp({ mz: 1 })]);
  assert.ok(r.room.world.players[1].vz > 0, 'ввод вернувшегося игрока снова доходит');

  r.room.drop(0, r.clients[0].conn, false);
  r.pump(Math.ceil(REJOIN_MS / TICK) + 60);
  assert.equal(r.room.closed, true);
  assert.equal(r.clients[1].net.closed, 'opponent_timeout');
});

test('сервер: без ввода удержание сохраняется недолго, затем игрок останавливается; мусор отбрасывается', () => {
  const r = rig();
  startMatch(r);
  r.pump(60, () => [inp({ mx: 1, sprintHeld: true }), inp()]);
  assert.ok(r.room.world.players[0].vx > 2);
  // клиент 0 «завис»: ввод больше не приходит
  r.clients[0].net.lobby = { ...r.clients[0].net.lobby, state: 'frozen' };
  r.pump(120);
  assert.ok(Math.abs(r.room.world.players[0].vx) < 0.05, 'после простоя сервер отпустил ввод');
  const q = r.room.slots[1].queue.length;
  r.room.message(1, { t: 'in', s: 1e6, f: [[1, 2], 'x'] });
  r.room.message(1, { t: 'in', s: 1e6, f: 'нет' });
  r.room.message(1, { t: 'in', s: r.room.slots[1].recv + 1, f: [[99999, -99999, 0xffff]] });
  const f = r.room.slots[1].queue.at(-1);
  assert.equal(r.room.slots[1].queue.length, q + 1);
  assert.deepEqual(f, [1000, -1000, 0x23ff], 'кадр обрезан до допустимых значений, команды песочницы вырезаны');
});

test('возврат после скрытого окна: сервер не копит состояния, клиент берёт последнее без догоняния', () => {
  const r = rig({ delay: 4 });
  startMatch(r);
  r.pump(120, () => [inp({ mx: 1 }), inp({ mz: 1 })]);
  const c = r.clients[1];
  let sent = 0;
  const realSend = c.conn.send;
  c.conn.send = (str) => { if (str.startsWith('{"t":"s"')) sent++; realSend(str); };

  // окно клиента 1 скрыто: он перестаёт шагать, сервер перестаёт слать ему состояния и отпускает его ввод
  c.net.hold();
  r.pump(10);
  sent = 0;
  const frozenTick = c.world.tick;
  r.pump(600, () => [inp({ mx: -1 }), inp({ mz: 1 })]);
  assert.equal(sent, 0, 'скрытому клиенту состояния не отправляются');
  assert.equal(c.world.tick, frozenTick, 'скрытый клиент не шагает');
  assert.ok(Math.abs(r.room.world.players[1].vz) < 0.05, 'игрок скрытого клиента стоит');
  assert.ok(r.room.world.tick - frozenTick > 550, 'матч на сервере идёт дальше');

  // возврат: одно свежее состояние, ни одного доигранного шага, никаких старых событий
  c.net.serverEvents.push({ type: 'kick' });
  c.net.snap = { stale: true };
  c.net.resync();
  assert.equal(c.net.snap, null);
  assert.equal(c.net.serverEvents.length, 0);
  assert.equal(c.net.playing, false, 'до подтверждения синхронизации клиент не шагает');
  r.pump(12);
  assert.equal(c.net.waitSync, 0);
  assert.ok(c.net.playing);
  assert.ok(Math.abs(c.world.tick - r.room.world.tick) < 20, 'клиент сразу на текущем шаге сервера');
  assert.ok(c.net.replayed <= 12, 'доигрывается только свежий ввод: ' + c.net.replayed);
  assert.equal(Math.hypot(c.net.err.p[0].x, c.net.err.p[0].z, c.net.err.b.x, c.net.err.b.z), 0, 'без «резинки» к старому положению');
  r.pump(120, () => [inp(), inp({ mz: -1 })]);
  assert.ok(r.room.world.players[1].vz < -1, 'после возврата ввод снова доходит');
  for (let j = 0; j < 2; j++) assert.ok(Math.abs(c.world.players[j].x - r.room.world.players[j].x) < 0.5);
});

test('соперник показывается по подтверждённым состояниям сервера: плавно и без поправок-скачков', () => {
  const r = rig({ delay: 12, jitter: 3 }); // около 200 мс пинга
  startMatch(r);
  const c = r.clients[0], view = {};
  let maxStep = 0, last = null, n = 0;
  // соперник мечется из стороны в сторону: угадать его на 200 мс вперёд нельзя
  const script = (t) => [inp(), inp({ mz: Math.floor(t / 45) % 2 ? 1 : -1, sprintHeld: true })];
  for (let i = 0; i < 900; i++) {
    r.pump(1, script);
    if (i % 2 === 0 && c.net.remoteView(view, 1 / 60)) {
      if (last !== null && i > 200) { maxStep = Math.max(maxStep, Math.abs(view.pz - last)); n++; }
      last = view.pz;
    }
  }
  assert.ok(n > 300);
  assert.ok(maxStep < 0.11, 'показанный соперник за кадр смещается не больше хода на скорости спринта: ' + maxStep.toFixed(3) + ' м');
  const srv = r.room.world.players[1];
  assert.ok(Math.abs(view.pz - srv.z) < 1.6, 'показанное положение — недавнее положение сервера');
});
