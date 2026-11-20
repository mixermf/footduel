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
import { BALL_EVENTS, COUNTDOWN_MS, SHIRT_NUMBERS } from './net/protocol.js';
import { MatchIntro, INTRO, blendView } from './render/intro.js';
import { Bot, botSkill, botTier } from './ai/bot.js';
import { PointsHud } from './ui/points.js';
import { PointsFx } from './render/fx.js';
import { LedBoards } from './render/ledBoards.js';
import { Stickers, TONE } from './ui/stickers.js';
import { initAnalytics, track } from './analytics/analytics.js';
import { MatchTracker } from './analytics/matchTracker.js';
import { t, plural, setLang, getLang, getLangPref, autoLang, onLang, LANGS } from './i18n/i18n.js';

const LAB_ENABLED = import.meta.env.DEV || import.meta.env.MODE === 'lab';
const SETTINGS_KEY = 'soccer-duel-desktop.settings.v1';
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

function loadSettings() {
  const def = { sfx: 0.8, music: 0.5, vibration: true, shake: true, botLevel: 50, lang: 'auto' };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return def; }
}

const profile = createProfile();
const sandbox = new World(profile, { seed: (Date.now() & 0xffff) || 1 });
// Сетевая дуэль считается на отдельном мире со своим профилем: правки лаборатории не расходятся с сервером
const duel = new World(createProfile(), { seed: 1, duel: true });
duel.recording = false;
// Матч с ботом: та же дуэль, что по сети, но оба игрока считаются здесь; вы — слева (синие), бот — справа
const vsBot = new World(createProfile(), { seed: 1, duel: true });
vsBot.recording = false;
let bot = null, botOver = false;

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
setLang(game.settings.lang); game.hud.relocalize(); // до первых надписей (загрузка, меню); HUD создан раньше — переподписать
game.version = '0.6.0';

const { input, scene, rig, rig2, hud, sfx } = game;
// аналитика матчей: сколько партий, как долго, итог и причина (src/analytics/matchTracker.js)
const stats = game.stats = new MatchTracker(track);
window.addEventListener('pagehide', () => stats.abort('page_closed', game.world));
// очки дуэли: табло и разбор очков в HUD, частицы и кольца на поле
hud.points = new PointsHud(document.getElementById('hud'), (x, y, z) => scene.toScreen(x, y, z));
hud.points.onTick = (n) => sfx.play('ui', n <= 3 ? 0.9 : 0.5);
const pfx = new PointsFx(scene.scene);
// стикеры-награды за трюки и тихие заметки вместо прежнего тоста (src/ui/stickers.js)
const stickers = hud.stickers = new Stickers(document.getElementById('hud'), (x, y, z) => scene.toScreen(x, y, z));
stickers.busy = () => hud.points.busy;
let postFxAt = 0; // последний «большой» эффект штанги: не чаще раза в секунду
hud.points.onCount = (u) => sfx.play('ui', u >= 1 ? 0.7 : 0.18); // «одометр» итога щёлкает, последнее число — громче
hud.points.onArrive = (i, big) => sfx.play('ui', big ? 0.9 : 0.55);
hud.points.onReset = () => stickers.clear();
// LED-борта: реклама вымышленных брендов и «ГОЛ!» на всех экранах (src/render/ledBoards.js)
const led = new LedBoards(scene.scene, profile.field);
led.bulbs = scene.bulbs; game.led = led;
// смена языка на лету: HUD, табло очков и LED-борта пересобирают свои надписи
onLang(() => { hud.relocalize(); hud.points.relocalize(); led.relocalize(); lobby._key = ''; });
// имена в дуэли: из лобби в сети, «Вы» и «Бот» в матче с ботом
function duelNames() {
  if (game.shorts?.names) return game.shorts.names;
  const L = game.mode === 'online' ? game.net?.session.lobby : null;
  if (L) return [0, 1].map((i) => (L.players[i] ? L.players[i].name : '—'));
  return [lobby.name || t('common.you'), t('common.bot')];
}
let world = sandbox;
const simDt = world.dt;
let acc = 0, last = performance.now(), lastRaw = last;
let prev = duel.snapshot(), cur = duel.snapshot();
const view = duel.snapshot();
const frameIn = emptyInput();
game.view = view;
const ZERO = { x: 0, y: 0, z: 0 };

function applySettings() {
  sfx.volume = game.settings.sfx; sfx.musicVolume = game.settings.music;
  scene.shakeEnabled = game.settings.shake;
  setLang(game.settings.lang);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(game.settings)); } catch { /* ignore */ }
}
applySettings();

function setMode(mode) {
  game.mode = mode;
  world = mode === 'online' ? duel : mode === 'bot' ? vsBot : sandbox;
  game.world = world;
  game.replay = null; sandbox.recording = true;
  rig2.root.visible = mode !== 'sandbox';
  scene.setReboundWall(mode === 'sandbox' ? sandbox.P.field.reboundWall : false);
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
  hud.showToast(t('scn.' + scenario), { ms: 700 });
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
  hud.showToast(t('note.replay'), { ms: 700 });
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
// таблица управления — функция: строится при отрисовке меню, на текущем языке
const CONTROLS = () => {
  const sp = t('key.space'), hold = t('ctl.hold');
  return [
    [t('ctl.run'), t('ctl.arrows'), t('ctl.leftStick')],
    [t('ctl.kick'), 'D', 'X / □'],
    [t('ctl.sprint'), 'W', 'RB / R1'],
    [t('ctl.lob'), 'A', 'B / ○'],
    [t('ctl.super'), 'Q', 'LB / L1'],
    [t('ctl.juggle'), sp, 'Y / △'],
    [t('ctl.inJuggle'), 'D; A; Q', 'X / □; B / ○; LB / L1'],
    [t('ctl.afterToss'), `D (${hold}) + ${sp}`, 'X / □ + Y / △'],
    [t('ctl.high'), `D (${hold}) + ${sp}`, 'X / □ + Y / △'],
    [t('ctl.tackle'), 'A', 'B / ○'],
    [t('ctl.jump'), `${sp}; ${sp} + A`, 'Y / △; Y + B'],
    [t('ctl.guard'), `S (${t('ctl.holdDown')})`, `LT / L2; ${t('ctl.foot')} — LB / L1`],
    [t('ctl.lunge'), `S + ${t('ctl.dir')} + ${sp}`, `LT + ${t('ctl.stick')} + Y / △`],
    [t('ctl.receive'), 'E', 'A / × ; RT / R2'],
    [t('ctl.face'), 'X', 'LT / L2'],
    [t('ctl.sandbox'), 'R; F; G', t('ctl.pauseMenu')],
  ];
};

const pct = (v) => Math.round(v * 100) + '%';
const onoff = (v) => t(v ? 'common.on' : 'common.off');
const langLabel = (p) => (p === 'auto' ? t('lang.auto', { lang: t('lang.' + autoLang()) }) : t('lang.' + p));
const stepLang = (d) => () => {
  const i = LANGS.indexOf(getLangPref());
  game.settings.lang = LANGS[(i + d + LANGS.length) % LANGS.length];
  applySettings(); sfx.play('ui');
};
function settingsItems() {
  const adj = (key) => (d) => { game.settings[key] = Math.max(0, Math.min(1, Math.round((game.settings[key] + d * 0.1) * 10) / 10)); applySettings(); sfx.play('ui'); };
  const tog = (key) => () => { game.settings[key] = !game.settings[key]; applySettings(); };
  return [
    // язык: Авто (по браузеру) → Русский → English; меняется сразу, без перезагрузки
    { label: () => t('lang.name'), value: () => '◀ ' + langLabel(getLangPref()) + ' ▶', act: stepLang(1), adjust: (d) => stepLang(d)() },
    { label: () => t('menu.sfx'), value: () => pct(game.settings.sfx), adjust: adj('sfx') },
    { label: () => t('menu.music'), value: () => pct(game.settings.music) + t('menu.noMusic'), adjust: adj('music') },
    { label: () => t('menu.vibration'), value: () => onoff(game.settings.vibration), act: tog('vibration'), adjust: tog('vibration') },
    { label: () => t('menu.shake'), value: () => onoff(game.settings.shake), act: tog('shake'), adjust: tog('shake') },
    { label: () => t('menu.resetKeys'), act: () => { input.resetBindings(); hud.showToast(t('menu.keysReset')); } },
  ];
}

function mainMenu() {
  stats.abort('quit_menu', game.world); // матч брошен посреди игры (после итога учёт уже закрыт)
  if (game.net) { game.net.leave(); game.net = null; }
  lobby.close();
  setMode('sandbox');
  game.state = 'menu';
  hud.openMenu('Soccer Duel', () => t('menu.note', { v: game.version }), [
    { label: () => t('menu.sandbox'), act: () => { hud.closeMenu(); input.suppressHeld(); game.state = 'play'; last = performance.now(); acc = 0; } },
    botLevelItem(() => t('menu.bot'), () => startBotMatch()),
    { label: () => t('menu.create'), act: () => openLobby('create') },
    { label: () => t('menu.join'), act: () => openLobby('join') },
    ...(import.meta.env.DEV ? [{ label: () => t('menu.shorts'), act: () => game.shortsDirector?.open() }] : []),
    ...settingsItems(),
    { label: () => t('menu.quit'), act: quitGame },
  ], CONTROLS);
}

// Выход из игры: матч покидается, окно закрывается. Браузер не даёт закрыть вкладку, которую открыл сам пользователь, —
// тогда остаётся экран завершения с возвратом в главное меню (в desktop-упаковке окно закроется).
function quitGame() {
  stats.abort('quit_game', game.world);
  if (game.net) { game.net.leave(); game.net = null; }
  lobby.close();
  setMode('sandbox');
  game.state = 'menu';
  hud.openMenu(() => t('menu.quitTitle'), () => t('menu.quitNote'), [
    { label: () => t('menu.backToMain'), act: () => mainMenu() },
  ]);
  try { window.close(); } catch { /* закрытие запрещено браузером */ }
}

// ---------- матч с ботом
// сложность бота — число 0..100 с шагом 10 (прежние сохранённые 'easy'/'medium'/'hard' читаются как 20/50/80)
const botLabel = (s) => t('bot.' + botTier(s)) + ' · ' + Math.round(s);
function botLevelItem(label, act) {
  const step = (d) => {
    game.settings.botLevel = Math.max(0, Math.min(100, Math.round(botSkill(game.settings.botLevel) / 10) * 10 + d * 10)); applySettings(); sfx.play('ui');
  };
  return { label, value: () => '◀ ' + botLabel(botSkill(game.settings.botLevel)) + ' ▶', act, adjust: step };
}

function startBotMatch() {
  stats.abort('restart', game.world); // «Начать заново» из паузы: прежний матч не доигран
  hud.closeMenu();
  setMode('bot');
  const lvl = botSkill(game.settings.botLevel);
  vsBot.seed = (Math.random() * 0xffff | 0) || 1; // кто вводит мяч, зависит от зерна
  vsBot.reset('duel');
  bot = game.bot = new Bot(1, lvl, vsBot.seed); // game.bot.L — параметры уровня, их можно крутить из консоли
  stats.start({ mode: 'bot', botLevel: String(lvl), me: 0 }); // строкой: сложность 0 не должна пропасть из аналитики
  botOver = false; clearTimeout(botMenuTimer);
  hud.points.reset();
  vsBot.snapshot(prev); vsBot.snapshot(cur);
  rig.setBack(lobby.name || t('common.player'), 10); rig2.setBack(t('common.bot'), [7, 13, 11, 23, 9][vsBot.seed % 5]);
  input.suppressHeld();
  game.state = 'play'; last = performance.now(); acc = 0;
  sfx.play('whistle');
  const min = Math.round(vsBot.P.match.duration / 60);
  hud.showToast(t('bot.start', { lvl: botLabel(lvl), min, minWord: plural(min, 'min') }), { ms: 1800 });
}

// матч окончен: итог и выбор — реванш, другая сложность, меню
let botMenuTimer = 0;
function botMatchOver() {
  // сначала баннер итога (из события match_over), меню — через мгновение
  if (!botOver) { botOver = true; game.state = 'pause'; botMenuTimer = setTimeout(botMatchOver, 1900); return; }
  if (game.mode !== 'bot') return;
  const w = vsBot.winner, title = () => t(w < 0 ? 'result.draw' : w === 0 ? 'result.win' : 'result.loss');
  game.state = 'pause';
  const lvl = bot.skill;
  hud.openMenu(title, () => t('bot.overNote', { a: vsBot.points[0], b: vsBot.points[1], ga: vsBot.goals[0], gb: vsBot.goals[1], lvl: botLabel(lvl).toLowerCase() }), [
    { label: () => t('menu.rematch'), act: () => startBotMatch() },
    botLevelItem(() => t('menu.difficulty'), () => startBotMatch()),
    { label: () => t('menu.toMain'), act: () => mainMenu() },
  ]);
}

// sh — режиссёр шортс-сцен (только dev-сервер): ввод обоих игроков по сценарию, замедление через game.timeScale
function stepBot(dtReal) {
  const sh = game.shorts;
  if (game.state !== 'play' || (!bot && !sh)) return;
  acc += dtReal * (sh ? game.timeScale : 1);
  let simSteps = 0;
  while (acc >= simDt && simSteps < 16) {
    const sw = prev; prev = cur; cur = sw;
    if (sh) { const io = sh.inputs(); world.step(io[0], io[1]); } else {
      input.fill(frameIn, simSteps === 0);
      world.step(frameIn, bot.think(world));
    }
    handleEvents(world.events, 0, sh ? sh.accept : null);
    sh?.afterStep(world);
    world.snapshot(cur);
    acc -= simDt; simSteps++;
    if (world.phase === 'over' && !sh) break;
  }
  if (simSteps > 0) input.endFrameEdges();
  if (simSteps === 16) acc = 0;
  if (sh?.needSync) { sh.needSync = false; world.snapshot(prev); world.snapshot(cur); acc = 0; } // сцена расставлена заново или начался повтор
  if (world.phase === 'over' && !botOver && !sh) {
    stats.finish({ winner: vsBot.winner, points: vsBot.points, goals: vsBot.goals }, vsBot);
    botMatchOver();
  }
}

function openLobby(kind, code = '') {
  hud.closeMenu();
  setMode('online');
  duel.reset('duel'); duel.snapshot(prev); duel.snapshot(cur);
  hud.points.reset();
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
  if (game.shorts) { game.shorts.exit(); return; } // шортс-сцены: Esc — выход в меню
  if (game.mode === 'online') {
    // сетевой матч не останавливается: меню открывается поверх, ввод игрока отпускается
    if (!game.net?.session.playing) return;
    game.state = 'pause';
    game.net.session.neutral();
    hud.openMenu(() => t('menu.onlineTitle'), reason || (() => t('menu.onlineNote')), [
      { label: () => t('menu.resume'), act: resume },
      ...settingsItems(),
      { label: () => t('menu.toMain'), value: () => t('menu.leaveMatch'), act: () => mainMenu() },
      { label: () => t('menu.quit'), act: quitGame },
    ], CONTROLS);
    return;
  }
  if (game.mode === 'bot') {
    game.state = 'pause';
    world.clearActions(); // удержанный удар не срабатывает после паузы
    bot?.reset();
    hud.openMenu(() => t('menu.pause'), reason || (() => t('menu.botPauseNote', { a: vsBot.points[0], b: vsBot.points[1] })), [
      { label: () => t('menu.resume'), act: resume },
      botLevelItem(() => t('menu.restart'), () => startBotMatch()),
      ...settingsItems(),
      { label: () => t('menu.toMain'), act: () => mainMenu() },
      { label: () => t('menu.quit'), act: quitGame },
    ], CONTROLS);
    return;
  }
  game.state = 'pause';
  world.clearActions();
  hud.openMenu(() => t('menu.pause'), reason || (() => t('menu.sandboxNote')), [
    { label: () => t('menu.resume'), act: resume },
    { label: () => t('menu.returnBall'), act: () => { pending.ret = true; resume(); } },
    { label: () => t('menu.serve'), act: () => { resume(); nextServe(); } },
    { label: () => t('menu.wall'), value: () => onoff(world.P.field.reboundWall), act: toggleWall, adjust: toggleWall },
    { label: () => t('menu.resetSandbox'), act: () => { game.resetSandbox('free'); resume(); } },
    ...settingsItems(),
    { label: () => t('menu.toMain'), act: () => mainMenu() },
    { label: () => t('menu.quit'), act: quitGame },
  ], CONTROLS);
}

function resume() {
  if (game.state !== 'pause') return;
  if (game.mode === 'bot' && botOver) { if (!hud.menu) botMatchOver(); return; } // матч окончен: меню итога остаётся
  hud.closeMenu();
  input.suppressHeld(); // удержанное до паузы не срабатывает, пока не отпущено
  game.state = 'play';
  last = performance.now(); acc = 0;
}

// автопаузу можно отключить только в лаборатории (?autopause=0) — для автоматических прогонов
const AUTO_PAUSE = !(LAB_ENABLED && new URLSearchParams(location.search).get('autopause') === '0');
function lostFocus(text) {
  input.releaseAll();
  if (game.shorts) return; // шортс-сцена идёт по сценарию: переключение на программу записи её не прерывает
  if (game.mode === 'online') { if (game.net?.session.playing) game.net.session.neutral(); return; } // сетевой матч идёт дальше
  if (AUTO_PAUSE) pause(text);
}
// Сетевой матч: после скрытого окна или долгого простоя клиент не догоняет пропущенное, а берёт последнее состояние
function resyncOnline() {
  const s = game.net?.session;
  if (!s || s.me < 0) return;
  s.resync();
  input.releaseAll(); input.pressed.clear();
  acc = 0; last = performance.now(); lastRaw = last;
}
// Кадры перестали идти без события скрытия (окно свёрнуто или перекрыто, а вкладка считается видимой):
// таймеры в фоне ещё работают — просим сервер не слать состояния, пока игра не рисуется
setInterval(() => {
  const s = game.mode === 'online' ? game.net?.session : null;
  if (s && s.state === 'play' && !s.waitSync && performance.now() - lastRaw > 600) { input.releaseAll(); s.hold(); }
}, 250);
window.addEventListener('blur', () => lostFocus(() => t('menu.blur')));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    lostFocus(() => t('menu.hidden'));
    if (game.mode === 'online' && game.net && game.net.session.me >= 0) game.net.session.hold();
  } else if (game.mode === 'online') resyncOnline();
});
// Кадр вручную (лаборатория, пробы). Микросекунда сверху — чтобы кадр 1/60 с всегда давал ровно два шага симуляции:
// без неё накопитель времени попадает точно на границу шага и из-за округления число шагов скачет, прогоны не повторяются.
game.manualFrame = (dt) => runFrame(last + dt * 1000 + (dt > 0 ? 1e-3 : 0));
input.onDeviceLost = () => pause(() => t('menu.padLost'));
window.addEventListener('pointerdown', () => sfx.unlock());
window.addEventListener('keydown', () => sfx.unlock());

// Команды песочницы уходят в симуляцию через кадр ввода ближайшего шага и попадают в журнал
const pending = { ret: false, serve: false, wall: false };
function toggleWall() { pending.wall = true; }
function nextServe() { pending.serve = true; }

let intro = null, introWas = false; const introV = [{}, {}]; // сцена выхода перед сетевым матчем
// Лаборатория: показать кадр сцены выхода без сервера — introPreview(sec), sec — секунды от начала; introPreview(-1) — выключить
game.introPreview = (sec, dt = 1 / 60) => {
  if (sec < 0) { scene.cine = null; rig2.root.visible = game.mode !== 'sandbox'; game.introFrame = null; return null; }
  if (!intro) intro = new MatchIntro(rig);
  const fr = intro.frame(sec, game.introPick || [0, 1]);
  rig2.root.visible = true; rig2.setBack(t('common.guest'), 9);
  if (fr.clip) { rig.updateClip(fr.roots[0], fr.layers[0], { hand: fr.hands[0] }); rig2.updateClip(fr.roots[1], fr.layers[1], { hand: fr.hands[1] }); }
  else { rig.update(fr.v[0], fr.aux[0], dt); rig2.update(fr.v[1], fr.aux[1], dt); }
  scene.cine = fr.cam; scene.updateCamera(0, 0, 0, dt); scene.render(dt);
  game.introFrame = fr;
  return fr;
};

// шаги: звук в момент, когда стопа встала на покрытие; громче на бегу, не звучит в воздухе, в подкате и лёжа
const stepState = [[true, true], [true, true]];
function stepSound(v, q, idx) {
  const st = stepState[idx];
  for (let i = 0; i < 2; i++) {
    const on = !!v.feet[i].planted;
    if (on && !st[i] && q.y <= 0 && !q.slide && !q.fall) {
      const sp = Math.hypot(q.vx, q.vz);
      if (sp > 0.4) sfx.play('step', sp / 4.6, Math.max(-1, Math.min(1, q.x / (world.P.field.length / 2))) * 0.55);
    }
    st[i] = on;
  }
}

// dev и лаборатория: прогнать событие через тот же обработчик, что и симуляция (проверка эффектов без розыгрыша)
if (LAB_ENABLED) game.emit = (e, me = 0) => handleEvents([e], me);

// ---------- события симуляции → звук, HUD, эффекты ----------
// me — номер своего игрока в сетевой игре (в песочнице 0); чужие события дают звук и вспышку, но не подсказки и вибрацию
function handleEvents(events, me = 0, accept = null) {
  const b = world.ball;
  const pan = Math.max(-1, Math.min(1, b.x / (world.P.field.length / 2))) * 0.55; // звук идёт оттуда, где мяч на экране
  const panOf = (e) => { const q = world.players[e.pi || 0]; return q ? Math.max(-1, Math.min(1, q.x / (world.P.field.length / 2))) * 0.55 : pan; };
  for (const e of events) {
    if (accept && !accept(e)) continue;
    stats.onEvent(e);
    const mine = e.pi === undefined || e.pi === me;
    const who = world.players[e.pi ?? me] || world.player; // над кем показывать стикер
    switch (e.type) {
      case 'ball_return': hud.showToast(t('note.ballBack'), { ms: 500 }); break;
      case 'feed': if (SCENARIOS[e.kind]) hud.showToast(t('scn.' + e.kind), { ms: 600 }); break;
      case 'wall_toggle':
        scene.setReboundWall(e.on);
        hud.showToast(t(e.on ? 'note.wallOn' : 'note.wallOff'), { ms: 800 });
        break;
      case 'touch':
        sfx.play('touch', 0.5, pan); scene.contactFlash(b.x, e.kind === 'juggle' || e.kind === 'toss' ? b.y : 0.02, b.z, 0);
        if (e.kind === 'toss' && mine) hud.showToast(t('note.toss'), { ms: 900 });
        if (e.kind === 'juggle' && mine && e.n >= 3) stickers.pop(t('stk.juggle', { n: e.n }), who, e.n >= 10 ? TONE.gold : TONE.me, e.n);
        break;
      case 'juggle_start': if (mine) hud.showToast(t('note.juggleStart'), { ms: 1200 }); break;
      case 'slide': sfx.play('slide', 0.5, panOf(e)); break;
      case 'land': sfx.play('thud', 0.25, panOf(e)); break;
      case 'fall': sfx.play('thud', 0.8, panOf(e)); scene.shake = Math.max(scene.shake, 0.04); break;
      case 'tackle':
        sfx.play('kick', 0.5, pan); scene.contactFlash(b.x, b.y, b.z, 0.5);
        if (mine) {
          if (e.air) stickers.trick(t('stk.airTackle'), who, { prio: 2 }); else stickers.pop(t('stk.tackle'), who);
          if (game.settings.vibration) input.rumble(0.4, 80);
        }
        break;
      case 'super_empty': if (mine) hud.showToast(t('note.superEmpty', { p: Math.round(e.charge * 100) }), { ms: 600 }); break;
      case 'kick':
        sfx.play('kick', Math.min(1, e.speed / 24), pan); scene.contactFlash(b.x, b.y, b.z, 0.6 + e.charge + (e.firstTime ? 0.5 : 0));
        scene.shake = 0.03 + 0.09 * Math.min(1, e.speed / 24) + (e.kind === 'super' ? 0.12 : 0);
        if (!mine) {
          // трюки соперника — только мелкой подписью его цвета над ним
          const k = e.kind === 'super' ? 'stk.foeSuper' : e.bike ? 'stk.foeBike' : e.fly ? 'stk.foeFly' : '';
          if (k) stickers.pop(t(k), who, TONE.foe);
          break;
        }
        // крупные трюки — стикер «вау», средние — стикер у игрока (сильный не перебивается слабым), навес — подпись
        if (e.kind === 'super') stickers.big(t('stk.super'), { tone: TONE.gold });
        else if (e.bike) stickers.big(t('stk.bike'), { tone: TONE.me });
        else if (e.fly) stickers.big(t('stk.fly'), { tone: TONE.me });
        else if (e.jump) stickers.trick(t('stk.jump'), who, { prio: 3 });
        else if (e.volley) stickers.trick(t('stk.volley'), who, { prio: 2 });
        else if (e.firstTime) stickers.trick(t('stk.firstTime'), who, { prio: 1 });
        else if (e.kind === 'lob') stickers.pop(t('stk.lob'), who);
        if (game.settings.vibration) input.rumble(0.3 + 0.6 * e.charge, 90);
        break;
      case 'receive':
        sfx.play(e.auto === 'deflect' ? 'body' : e.quality >= 1 ? 'receive' : 'receive_bad', 0.5, pan);
        if (!mine) break;
        {
          // награда — только за хороший приём; обычные остановки и неполный приём без надписей (их слышно)
          const k = e.auto === 'deflect' ? (e.zone === 'head' ? 'stk.head' : e.zone === 'chest' ? 'stk.chest' : 'stk.thigh') : e.reach ? 'stk.reach' : e.quality >= 1 ? 'stk.clean' : '';
          if (k) stickers.pop(t(k), who, e.quality >= 1 && !e.auto ? TONE.gold : TONE.me);
        }
        if (game.settings.vibration) input.rumble(0.25, 60);
        break;
      case 'header': sfx.play('header', 0.6, pan); if (mine) stickers.pop(t('stk.header'), who); break;
      case 'body': sfx.play('body', e.speed / 15, pan); break;
      case 'wall': sfx.play(e.surface === 'board' ? 'wall' : 'fence', e.speed / 18, pan); break;
      case 'net': sfx.play('net', e.speed / 18, pan); scene.netHit(e.side, e.part, b.x, b.y, b.z, e.speed); break;
      case 'post': {
        // штанга или перекладина: звон, вспышка рамы этих ворот, металлические искры обратно в поле, тряска по силе удара;
        // крепкий удар — стикер у мяча и надпись на бортах (не чаще раза в секунду: мяч может звякнуть о раму дважды)
        const k = Math.min(1, e.speed / 18), side = Math.sign(b.x || 1), bar = e.part === 'bar';
        sfx.play('post', e.speed / 20, pan);
        scene.shake = Math.max(scene.shake, 0.03 + 0.09 * k);
        scene.contactFlash(b.x, b.y, b.z, 0.6 + k);
        scene.frameHit(side, k);
        pfx.burst(b.x, b.y, b.z, -side, 0xffffff, Math.round(12 + 28 * k));
        const now = performance.now();
        if (e.speed > 5 && now - postFxAt > 1000) {
          postFxAt = now;
          stickers.trick(t(bar ? 'stk.bar' : 'stk.post'), { x: b.x - side * 0.6, y: b.y, z: b.z }, { tone: TONE.steel, prio: 2, lift: 0.7 });
          led.flash(t(bar ? 'led.bar' : 'led.post'));
          if (game.settings.vibration) input.rumble(0.35 + 0.4 * k, 90);
        }
        break;
      }
      case 'bounce': sfx.play('bounce', e.speed / 10, pan); break;
      case 'goal': {
        const scored = e.by === undefined ? e.scored : e.by === me;
        const corner = e.bonus?.[0]?.[0] === 'corner'; // гол в девятку (база corner вместо goal)
        sfx.play('goal');
        if (e.pts !== undefined) {
          // дуэль: разбор очков вместо тоста «ГОЛ!», частицы и кольца у ворот
          stickers.hush(); // трюк-стикеры не перекрывают разбор очков
          scene.shake = Math.max(scene.shake, hud.points.goal(e, me, performance.now()));
          const kit = e.by === 0 ? 0x2f7bff : 0xff5a44, dir = -Math.sign(b.x || 1), gx = Math.sign(b.x || 1) * (world.P.field.length / 2 - world.P.field.goalInset);
          pfx.burst(gx, Math.min(1.8, Math.max(0.3, b.y)), b.z, dir, kit, e.pts >= 400 ? 140 : e.pts >= 200 ? 80 : 40);
          pfx.ring(gx + dir * 1.2, b.z * 0.5, kit);
          if (corner) {
            // девятка: золотой салют из того угла, куда зашёл мяч, рама ворот вспыхивает золотом
            const F = world.P.field, cz = Math.sign(b.z || 1) * (F.goalWidth / 2 - 0.15);
            pfx.burst(gx, F.goalHeight - 0.15, cz, dir, 0xffd34d, 120);
            pfx.burst(gx, F.goalHeight - 0.15, cz, dir, 0xffffff, 60, 0.18);
            pfx.ring(gx + dir * 1.2, cz * 0.6, 0xffd34d, 0.08);
            scene.frameHit(Math.sign(b.x || 1), 1, 0xffc21a);
          }
          if (e.pts >= 400) pfx.ring(gx + dir * 1.2, b.z * 0.5, 0xffd34d, 0.12);
          // крупный гол — ещё две волны искр над воротами
          if (e.pts >= 200) for (const [d, n] of [[0.25, 60], [0.5, 50]]) pfx.burst(gx, 1.6, (Math.random() - 0.5) * 2, dir, kit, n, d);
        } else stickers.big(t(scored ? 'stk.goal' : 'stk.conceded'), { tone: scored ? TONE.gold : TONE.bad });
        // все LED-борта: «ГОЛ!» в своём золоте или в цвете забившего соперника; волна идёт от забитых ворот
        led.goal({ mine: scored, kit: e.by === 0 ? '#4dc3ff' : '#ff5a44', side: Math.sign(b.x || 1), pts: e.pts || 0, corner });
        if (e.by !== undefined) (e.by === 1 ? rig2 : rig).celebrate(); else if (e.scored) rig.celebrate(); // празднует забивший
        if (game.settings.vibration) input.rumble(0.8, 200);
        break;
      }
      case 'hold_warn': if (mine) sfx.play('ui', 0.6); break;
      case 'hold_penalty':
        hud.points.penalty(e, world); sfx.play('cancel', 0.8, panOf(e));
        if (mine && game.settings.vibration) input.rumble(0.3, 60);
        break;
      case 'buzzer': sfx.play('whistle'); break;
      case 'overtime': sfx.play('whistle'); stickers.big(t('stk.golden'), { sub: t('stk.goldenSub') }); led.finish(t('led.golden'), '#ffd400', { hold: 1.0, level: 0.55 }); break;
      case 'match_over':
        if (e.points) {
          sfx.play('whistle'); hud.points.finish(e.winner, me, e.points, duelNames());
          if (e.winner >= 0) { const kit = e.winner === 0 ? 0x2f7bff : 0xff5a44, q = world.players[e.winner]; if (q) pfx.burst(q.x, 2, q.z, -Math.sign(q.x || 1), kit, 140); }
          led.finish(t(e.winner < 0 ? 'led.draw' : e.winner === me ? 'led.win' : 'led.over'), e.winner < 0 || e.winner === me ? '#ffd400' : e.winner === 0 ? '#4dc3ff' : '#ff5a44');
        }
        break;
      case 'kickoff':
        // розыгрыш: разбор гола и «ГОЛ!» на бортах сворачиваются, чтобы не висеть над живой игрой
        sfx.play('whistle'); hud.points.endGoal(performance.now()); led.calm();
        stickers.note(t(e.to === me ? 'note.yourBall' : 'note.theirBall'), 900);
        if (e.drop) { const kit = e.to === 0 ? 0x2f7bff : 0xff5a44; pfx.ring(e.x, e.z, kit); pfx.ring(e.x, e.z, kit, 0.25); } // точка, куда падает мяч
        break;
      case 'kick_cancel': if (mine) { sfx.play('cancel'); hud.showToast(t('note.kickCancel'), { ms: 800 }); } break;
      case 'kick_miss': if (mine) { sfx.play('miss'); hud.showToast(t('note.kickMiss'), { ms: 600 }); } break;
      case 'kick_empty': if (mine) hud.showToast(t('note.kickEmpty'), { ms: 500 }); break;
      case 'control_lost': if (mine) hud.showToast(t('note.controlLost'), { ms: 600 }); break;
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
  }
  if (game.simPaused) { acc = game.stepOnce ? simDt : 0; game.stepOnce = false; }
  else acc += dtReal * game.timeScale;
  while (acc >= simDt && simSteps < 16) {
    const sw = prev; prev = cur; cur = sw;
    if (game.replay) {
      const r = game.replay;
      if (r.i >= r.frames.length) { game.replay = null; world.recording = true; hud.showToast(t('note.replayDone'), { ms: 700 }); break; }
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
  // кадры не шли дольше 0,3 с (вкладка в фоне без события скрытия, зависание): синхронизация заново
  const stalled = now - lastRaw > 300;
  lastRaw = now;
  if ((stalled && s.state === 'play' && !s.waitSync) || s.waitSync === -1) resyncOnline(); // -1: рассылка была остановлена, кадры пошли снова
  s.reconcile(prev, cur);
  if (s.serverEvents.length) {
    handleEvents(s.serverEvents, me, (e) => e.pi !== me && !BALL_EVENTS.has(e.type));
    s.serverEvents.length = 0;
  }
  trackOnline(net);
  if (!s.playing) { acc = 0; s.clearError(); return; }
  acc += dtReal;
  let simSteps = 0;
  const active = game.state === 'play' && !document.hidden;
  while (acc >= simDt && simSteps < 16) {
    const sw = prev; prev = cur; cur = sw;
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

// Учёт сетевого матча — по состоянию комнаты, а не по событиям: сообщение комнаты доходит всегда,
// а состояния с событиями при скрытом окне и пересинхронизации пропускаются. Возврат после обрыва (paused → play) — тот же матч
function trackOnline(net) {
  const s = net.session, L = s.lobby;
  if (s.me < 0) return;
  if (stats.active) {
    if (L?.state === 'over') stats.finish({ winner: L.winner, points: L.points || [0, 0], goals: L.goals || [0, 0] }, duel);
    else if (s.closed) stats.abort(s.closed, duel);
    else if (s.error) stats.abort('rejoin_' + s.error, duel); // вернуться в комнату после обрыва не вышло
    else if (net.status === 'failed') stats.abort('disconnect', duel);
  } else if (L?.state === 'play' && net.status === 'open' && !s.closed && !s.error) stats.start({ mode: 'online', me: s.me }); // после обрыва комната остаётся в 'play' — без живой связи матч не начинается
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
    if (game.state === 'pause' && online && sess?.state !== 'play') resume(); // матч кончился или прервался, пока было открыто меню
  } else if (game.state === 'play') {
    if (online && sess?.state !== 'play') { for (const c of menuCmds) lobby.input(c === 'pause' ? 'back' : c); }
    else if (menuCmds.includes('pause')) pause();
  }

  const vsAI = game.mode === 'bot', duo = online || vsAI; // два игрока на поле
  if (online) stepOnline(dtReal, now); else if (vsAI) stepBot(dtReal); else stepSandbox(dtReal);
  if (online) lobby.render(game.net, now);

  // интерполяция изображения между двумя шагами симуляции
  const running = online ? !!sess?.playing : game.state === 'play' && !game.simPaused;
  const a = running ? Math.min(1, acc / simDt) : 1;
  const err = sess ? sess.err : null;
  lerpPlayer(view, prev, cur, a, err ? err.p[0] : ZERO);
  if (duo) lerpPlayer(view.p2, prev.p2, cur.p2, a, err ? err.p[1] : ZERO);
  if (sess && sess.hasState && sess.me >= 0) { const rv = sess.me === 0 ? view.p2 : view; sess.remoteView(rv, running ? dtReal : 0, rv); } // rv уже содержит предсказанное положение соперника
  const eb = err ? err.b : ZERO;
  view.bx = prev.bx + (cur.bx - prev.bx) * a + eb.x; view.bz = prev.bz + (cur.bz - prev.bz) * a + eb.z;
  view.by = Math.max(world.P.ball.radius, prev.by + (cur.by - prev.by) * a + eb.y);

  const dtVis = running ? dtReal * (duo && !game.shorts ? 1 : game.timeScale) : 0;
  const ball = { x: view.bx, y: view.by, z: view.bz };
  const P0 = world.players[0], P1 = world.players[1];
  const mine = world.players[sess && sess.me === 1 ? 1 : 0];
  scene.updateBall(view.bx, view.by, view.bz, cur.bqx, cur.bqy, cur.bqz, cur.bqw);
  scene.updateNets(view.bx, view.by, view.bz, dtReal);
  const auxOf = (q) => ({ ball, kick: q.kick, gesture: q.gesture, guard: q.guard || !!q.lunge, withBall: !!q.possession, juggle: q.juggle, slide: q.slide, reach: q.reach, fall: q.fall, jumpPrep: q.jumpPrep, vy: q.vy });
  // сцена выхода перед сетевым матчем: пока идёт отсчёт, игроков и камеру ведёт постановка, к концу она сходится к игре
  const L = sess?.lobby, introOn = online && !!L && L.state === 'countdown' && !!L.intro && sess.hasState && !!P1;
  if (L && L.players[0]) rig.setBack(L.players[0].name, L.players[0].num || 10);
  if (L && L.players[1]) rig2.setBack(L.players[1].name, L.players[1].num || 9);
  if (introOn) {
    if (!intro) intro = new MatchIntro(rig);
    const total = COUNTDOWN_MS / 1000, t = total - Math.max(0, L.timer - (now - sess.lobbyAt)) / 1000;
    if (!introWas) intro.reset();
    // походка у каждого своя — по номеру на спине: у обоих клиентов выбор одинаковый
    const fr = intro.frame(t, [L.players[0]?.num || 0, (L.players[1]?.num || 0) + 1]);
    if (fr.clip) {
      rig.updateClip(fr.roots[0], fr.layers[0], { hand: fr.hands[0] }); rig2.updateClip(fr.roots[1], fr.layers[1], { hand: fr.hands[1] });
    } else {
      const k = Math.max(0, Math.min(1, (t - (total - INTRO.blend)) / (INTRO.blend - 0.05))), kk = k * k * (3 - 2 * k);
      rig.update(kk > 0 ? blendView(introV[0], fr.v[0], view, kk) : fr.v[0], fr.aux[0], dtReal);
      rig2.update(kk > 0 ? blendView(introV[1], fr.v[1], view.p2, kk) : fr.v[1], fr.aux[1], dtReal);
    }
    scene.cine = fr.cam;
  } else {
    scene.cine = null;
    rig.update(view, auxOf(P0), dtVis);
    if (duo && P1) rig2.update(view.p2, auxOf(P1), dtVis);
  }
  introWas = introOn;
  game.shorts?.frame(dtReal, view); // шортс: своя камера (scene.cine), титры, замедление
  if (running) { stepSound(view, P0, 0); if (duo && P1) stepSound(view.p2, P1, 1); }
  scene.updateAim(mine.kick, world.P);
  // кольцо-таймер под игроком, который держит мяч: с порога предупреждения до штрафа
  const HD = world.P.match.hold;
  for (let i = 0; i < 2; i++) {
    const q = world.players[i], v = i === 0 ? view : view.p2, h = duo && q && world.phase === 'play' ? q.holdT || 0 : 0;
    pfx.holdRing(i, h >= HD.warn, v ? v.px : 0, v ? v.pz : 0, Math.max(0, (HD.grace - h) / (HD.grace - HD.warn)), h >= HD.grace);
  }
  pfx.update(game.shorts ? dtVis : dtReal);
  led.update(game.shorts ? dtVis : dtReal, view.bz, view.by);
  scene.updateCamera(view.px, view.pz, view.yaw, dtReal);
  game.lab?.onFrame(dtReal);
  hud.update(dtReal, world, input, game.replay ? t('hud.replay') : game.timeScale !== 1 && !duo ? game.timeScale + '×' : '',
    online ? { me: sess ? Math.max(0, sess.me) : 0, lobby: sess?.lobby, rtt: sess?.rtt || 0, replayed: sess?.replayed || 0 }
      : vsAI && (bot || game.shorts) ? { me: 0, title: bot ? t('bot.title', { lvl: botLabel(bot.skill) }) : '', lobby: { players: duelNames().map((name) => ({ name })) }, rtt: 0, replayed: 0 } : null);
  scene.render(dtReal);
}

// Прогрев шейдеров: всё, что появляется позже (кольца гола, кольца удержания, соперник в песочнице), компилируется
// сейчас, за экраном загрузки. Иначе первая компиляция приходится на кадр с эффектом — короткий фриз (замер: ×2 кадр).
function warmUpShaders() {
  const hidden = [];
  scene.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  try { scene.renderer.compile(scene.scene, scene.camera); } finally { for (const o of hidden) o.visible = false; }
}

async function boot() {
  const loading = document.createElement('div');
  loading.className = 'loading'; loading.textContent = t('common.loading');
  document.body.append(loading);
  try {
    const info = await rig.load(scene.scene, profile.player.height);
    await rig2.load(scene.scene, profile.player.height);
    rig2.setKit(0xd8432f, 0x7f1c17); // соперник справа — в красном (свой игрок — в синем, цвет задан в риге)
    rig2.root.visible = false;
    // в песочнице — своё имя из лобби (если вводилось) и случайный номер
    rig.setBack(lobby.name || t('common.player'), SHIRT_NUMBERS[Math.floor(Math.random() * SHIRT_NUMBERS.length)]);
    if (LAB_ENABLED) console.info('[rig]', info);
  } catch (err) {
    loading.textContent = t('common.loadFail', { msg: err.message });
    throw err;
  }
  if (LAB_ENABLED) {
    const { Lab } = await import('./lab/lab.js');
    game.lab = new Lab(game, document.getElementById('lab'));
  }
  // Шортс-сцены для вертикальных видео — только dev-сервер: в сборку (и в сборку с лабораторией) код не попадает
  if (import.meta.env.DEV) {
    const { ShortsDirector } = await import('./shorts/director.js');
    game.shortsDirector = new ShortsDirector(game, {
      begin(d) {
        if (game.net) { game.net.leave(); game.net = null; }
        lobby.close(); hud.closeMenu();
        setMode('bot');
        bot = game.bot = null; botOver = false; clearTimeout(botMenuTimer);
        hud.points.reset();
        game.shorts = d;
        input.suppressHeld();
        game.state = 'play'; last = performance.now(); acc = 0;
      },
      leave() { game.shorts = null; game.timeScale = 1; mainMenu(); },
    });
  }
  warmUpShaders();
  loading.remove();
  initAnalytics();
  last = performance.now();
  const q = new URLSearchParams(location.search);
  const room = (q.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  const short = import.meta.env.DEV ? q.get('short') || (q.get('shorts') ? '-' : '') : '';
  if (short) game.shortsDirector.open(short === '-' ? undefined : short, false); // ?shorts=1 — панель сцен, ?short=bike — сразу сцена
  else if (room) openLobby('join', room); // ссылка-приглашение
  else if (q.get('menu') === '0' && LAB_ENABLED) { game.state = 'play'; hud.showToast(t('note.sandboxLab'), { ms: 1400 }); }
  else mainMenu();
  requestAnimationFrame(frame);
}

boot();
