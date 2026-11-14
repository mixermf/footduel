// Soccer Duel Desktop — песочница и сетевая дуэль. Запуск, фиксированный шаг симуляции, пауза, связывание систем.
import { World, emptyInput, unpackInput, SCENARIOS } from './sim/world.js';
import { createProfile } from './sim/profile.js';
import { Input } from './input/input.js';
import { GameScene } from './render/scene.js';
import { PlayerRig } from './render/playerRig.js';
import { Hud } from './ui/hud.js';
import { Sfx } from './audio/sfx.js';
import { NetClient } from './net/client.js';
import { Lobby } from './net/lobby.js';
import { BALL_EVENTS } from './net/protocol.js';

const LAB_ENABLED = import.meta.env.DEV || import.meta.env.MODE === 'lab';
const SETTINGS_KEY = 'soccer-duel-desktop.settings.v1';
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

function loadSettings() {
  const def = { sfx: 0.8, music: 0.5, vibration: true, shake: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return def; }
}

const profile = createProfile();
const sandbox = new World(profile, { seed: (Date.now() & 0xffff) || 1 });
// Сетевая дуэль считается на отдельном мире со своим профилем: правки лаборатории не расходятся с сервером
const duel = new World(createProfile(), { seed: 1, duel: true });
duel.recording = false;

const game = {
  world: sandbox,
  input: new Input({ deadzone: profile.input.deadzone }),
  scene: new GameScene(document.getElementById('game'), profile),
  rig: new PlayerRig(), rig2: new PlayerRig(),
  hud: new Hud(document.getElementById('hud'), document.getElementById('overlay')),
  sfx: new Sfx(),
  settings: loadSettings(),
  mode: 'sandbox', net: null,
  state: 'loading', timeScale: 1, simPaused: false, stepOnce: false,
  replay: null, fps: 60, lab: null, serveIndex: 0,
};
window.__game = LAB_ENABLED ? game : undefined;

const { input, scene, rig, rig2, hud, sfx } = game;
let world = sandbox;
const simDt = world.dt;
let acc = 0, last = performance.now();
let prev = duel.snapshot(), cur = duel.snapshot();
const view = duel.snapshot();
const frameIn = emptyInput();
const ZERO = { x: 0, y: 0, z: 0 };

function applySettings() {
  sfx.volume = game.settings.sfx; sfx.musicVolume = game.settings.music;
  scene.shakeEnabled = game.settings.shake;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(game.settings)); } catch { /* ignore */ }
}
applySettings();

function setMode(mode) {
  game.mode = mode;
  world = mode === 'online' ? duel : sandbox;
  game.world = world;
  game.replay = null; sandbox.recording = true;
  rig2.root.visible = mode === 'online';
  scene.setReboundWall(mode === 'online' ? false : sandbox.P.field.reboundWall);
  scene.shake = 0;
  input.pressed.clear();
  acc = 0; world.snapshot(prev); world.snapshot(cur);
}

game.resetSandbox = (scenario = world.scenario) => {
  if (game.mode !== 'sandbox') return;
  game.replay = null;
  world.reset(scenario);
  input.pressed.clear();
  acc = 0; world.snapshot(prev); world.snapshot(cur);
  scene.shake = 0;
  scene.setReboundWall(world.P.field.reboundWall);
  hud.showToast(SCENARIOS[scenario].label, { ms: 700 });
};

game.startReplay = () => {
  if (game.mode !== 'sandbox') return;
  const frames = world.inputLog.map((f) => f.slice());
  const scenario = world.scenario;
  world.P.field.reboundWall = world.startWall;
  world.reset(scenario);
  scene.setReboundWall(world.startWall);
  world.recording = false;
  acc = 0; world.snapshot(prev); world.snapshot(cur);
  game.replay = { frames, i: 0 };
  hud.showToast('Повтор записи', { ms: 700 });
};

game.exportLog = () => {
  const data = { seed: world.seed, profile: { ...world.P, field: { ...world.P.field, reboundWall: world.startWall } }, scenario: world.scenario, frames: world.inputLog, stats: world.stats };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `soccer-duel-log-${world.seed}-${world.tick}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ---------- меню ----------
const CONTROLS = [
  ['Движение / прицел в окне удара', 'WASD, стрелки', 'левый стик, крестовина'],
  ['Заряд и удар при отпускании', 'J', 'X / □'],
  ['Прыжок; при владении — подброс', 'Пробел', 'Y / △'],
  ['Точный приём; удержание — близкий контроль', 'E', 'A / × ; RT / R2'],
  ['Разворот к воротам и контроль', 'Q', 'LT / L2'],
  ['Спринт', 'C, Shift', 'RB / R1'],
  ['Вернуть мяч; подача; щит вместо ворот (песочница)', 'R; F; G', 'меню паузы'],
  ['Финт, суперудар', 'T, X', 'B / ○, LB / L1 — следующий этап'],
];

const pct = (v) => Math.round(v * 100) + '%';
const onoff = (v) => (v ? 'вкл' : 'выкл');
function settingsItems() {
  const adj = (key) => (d) => { game.settings[key] = Math.max(0, Math.min(1, Math.round((game.settings[key] + d * 0.1) * 10) / 10)); applySettings(); sfx.play('ui'); };
  const tog = (key) => () => { game.settings[key] = !game.settings[key]; applySettings(); };
  return [
    { label: 'Громкость эффектов', value: () => pct(game.settings.sfx), adjust: adj('sfx') },
    { label: 'Громкость музыки', value: () => pct(game.settings.music) + ' (музыки пока нет)', adjust: adj('music') },
    { label: 'Вибрация геймпада', value: () => onoff(game.settings.vibration), act: tog('vibration'), adjust: tog('vibration') },
    { label: 'Тряска камеры', value: () => onoff(game.settings.shake), act: tog('shake'), adjust: tog('shake') },
    { label: 'Сбросить раскладку по умолчанию', act: () => { input.resetBindings(); hud.showToast('Раскладка сброшена'); } },
  ];
}

function mainMenu() {
  if (game.net) { game.net.leave(); game.net = null; }
  lobby.close();
  setMode('sandbox');
  game.state = 'menu';
  hud.openMenu('Soccer Duel', 'Enter / A — выбрать, ↑↓ — пункт.', [
    { label: 'Песочница', act: () => { hud.closeMenu(); input.suppressHeld(); game.state = 'play'; last = performance.now(); acc = 0; } },
    { label: 'Игра по сети: создать комнату', act: () => openLobby('create') },
    { label: 'Игра по сети: войти по коду', act: () => openLobby('join') },
    ...settingsItems(),
  ], CONTROLS);
}

function openLobby(kind, code = '') {
  hud.closeMenu();
  setMode('online');
  duel.reset('duel'); duel.snapshot(prev); duel.snapshot(cur);
  game.state = 'play';
  lobby.openForm(kind, code);
}

const lobby = new Lobby(document.getElementById('net'), {
  submit(kind, code, name) {
    const net = new NetClient(duel);
    game.net = net;
    if (kind === 'create') net.create(name); else net.join(code, name);
  },
  leave: () => mainMenu(),
  rematch: () => game.net?._send({ t: 'rematch' }),
  retry: () => game.net?.retry(),
});

function pause(reason) {
  if (game.state !== 'play') return;
  if (game.mode === 'online') {
    // сетевой матч не останавливается: меню открывается поверх, ввод игрока отпускается
    if (!game.net?.session.playing) return;
    game.state = 'pause';
    game.net.session.neutral();
    hud.openMenu('Меню матча', reason || 'Матч продолжается. Esc — вернуться в игру.', [
      { label: 'Продолжить', act: resume },
      { label: 'Выйти из матча', act: () => mainMenu() },
      ...settingsItems(),
    ], CONTROLS);
    return;
  }
  game.state = 'pause';
  world.clearActions();
  hud.openMenu('Пауза', reason || 'Enter / A — выбрать, ↑↓ — пункт, ←→ — значение, Esc — продолжить.', [
    { label: 'Продолжить', act: resume },
    { label: 'Вернуть мяч', act: () => { pending.ret = true; resume(); } },
    { label: 'Тренировочная подача', act: () => { resume(); nextServe(); } },
    { label: 'Щит вместо правых ворот', value: () => onoff(world.P.field.reboundWall), act: toggleWall, adjust: toggleWall },
    { label: 'Сбросить песочницу', act: () => { game.resetSandbox('free'); resume(); } },
    { label: 'Главное меню и игра по сети', act: () => mainMenu() },
    ...settingsItems(),
  ], CONTROLS);
}

function resume() {
  if (game.state !== 'pause') return;
  hud.closeMenu();
  input.suppressHeld(); // удержанное до паузы не срабатывает, пока не отпущено
  game.state = 'play';
  last = performance.now(); acc = 0;
}

// автопаузу можно отключить только в лаборатории (?autopause=0) — для автоматических прогонов
const AUTO_PAUSE = !(LAB_ENABLED && new URLSearchParams(location.search).get('autopause') === '0');
function lostFocus(text) {
  input.releaseAll();
  if (game.mode === 'online') { if (game.net?.session.playing) game.net.session.neutral(); return; } // сетевой матч идёт дальше
  if (AUTO_PAUSE) pause(text);
}
window.addEventListener('blur', () => lostFocus('Окно потеряло фокус. Enter / A — продолжить.'));
document.addEventListener('visibilitychange', () => { if (document.hidden) lostFocus('Окно было скрыто. Enter / A — продолжить.'); });
game.manualFrame = (dt) => runFrame(last + dt * 1000);
input.onDeviceLost = () => pause('Геймпад отключён. Enter — продолжить на клавиатуре.');
window.addEventListener('pointerdown', () => sfx.unlock());
window.addEventListener('keydown', () => sfx.unlock());

// Команды песочницы уходят в симуляцию через кадр ввода ближайшего шага и попадают в журнал
const pending = { ret: false, serve: false, wall: false };
function toggleWall() { pending.wall = true; }
function nextServe() { pending.serve = true; }

// ---------- события симуляции → звук, HUD, эффекты ----------
// me — номер своего игрока в сетевой игре (в песочнице 0); чужие события дают звук и вспышку, но не подсказки и вибрацию
function handleEvents(events, me = 0, accept = null) {
  const b = world.ball;
  for (const e of events) {
    if (accept && !accept(e)) continue;
    const mine = e.pi === undefined || e.pi === me;
    switch (e.type) {
      case 'ball_return': hud.showToast('Мяч возвращён', { ms: 500 }); break;
      case 'feed': if (SCENARIOS[e.kind]) hud.showToast(SCENARIOS[e.kind].label, { ms: 600 }); break;
      case 'wall_toggle':
        scene.setReboundWall(e.on);
        hud.showToast(e.on ? 'Щит вместо ворот: мяч возвращается' : 'Ворота открыты', { ms: 800 });
        break;
      case 'touch': sfx.play('touch'); scene.contactFlash(b.x, 0.02, b.z, 0); break;
      case 'kick':
        sfx.play('kick', Math.min(1, e.speed / 24)); scene.contactFlash(b.x, b.y, b.z, 0.6 + e.charge + (e.firstTime ? 0.5 : 0));
        scene.shake = 0.03 + 0.09 * Math.min(1, e.speed / 24);
        if (!mine) break;
        if (e.jump) hud.showToast('Удар в прыжке!', { ms: 600 });
        else if (e.volley) hud.showToast('С лёта!', { ms: 500 });
        else if (e.firstTime) hud.showToast('В касание!', { ms: 450 });
        if (game.settings.vibration) input.rumble(0.3 + 0.6 * e.charge, 90);
        break;
      case 'receive':
        sfx.play(e.quality >= 1 ? 'receive' : 'receive_bad');
        if (!mine) break;
        hud.showToast(e.quality >= 1 ? 'Точный приём' : 'Неполный приём', { ms: 600 });
        if (game.settings.vibration) input.rumble(0.25, 60);
        break;
      case 'header': sfx.play('body', 0.6); if (mine) hud.showToast('Игра головой', { ms: 500 }); break;
      case 'body': sfx.play('body', e.speed / 15); break;
      case 'wall': sfx.play(e.surface === 'board' ? 'wall' : 'net', e.speed / 18); break;
      case 'post': sfx.play('post', e.speed / 20); scene.shake = Math.max(scene.shake, 0.03); break;
      case 'bounce': sfx.play('bounce', e.speed / 10); break;
      case 'goal': {
        const scored = e.by === undefined ? e.scored : e.by === me;
        sfx.play('goal'); hud.showToast(scored ? 'ГОЛ!' : 'Пропущен', { big: true, ms: 1100 });
        if (game.settings.vibration) input.rumble(0.8, 200);
        break;
      }
      case 'kickoff': hud.showToast(e.to === me ? 'Мяч у вас' : 'Мяч у соперника', { ms: 700 }); break;
      case 'kick_cancel': if (mine) { sfx.play('cancel'); hud.showToast('Удар отменён: ' + e.reason, { ms: 800 }); } break;
      case 'kick_miss': if (mine) { sfx.play('cancel'); hud.showToast('Мимо мяча', { ms: 600 }); } break;
      case 'kick_empty': if (mine) hud.showToast('Мяч далеко', { ms: 500 }); break;
      case 'control_lost': if (mine) hud.showToast('Потеря контроля', { ms: 600 }); break;
      default: break;
    }
  }
}

// ---------- главный цикл ----------
function frame(now) {
  requestAnimationFrame(frame);
  if (game.manual) return; // лаборатория: кадры подаются вручную (автотесты, покадровый разбор)
  runFrame(now);
}

function stepSandbox(dtReal) {
  let simSteps = 0;
  if (game.state !== 'play') return;
  if (!game.replay) {
    if (input.take('ballReturn')) pending.ret = true;
    if (input.take('serve')) nextServe();
    if (input.take('wall')) toggleWall();
    if (input.pressed.has('feint') || input.pressed.has('super')) hud.showToast('Финты и суперудар — следующий этап', { ms: 700 });
  }
  if (game.simPaused) { acc = game.stepOnce ? simDt : 0; game.stepOnce = false; }
  else acc += dtReal * game.timeScale;
  while (acc >= simDt && simSteps < 16) {
    const t = prev; prev = cur; cur = t;
    if (game.replay) {
      const r = game.replay;
      if (r.i >= r.frames.length) { game.replay = null; world.recording = true; hud.showToast('Повтор завершён', { ms: 700 }); break; }
      unpackInput(r.frames[r.i++], frameIn);
    } else {
      input.fill(frameIn, simSteps === 0);
      frameIn.cmdReturn = pending.ret; frameIn.cmdServe = pending.serve; frameIn.cmdWall = pending.wall;
      pending.ret = pending.serve = pending.wall = false;
    }
    world.step(frameIn);
    handleEvents(world.events);
    game.lab?.onTick(world, frameIn);
    world.snapshot(cur);
    acc -= simDt; simSteps++;
  }
  if (simSteps > 0) input.endFrameEdges();
  if (simSteps === 16) acc = 0; // просадка: время теряется, физика не ускоряется и не догоняет рывком
}

// Сетевой матч: состояние сервера → доигрывание своего ввода → локальные шаги с предсказанием
function stepOnline(dtReal, now) {
  const net = game.net;
  if (!net) { acc = 0; return; }
  net.update(now);
  const s = net.session, me = s.me;
  s.reconcile(prev, cur);
  if (s.serverEvents.length) {
    handleEvents(s.serverEvents, me, (e) => e.pi !== me && !BALL_EVENTS.has(e.type));
    s.serverEvents.length = 0;
  }
  if (!s.playing) { acc = 0; s.clearError(); return; }
  acc += dtReal;
  let simSteps = 0;
  const active = game.state === 'play' && !document.hidden;
  while (acc >= simDt && simSteps < 16) {
    const t = prev; prev = cur; cur = t;
    if (active) input.fill(frameIn, simSteps === 0); else Object.assign(frameIn, emptyInput());
    s.step(frameIn);
    handleEvents(world.events, me, (e) => e.pi === me || BALL_EVENTS.has(e.type));
    world.snapshot(cur);
    acc -= simDt; simSteps++;
  }
  if (simSteps > 0) input.endFrameEdges();
  if (simSteps === 16) acc = 0;
  s.flush();
  s.decayError(dtReal);
}

// интерполяция одного игрока между двумя шагами симуляции; off — гаснущая поправка сетевого расхождения
function lerpPlayer(o, p0, p1, a, off) {
  o.px = p0.px + (p1.px - p0.px) * a + off.x; o.pz = p0.pz + (p1.pz - p0.pz) * a + off.z;
  o.py = Math.max(0, p0.py + (p1.py - p0.py) * a + off.y);
  o.vx = p0.vx + (p1.vx - p0.vx) * a; o.vz = p0.vz + (p1.vz - p0.vz) * a;
  o.yaw = p0.yaw + angDiff(p1.yaw, p0.yaw) * a;
  for (let i = 0; i < 2; i++) {
    const f0 = p0.feet[i], f1 = p1.feet[i], f = o.feet[i];
    f.x = f0.x + (f1.x - f0.x) * a + off.x; f.z = f0.z + (f1.z - f0.z) * a + off.z; f.h = Math.max(0, f0.h + (f1.h - f0.h) * a + off.y);
    f.yaw = f0.yaw + angDiff(f1.yaw, f0.yaw) * a; f.planted = f1.planted; f.u = f1.u; f.top = f1.top;
  }
  // фаза шага интерполируется по кругу: 0.98 → 0.02 — это шаг вперёд, а не назад
  let dgp = p1.gp - p0.gp; if (dgp > 0.5) dgp -= 1; else if (dgp < -0.5) dgp += 1;
  o.gp = (((p0.gp + dgp * a) % 1) + 1) % 1; o.gait = p1.gait;
}

function runFrame(now) {
  const dtReal = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (dtReal > 0) game.fps += (1 / dtReal - game.fps) * 0.05;
  const online = game.mode === 'online';
  const sess = online && game.net ? game.net.session : null;

  input.poll();
  const menuCmds = input.takeMenu();
  if (game.state === 'pause' || game.state === 'menu') {
    for (const c of menuCmds) {
      if ((c === 'pause' || c === 'back') && game.state === 'pause') { resume(); break; }
      hud.menuInput(c); if (c !== 'confirm') sfx.play('ui');
    }
    if (game.state === 'pause' && online && !sess?.playing) resume(); // матч кончился или прервался, пока было открыто меню
  } else if (game.state === 'play') {
    if (online && !sess?.playing) { for (const c of menuCmds) lobby.input(c === 'pause' ? 'back' : c); }
    else if (menuCmds.includes('pause')) pause();
  }

  if (online) stepOnline(dtReal, now); else stepSandbox(dtReal);
  if (online) lobby.render(game.net, now);

  // интерполяция изображения между двумя шагами симуляции
  const running = online ? !!sess?.playing : game.state === 'play' && !game.simPaused;
  const a = running ? Math.min(1, acc / simDt) : 1;
  const err = sess ? sess.err : null;
  lerpPlayer(view, prev, cur, a, err ? err.p[0] : ZERO);
  if (online) lerpPlayer(view.p2, prev.p2, cur.p2, a, err ? err.p[1] : ZERO);
  const eb = err ? err.b : ZERO;
  view.bx = prev.bx + (cur.bx - prev.bx) * a + eb.x; view.bz = prev.bz + (cur.bz - prev.bz) * a + eb.z;
  view.by = Math.max(world.P.ball.radius, prev.by + (cur.by - prev.by) * a + eb.y);

  const dtVis = running ? dtReal * (online ? 1 : game.timeScale) : 0;
  const ball = { x: view.bx, y: view.by, z: view.bz };
  const P0 = world.players[0], P1 = world.players[1];
  const mine = world.players[sess && sess.me === 1 ? 1 : 0];
  scene.updateBall(view.bx, view.by, view.bz, cur.bqx, cur.bqy, cur.bqz, cur.bqw);
  rig.update(view, { ball, kick: P0.kick, gesture: P0.gesture }, dtVis);
  if (online && P1) rig2.update(view.p2, { ball, kick: P1.kick, gesture: P1.gesture }, dtVis);
  scene.updateAim(mine.kick, world.P);
  scene.updateCamera(view.px, view.pz, view.yaw, dtReal);
  game.lab?.onFrame(dtReal);
  hud.update(dtReal, world, input, game.replay ? 'ПОВТОР' : game.timeScale !== 1 && !online ? game.timeScale + '×' : '',
    online ? { me: sess ? Math.max(0, sess.me) : 0, lobby: sess?.lobby, rtt: sess?.rtt || 0, replayed: sess?.replayed || 0 } : null);
  scene.render(dtReal);
}

async function boot() {
  const loading = document.createElement('div');
  loading.className = 'loading'; loading.textContent = 'Загрузка модели…';
  document.body.append(loading);
  try {
    const info = await rig.load(scene.scene, profile.player.height);
    await rig2.load(scene.scene, profile.player.height);
    rig2.setKit(0xff5548, 0xf2f2f2); // соперник справа — в красном
    rig2.root.visible = false;
    if (LAB_ENABLED) console.info('[rig]', info);
  } catch (err) {
    loading.textContent = 'Не удалось загрузить модель: ' + err.message;
    throw err;
  }
  if (LAB_ENABLED) {
    const { Lab } = await import('./lab/lab.js');
    game.lab = new Lab(game, document.getElementById('lab'));
  }
  loading.remove();
  last = performance.now();
  const q = new URLSearchParams(location.search);
  const room = (q.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (room) openLobby('join', room); // ссылка-приглашение
  else if (q.get('menu') === '0' && LAB_ENABLED) { game.state = 'play'; hud.showToast('Песочница · F1 — лаборатория', { ms: 1400 }); }
  else mainMenu();
  requestAnimationFrame(frame);
}

boot();
