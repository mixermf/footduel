// Режиссёр шортс-сцен (только dev-сервер, в сборки не попадает): кадр 9:16, камеры, замедление, повторы, титры,
// панель выбора сцены и запись вкладки в файл. Симуляцию ведёт main.js (stepBot), режиссёр подаёт ввод игроков
// (inputs), фильтрует события в повторах (accept) и ставит камеру каждый кадр (frame).
import { SCENES } from './scenes.js';
import { ShortRunner, stageShort } from './script.js';
import { estimateSeconds } from './check.js';
import { packInput, unpackInput, emptyInput } from '../sim/world.js';
import './shorts.css';

const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Камеры. c — что видно сейчас: b — мяч, p0/p1 — игроки (интерполированные), mix(…) — точка между ними.
// pos — где камера, look — куда смотрит, fov — вертикальный угол (в кадре 9:16 горизонталь узкая), lag — сглаживание, с
const SHOTS = {
  behind: (c) => { const f = c.mix(c.b, c.p0, 0.5); return { pos: [f.x - 6, 3.6, f.z + 1.6], look: [f.x + 3, 0.6, f.z * 0.5], fov: 52 }; },
  behindOpp: (c) => ({ pos: [c.p1.x + 4.6, 3.4, c.p1.z + 1.8], look: [c.p1.x - 3.5, 0.5, c.p1.z * 0.4], fov: 56 }),
  chaseBack: (c) => { const f = c.mix(c.b, c.p0, 0.45); return { pos: [f.x + 6.2, 4.2, f.z + 2.6], look: [f.x - 1.5, 1.4, f.z], fov: 56, lag: 0.18 }; },
  // из-за штанги атакуемых ворот навстречу мячу; когда мяч у сетки, взгляд остаётся на воротах, а не в сетке
  reverse: (c) => ({ pos: [10.7, 1.75, 0.7], look: [Math.min(c.b.x, 5.5), clamp(c.b.y * 0.8, 0.9, 1.9), clamp(c.b.z, -1.5, 1.5) * 0.6], fov: clamp(26 + (8 - c.b.x) * 1.4, 30, 46), lag: 0.1 }),
  // то же из-за своих ворот (синего): для автогола
  reverseOwn: (c) => ({ pos: [-10.7, 1.75, 0.7], look: [Math.max(c.b.x, -5.5), clamp(c.b.y * 0.8, 0.9, 1.9), clamp(c.b.z, -1.5, 1.5) * 0.6], fov: clamp(26 + (c.b.x + 8) * 1.4, 30, 46), lag: 0.1 }),
  sideHero: (c) => { const f = c.mix(c.b, c.p0, 0.5); return { pos: [f.x - 0.6, 1.7, f.z + 4.8], look: [f.x + 0.1, Math.max(1.1, c.b.y * 0.6), f.z], fov: 60 }; },
  lowHero: (c) => ({ pos: [c.p0.x - 1.9, 0.45, c.p0.z + 2.2], look: [c.p0.x + 0.2, 1.7, c.p0.z], fov: 60 }),
  longView: () => ({ pos: [-8.75, 7.6, 0.5], look: [-0.6, 0, 0], fov: 68, lag: 0.3 }),
  longViewBack: () => ({ pos: [8.75, 7.6, 0.5], look: [0.6, 0, 0], fov: 68, lag: 0.3 }),
  topWhole: () => ({ pos: [-0.2, 7.8, 4.6], look: [0, 0, 0], fov: 80 }),
  goalSide: (c) => ({ pos: [4.9, 1.9, 3.6], look: [8.0, Math.max(1.3, c.b.y * 0.7), 0], fov: 50, lag: 0.15 }),
  shooterLow: (c) => ({ pos: [c.p0.x - 1.7, 0.75, c.p0.z + 1.3], look: [c.p0.x + 3, 1.0, c.p0.z], fov: 58 }),
  ballChase: (c) => ({ pos: [c.b.x - 3.4, c.b.y + 1.3, c.b.z + 1.2], look: [c.b.x + 3, c.b.y * 0.85, c.b.z], fov: 56, lag: 0.12 }),
  barCam: () => ({ pos: [5.9, 2.4, 2.7], look: [8.1, 2.3, 0], fov: 62 }),
  lobArc: (c) => ({ pos: [c.b.x - 1.6, 3.6, 4.8], look: [c.b.x + 1.2, Math.max(1.2, c.b.y * 0.8), c.b.z * 0.5], fov: 62, lag: 0.15 }),
  sideWide: (c) => { const f = c.mix(c.b, c.p1, 0.5); return { pos: [f.x - 1, 3.4, 4.8], look: [f.x + 0.5, 1.6, 0], fov: 74, lag: 0.15 }; },
  oppHero: (c) => ({ pos: [c.p1.x - 2.3, 1.15, c.p1.z + 2.4], look: [c.p1.x, 1.05, c.p1.z], fov: 54 }),
  oppWide: (c) => ({ pos: [c.p1.x + 4.4, 3.0, c.p1.z + 0.7], look: [c.p1.x - 2.6, 0.9, c.p1.z * 0.6], fov: 60, lag: 0.3 }),
  returnCam: (c) => ({ pos: [c.p0.x + 1.9, 2.0, c.p0.z + 4.0], look: [c.p0.x + 0.35, 1.25, c.p0.z], fov: 62, lag: 0.12 }),
  // празднование: спереди на забившего (синего), чуть снизу
  celebrate: (c) => ({ pos: [c.p0.x + 3.4, 1.4, c.p0.z + 1.6], look: [c.p0.x, 0.75, c.p0.z], fov: 46, lag: 0.25 }),
  celebrateOpp: (c) => ({ pos: [c.p1.x - 3.4, 1.4, c.p1.z + 1.6], look: [c.p1.x, 0.75, c.p1.z], fov: 46, lag: 0.25 }),
  juggleCam: (c) => ({ pos: [c.p0.x + 2.2, 1.25, c.p0.z + 2.3], look: [c.p0.x, 1.05, c.p0.z], fov: 54 }),
};

export class ShortsDirector {
  // api — доступ к main.js: begin() (режим и сброс HUD), leave() (выход в меню)
  constructor(game, api) {
    this.g = game; this.api = api;
    this.scene = null; this.runner = null; this.phase = 'off';
    this.captionsOn = true; this.countdownOn = true;
    this.names = null; this.needSync = false;
    this.accept = (e) => this._accept(e);
    this.cam = null; this.shot = null;
    this._keys = (e) => this._onKey(e);
  }

  // ---------- вход и выход ----------
  open(id = SCENES[0].id, autoplay = false) {
    const g = this.g;
    if (this.phase === 'off') {
      document.documentElement.classList.add('shorts-on');
      this._buildUi();
      // кадр 9:16: рендер по размеру body, координаты HUD — относительно него
      const sc = g.scene;
      this._orig = { resize: sc.resize, toScreen: sc.toScreen, fov: sc.camera.fov };
      sc.resize = () => {
        const w = document.body.clientWidth, h = document.body.clientHeight;
        sc.renderer.setSize(w, h, false); sc.camera.aspect = w / h; sc.camera.updateProjectionMatrix();
      };
      sc.toScreen = (x, y, z) => {
        const p = this._orig.toScreen.call(sc, x, y, z), r = document.body.getBoundingClientRect();
        return p && { x: p.x - r.left, y: p.y - r.top };
      };
      sc.resize();
      // перелёт очков в табло стоит в координатах окна (position: fixed), а в кадре 9:16 fixed отсчитывается от body
      const pts = g.hud.points;
      this._orig.fly = pts._fly;
      pts._fly = (from, to) => {
        this._orig.fly.call(pts, from, to);
        const c = pts.root.lastElementChild, r = document.body.getBoundingClientRect();
        if (c && c.classList.contains('pts-fly')) { c.style.left = parseFloat(c.style.left) - r.left + 'px'; c.style.top = parseFloat(c.style.top) - r.top + 'px'; }
      };
      window.addEventListener('keydown', this._keys, true);
    }
    this.select(id);
    if (autoplay) this.play();
  }

  exit() {
    if (this.phase === 'off') return;
    this._stopRecording();
    const g = this.g, sc = g.scene;
    window.removeEventListener('keydown', this._keys, true);
    document.documentElement.classList.remove('shorts-on');
    this.ui?.remove(); this.ui = null;
    sc.resize = this._orig.resize; sc.toScreen = this._orig.toScreen; g.hud.points._fly = this._orig.fly;
    sc.camera.fov = this._orig.fov; sc.cine = null;
    sc.resize();
    g.hud.points.board.style.visibility = g.hud.points.count.style.visibility = '';
    g.timeScale = 1;
    this.phase = 'off'; this.scene = null; this.names = null;
    this.api.leave();
  }

  // Сцена выбрана: мир расставлен, стоп-кадр на первом кадре, панель видна
  select(id) {
    const s = SCENES.find((x) => x.id === id) || SCENES[0], g = this.g;
    clearTimeout(this._cd);
    this.scene = s; this.names = s.names || ['ТЫ', 'ДРУГ'];
    this.api.begin(this);
    const w = g.world;
    stageShort(w, s);
    this.runner = new ShortRunner(w, s);
    this.rec = []; this.saved = new Map(); this.replayIx = -1; this.goalT = null;
    this._saveIfNeeded(w);
    this.phase = 'ready'; this.phaseT = 0; this.ts = 0; g.timeScale = 0;
    this.cam = null; this.shot = null;
    g.rig.setBack(this.names[0], 10); g.rig2.setBack(this.names[1], 7);
    g.hud.points.board.style.visibility = g.hud.points.count.style.visibility = '';
    this.needSync = true;
    this._renderUi();
    this._showCaptions([]);
    this.end.className = 'sh-end';
    this.badge.className = 'sh-badge';
  }

  play() {
    if (!this.scene) return;
    clearTimeout(this._cd);
    if (this.phase !== 'ready') this.select(this.scene.id);
    if (this.countdownOn && !this.recorder) {
      let n = 3;
      const tick = () => {
        this.status.textContent = `Старт через ${n}…`;
        if (n-- > 0) this._cd = setTimeout(tick, 1000); else this._go();
      };
      tick();
    } else this._go();
  }

  _go() {
    if (this.phase !== 'ready') return;
    this.status.textContent = '';
    this.phase = 'hook'; this.phaseT = 0;
    this.ui.classList.add('hidden');
  }

  // ---------- шаги симуляции (из main.js) ----------
  inputs() {
    const r = this.runner, ph = this.phase;
    if (ph === 'live') {
      const io = r.inputs();
      this.rec[r.step] = [packInput(io[0]), packInput(io[1])];
      return io;
    }
    if (ph === 'replay') {
      const f = this.rec[r.step] || this._zero || (this._zero = [packInput(emptyInput()), packInput(emptyInput())]);
      this._rin = this._rin || [emptyInput(), emptyInput()];
      unpackInput(f[0], this._rin[0]); unpackInput(f[1], this._rin[1]);
      return this._rin;
    }
    return this._idle || (this._idle = [emptyInput(), emptyInput()]);
  }

  afterStep(w) {
    const r = this.runner, s = this.scene;
    if (this.phase !== 'live' && this.phase !== 'replay') return;
    r.advance();
    if (this.phase === 'live') {
      this._saveIfNeeded(w);
      for (const e of w.events) if (e.type === 'goal' && this.goalT === null) this.goalT = r.t;
      if (r.t >= s.live - 1e-9) this._nextReplay();
    } else {
      for (const e of w.events) if (e.type === 'goal') this._replayGoal(e);
      if (r.t >= s.replays[this.replayIx].to - 1e-9) this._nextReplay();
    }
  }

  // состояние мира на начале каждого повтора
  _saveIfNeeded(w) {
    for (const rp of this.scene.replays || []) {
      const st = Math.round(rp.from / w.dt);
      if (st === this.runner.step && !this.saved.has(st)) this.saved.set(st, JSON.stringify(w.saveState()));
    }
  }

  _nextReplay() {
    const s = this.scene, g = this.g;
    this.replayIx++;
    const rp = (s.replays || [])[this.replayIx];
    if (!rp) { this._outro(); return; }
    const st = Math.round(rp.from / g.world.dt), snap = this.saved.get(st);
    if (!snap) { this._outro(); return; }
    g.world.loadState(JSON.parse(snap));
    this.runner.step = st;
    this.phase = 'replay'; this.phaseT = 0;
    this.cam = null; this.shot = null;
    this.needSync = true;
    g.hud.points.board.style.visibility = g.hud.points.count.style.visibility = 'hidden'; // в повторе очки «откатились бы» назад
    g.hud.points.stack.replaceChildren(); g.hud.points.final.className = 'pts-final';
    this.badge.textContent = '▶ ' + (rp.label || 'ПОВТОР');
    this.badge.className = 'sh-badge on';
  }

  _outro() {
    const s = this.scene, o = s.outro || {};
    this.phase = 'outro'; this.phaseT = 0;
    this.badge.className = 'sh-badge';
    this.end.replaceChildren(el('div', 'sh-end-h', o.text || ''), el('div', 'sh-end-s', o.sub || ''), el('div', 'sh-end-tag', 'SOCCER DUEL'));
    this.end.className = 'sh-end on';
  }

  // события повтора: звук и эффекты остаются, очки и итоги не повторяются
  _accept(e) {
    if (this.phase !== 'replay') return true;
    return !['goal', 'hold_penalty', 'match_over', 'overtime', 'kickoff', 'buzzer', 'hold_warn'].includes(e.type);
  }

  _replayGoal(e) {
    const g = this.g;
    g.sfx.play('goal');
    (e.by === 1 ? g.rig2 : g.rig).celebrate();
    g.scene.shake = Math.max(g.scene.shake, 0.25);
  }

  // ---------- каждый кадр (из main.js): время, замедление, титры, камера ----------
  frame(dt, view) {
    const g = this.g, s = this.scene, r = this.runner;
    if (!s) return;
    this.phaseT += dt;
    let target = 1;
    if (this.phase === 'ready' || this.phase === 'done') target = 0;
    else if (this.phase === 'hook') { target = 0; if (this.phaseT >= (s.hook?.sec || 0)) { this.phase = 'live'; this.phaseT = 0; } }
    else if (this.phase === 'outro') { target = 0; if (this.phaseT >= (s.outro?.sec || 2)) this._done(); }
    else if (this.phase === 'live') target = slowAt(s.slow, r.t);
    else if (this.phase === 'replay') target = s.replays[this.replayIx].scale || 0.5;
    // замедление включается быстро, но не скачком; стоп-кадр — сразу
    this.ts = target === 0 ? 0 : this.ts <= 0 ? target : lerp(this.ts, target, 1 - Math.exp(-dt / 0.06));
    g.timeScale = this.ts;

    // титры
    const caps = [];
    if (this.captionsOn && (this.phase === 'hook' || this.phase === 'live' || this.phase === 'ready')) {
      for (const c of s.captions || []) if (r.t >= c.from && r.t < c.to) caps.push(c);
    }
    this._showCaptions(caps);

    // камера
    const list = this.phase === 'replay' ? s.replays[this.replayIx].cams : s.cams;
    let cur = list[0];
    for (const c of list) if (r.t >= c.t) cur = c;
    const ctx = makeCtx(view, g.world);
    const fn = typeof cur.shot === 'function' ? cur.shot : SHOTS[cur.shot] || SHOTS.behind;
    const tgt = fn(ctx);
    const cut = this.shot !== cur;
    if (cut) { this.shot = cur; this.blendT = cur.blend || 0; }
    if (!this.cam || (cut && !cur.blend)) this.cam = { pos: tgt.pos.slice(), look: tgt.look.slice(), fov: tgt.fov || 50 };
    else {
      const lag = this.blendT > 0 ? Math.max(0.05, this.blendT / 3) : tgt.lag ?? 0.1;
      if (this.blendT > 0) this.blendT -= dt;
      const k = 1 - Math.exp(-dt / lag);
      for (let i = 0; i < 3; i++) { this.cam.pos[i] = lerp(this.cam.pos[i], tgt.pos[i], k); this.cam.look[i] = lerp(this.cam.look[i], tgt.look[i], k); }
      this.cam.fov = lerp(this.cam.fov, tgt.fov || 50, k);
    }
    const sc = g.scene, sh = sc.shakeEnabled ? sc.shake : 0;
    const jx = (Math.random() - 0.5) * sh, jy = (Math.random() - 0.5) * sh;
    sc.shake *= Math.exp(-10 * dt);
    sc.cine = { px: this.cam.pos[0] + jx, py: this.cam.pos[1] + jy, pz: this.cam.pos[2], lx: this.cam.look[0], ly: this.cam.look[1], lz: this.cam.look[2], out: 0 };
    if (Math.abs(sc.camera.fov - this.cam.fov) > 0.01) { sc.camera.fov = this.cam.fov; sc.camera.updateProjectionMatrix(); }
  }

  // Отладка из консоли: покадровый прогон до нужного момента (для снимков и правки камер).
  //   __game.shortsDirector.debugStart('bike'); __game.shortsDirector.debugTo('live', 2.3) / debugTo('replay', 1.9, 1)
  debugStart(id) { this.g.manual = true; this.countdownOn = false; this.select(id); this.g.manualFrame(1 / 60); this._go(); this.g.manualFrame(1 / 60); }
  debugTo(phase, t = 0, ix = 0) {
    let n = 0;
    while (n++ < 8000 && this.phase !== 'done' && !(this.phase === phase && (phase !== 'replay' || this.replayIx === ix) && this.runner.t >= t)) this.g.manualFrame(1 / 60);
    return { phase: this.phase, t: Math.round(this.runner.t * 1000) / 1000, replay: this.replayIx, frames: n };
  }

  _done() {
    this.phase = 'done'; this.phaseT = 0;
    this.ui.classList.remove('hidden');
    this.status.textContent = 'Готово. Пробел — ещё раз, 1–6 — другая сцена.';
    if (this.recorder) setTimeout(() => this._stopRecording(), 400);
  }

  // ---------- титры ----------
  _showCaptions(caps) {
    const key = caps.map((c) => c.text).join('|');
    if (key === this._capKey) return;
    this._capKey = key;
    this.caps.replaceChildren(...caps.map((c) => {
      const d = el('div', `sh-cap at-${c.at || 'low'} sz-${c.size || 'l'}`, c.text);
      if (c.color) d.style.color = c.color;
      return d;
    }));
  }

  // ---------- панель ----------
  _buildUi() {
    const ui = this.ui = el('div', 'sh-panel');
    this.list = el('div', 'sh-list');
    const row = el('div', 'sh-row');
    const bPlay = el('button', 'primary', '▶ Играть'); bPlay.onclick = () => this.play();
    const bRec = el('button', '', '● Записать'); bRec.onclick = () => this.record();
    const bExit = el('button', '', 'Выход'); bExit.onclick = () => this.exit();
    row.append(bPlay, bRec, bExit);
    const opts = el('div', 'sh-opts');
    opts.append(checkbox('Отсчёт 3 с перед стартом', () => this.countdownOn, (v) => { this.countdownOn = v; }));
    opts.append(checkbox('Титры', () => this.captionsOn, (v) => { this.captionsOn = v; }));
    this.status = el('div', 'sh-status');
    const help = el('div', 'sh-help', '1–6 — сцена · Пробел — играть · H — панель · C — титры · Esc — выход.<br>Кадр 9:16 — по центру окна. Запись: «● Записать» снимает только кадр со звуком (Chrome).');
    ui.append(el('h3', '', 'Шортс-сцены · dev'), this.list, row, opts, this.status, help);
    this.caps = el('div', 'sh-caps');
    this.badge = el('div', 'sh-badge');
    this.end = el('div', 'sh-end');
    document.body.append(this.caps, this.badge, this.end, ui);
  }

  _renderUi() {
    this.list.replaceChildren(...SCENES.map((s, i) => {
      const b = el('button', 'sh-item' + (s === this.scene ? ' sel' : ''), `<b>${i + 1}</b> ${s.title} <em>≈${Math.round(estimateSeconds(s))} с</em>`);
      b.onclick = () => this.select(s.id);
      return b;
    }));
    this.ui.classList.remove('hidden');
    this.status.textContent = '';
  }

  _onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= SCENES.length) { this.select(SCENES[n - 1].id); e.stopPropagation(); return; }
    if (e.code === 'Space') { e.preventDefault(); this.play(); return; }
    if (e.code === 'KeyH') { this.ui.classList.toggle('hidden'); return; }
    if (e.code === 'KeyC') { this.captionsOn = !this.captionsOn; return; }
  }

  // ---------- запись вкладки: только кадр 9:16 со звуком игры ----------
  async record() {
    if (this.recorder) { this._stopRecording(); return; }
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: true, preferCurrentTab: true, selfBrowserSurface: 'include' });
      const [track] = stream.getVideoTracks();
      const crop = !!(window.CropTarget && track.cropTo);
      if (crop) await track.cropTo(await window.CropTarget.fromElement(document.body));
      const type = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16e6 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `short-${this.scene.id}.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        this.status.textContent = `Сохранено: ${a.download}` + (crop ? '' : ' — браузер не обрезал запись по кадру 9:16, обрежьте в редакторе');
      };
      track.addEventListener('ended', () => this._stopRecording());
      this.recorder = rec;
      this.select(this.scene.id);
      rec.start(250);
      await new Promise((res) => setTimeout(res, 400)); // первые кадры записи — уже со сценой
      this._go();
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop());
      this.recorder = null;
      this.status.textContent = 'Запись не началась: ' + (err.message || err) + '. Можно записать кадр через OBS или Win+Alt+R.';
    }
  }

  _stopRecording() {
    const r = this.recorder;
    this.recorder = null;
    if (r && r.state !== 'inactive') r.stop();
  }
}

function slowAt(list, t) {
  for (const [a, b, k] of list || []) if (t >= a && t < b) return k;
  return 1;
}

function makeCtx(v, w) {
  const b = { x: v.bx, y: v.by, z: v.bz };
  const p0 = { x: v.px, y: v.py, z: v.pz }, p1 = v.p2 ? { x: v.p2.px, y: v.p2.py, z: v.p2.pz } : { x: w.players[1].x, y: 0, z: w.players[1].z };
  return { b, p0, p1, w, mix: (a, c, k) => ({ x: lerp(a.x, c.x, k), y: lerp(a.y, c.y, k), z: lerp(a.z, c.z, k) }) };
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function checkbox(label, get, set) {
  const l = el('label', 'sh-check'), i = el('input');
  i.type = 'checkbox'; i.checked = get(); i.onchange = () => set(i.checked);
  l.append(i, document.createTextNode(' ' + label));
  return l;
}
