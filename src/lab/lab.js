// Лаборатория: сценарии, замедление, шаг по тикам, ракурсы, кости, точки стоп, диагностика, повтор записи.
// Подключается только в dev-режиме или сборке --mode lab; в релизную сборку не входит.
import * as THREE from 'three';
import { SCENARIOS } from '../sim/world.js';
import { createProfile } from '../sim/profile.js';

const TUNABLES = [
  ['player.runSpeed', 2, 5, 0.1], ['player.sprintSpeed', 3, 6.5, 0.1], ['player.controlSpeed', 1, 3, 0.1],
  ['player.accel', 6, 30, 0.5], ['player.brake', 6, 30, 0.5], ['player.reverseBrake', 10, 40, 1], ['player.turnRate', 6, 30, 0.5],
  ['dribble.pushRun', 0.3, 2, 0.05], ['dribble.pushSprint', 0.5, 3, 0.05], ['dribble.pushControl', 0.2, 1.5, 0.05],
  ['ball.rollDecel', 0.8, 4, 0.1], ['kick.chargeTime', 0.2, 0.8, 0.01], ['kick.minSpeed', 6, 16, 0.5], ['kick.maxSpeed', 14, 32, 0.5],
  ['kick.maxSpin', 0, 90, 1], ['receive.window', 0.08, 0.3, 0.01],
  ['kick.approachAngle', 0, 0.8, 0.02], ['kick.approachBack', 0.2, 0.5, 0.01], ['kick.approachSide', 0.1, 0.35, 0.01],
  ['kick.followSpeed', 0, 2.5, 0.1], ['kick.followTime', 0.1, 0.8, 0.02], ['kick.followLand', 0.15, 0.6, 0.01],
  ['kick.strikeSpeed', 2, 7, 0.1], ['kick.strikeHorizon', 0.3, 1.2, 0.05], ['kick.volleyBonus', 0, 0.8, 0.05], ['kick.standReach', 0.7, 1.4, 0.05], ['kick.jumpReach', 0.3, 1.3, 0.05],
];
const get = (o, path) => path.split('.').reduce((a, k) => a[k], o);
const set = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

export class Lab {
  constructor(game, root) {
    this.game = game; this.root = root;
    this.open = false; this.showFeet = false;
    this.d = { t90: null, stop: null, lastTouchGap: null, touchIntervals: [], slipMax: 0, soleErrMax: 0, reachMax: 0, jointJump: 0 };
    this._m = { accelFrom: null, stopFrom: null, lastTouchTick: null, plantedPrev: [null, null], lastAnkle: [null, null] };
    this._build();
    this._feet = [0, 1].map((i) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(game.world.P.player.footRadius, game.world.P.player.footRadius, 0.01, 16), new THREE.MeshBasicMaterial({ color: i ? 0xff6b6b : 0x4dc3ff, transparent: true, opacity: 0.8, depthTest: false }));
      m.visible = false; m.renderOrder = 8; game.scene.scene.add(m); return m;
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F1') { e.preventDefault(); this.toggle(); }
      if (!this.open) return;
      if (e.code === 'KeyP') this.setPaused(!game.simPaused);
      if (e.code === 'KeyO') { game.simPaused = true; game.stepOnce = true; this._sync(); }
      const n = e.code.startsWith('Digit') ? Number(e.code.slice(5)) : 0;
      const keys = Object.keys(SCENARIOS);
      if (n >= 1 && n <= keys.length) game.resetSandbox(keys[n - 1]);
    });
  }

  toggle() { this.open = !this.open; this.root.classList.toggle('open', this.open); this._sync(); }
  setPaused(v) { this.game.simPaused = v; this._sync(); }

  _build() {
    const g = this.game, r = this.root;
    const h = (t) => { const e = document.createElement('h3'); e.textContent = t; r.append(e); };
    const btn = (label, fn, group) => { const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', () => { fn(b); this._sync(); b.blur(); }); if (group) b.dataset.g = group; r.append(b); return b; };
    h('Сценарии (1–7)');
    Object.entries(SCENARIOS).forEach(([k, s]) => btn(s.label, () => g.resetSandbox(k)));
    h('Время (P — пауза, O — шаг)');
    for (const ts of [1, 0.5, 0.25, 0.1]) btn(ts + '×', () => { g.timeScale = ts; }, 'ts:' + ts);
    btn('Пауза', () => { g.simPaused = !g.simPaused; }, 'pause');
    btn('Шаг', () => { g.simPaused = true; g.stepOnce = true; });
    h('Ракурс');
    for (const [v, l] of [['game', 'Игровой'], ['front', 'Спереди'], ['side', 'Сбоку'], ['close', 'Близко']]) btn(l, () => g.scene.setView(v), 'view:' + v);
    h('Отображение');
    btn('Кости', () => { g.rig.skeletonHelper.visible = !g.rig.skeletonHelper.visible; }, 'bones');
    btn('Точки стоп', () => { this.showFeet = !this.showFeet; }, 'feet');
    btn('Клипы набора', () => { g.rig.packClips = g.rig2.packClips = !g.rig.packClips; }, 'pack'); // сравнение: клипы Mocap Pack / прежние
    btn('Празднование', () => g.rig.celebrate());
    h('Запись');
    btn('Повтор с последнего сброса', () => g.startReplay());
    btn('Скачать журнал', () => g.exportLog());
    h('Диагностика');
    this.pre = document.createElement('pre'); r.append(this.pre);
    h('Профиль');
    this.sliders = [];
    for (const [path, min, max, step] of TUNABLES) {
      const l = document.createElement('label');
      const name = document.createElement('span'); name.textContent = path;
      const inp = document.createElement('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
      const val = document.createElement('span');
      inp.addEventListener('input', () => { set(g.world.P, path, Number(inp.value)); val.textContent = inp.value; });
      l.append(name, inp, val); r.append(l);
      this.sliders.push({ path, inp, val });
    }
    // подстройка клипа удара к мячу: коридор поправки и её вес по времени (playerRig.adapt)
    h('Подстройка удара');
    btn('Нога из клипа', () => { g.rig.adapt.kickLeg = g.rig2.adapt.kickLeg = !g.rig.adapt.kickLeg; }, 'kickleg');
    btn('Профиль по референсу', () => { g.rig.adapt.kickRef = g.rig2.adapt.kickRef = !g.rig.adapt.kickRef; }, 'kickref');
    for (const [key, min, max, step] of [['kickReach', 0, 0.8, 0.05], ['simLead', 0.04, 0.3, 0.01], ['simHold', 0.05, 0.4, 0.01], ['simAfter', 0, 1, 0.05],
      ['antLead', 0.2, 0.8, 0.05], ['antFull', 0.05, 0.4, 0.05], ['kneeFront', 0, 0.6, 0.05], ['kneeRate', 5, 60, 1]]) {
      const l = document.createElement('label');
      const name = document.createElement('span'); name.textContent = 'adapt.' + key;
      const inp = document.createElement('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = g.rig.adapt[key];
      const val = document.createElement('span'); val.textContent = g.rig.adapt[key];
      inp.addEventListener('input', () => { g.rig.adapt[key] = g.rig2.adapt[key] = Number(inp.value); val.textContent = inp.value; });
      l.append(name, inp, val); r.append(l);
    }
    btn('Сбросить профиль', () => { const fresh = createProfile(); for (const k of Object.keys(fresh)) g.world.P[k] = fresh[k]; });
    this._sync();
  }

  _sync() {
    const g = this.game;
    for (const b of this.root.querySelectorAll('button[data-g]')) {
      const k = b.dataset.g;
      b.classList.toggle('on', k === 'ts:' + g.timeScale || (k === 'pause' && g.simPaused) || k === 'view:' + g.scene.view
        || (k === 'bones' && g.rig.skeletonHelper?.visible) || (k === 'feet' && this.showFeet) || (k === 'pack' && g.rig.packClips) || (k === 'kickleg' && g.rig.adapt.kickLeg) || (k === 'kickref' && g.rig.adapt.kickRef));
    }
    for (const s of this.sliders) { const v = get(g.world.P, s.path); s.inp.value = v; s.val.textContent = v; }
  }

  // после каждого тика симуляции
  onTick(world, input) {
    const p = world.player, d = this.d, m = this._m, t = world.tick * world.dt;
    const sp = Math.hypot(p.vx, p.vz), mag = Math.hypot(input.mx, input.mz);
    const target = (p.mode === 'sprint' ? world.P.player.sprintSpeed : p.mode === 'control' ? world.P.player.controlSpeed : world.P.player.runSpeed);
    if (mag > 0.5 && sp < 0.3 && m.accelFrom === null) m.accelFrom = t;
    if (m.accelFrom !== null && sp >= 0.9 * target * Math.min(1, mag)) { d.t90 = t - m.accelFrom; m.accelFrom = null; }
    if (mag < 0.05 && m.accelFrom !== null) m.accelFrom = null;
    if (mag < 0.05 && sp > 0.9 * world.P.player.runSpeed && m.stopFrom === null) m.stopFrom = t;
    if (m.stopFrom !== null && sp < 0.05) { d.stop = t - m.stopFrom; m.stopFrom = null; }
    if (mag > 0.05) m.stopFrom = null;
    for (const e of world.events) {
      if (e.type === 'touch') {
        if (m.lastTouchTick !== null) { d.touchIntervals.push((world.tick - m.lastTouchTick) * world.dt); if (d.touchIntervals.length > 12) d.touchIntervals.shift(); }
        m.lastTouchTick = world.tick;
      }
      if (e.type === 'touch_miss' || e.type === 'kick_miss') d.lastTouchGap = e.gap;
      if (e.type === 'reset') { m.lastTouchTick = null; d.touchIntervals.length = 0; d.slipMax = d.soleErrMax = d.reachMax = 0; }
    }
  }

  // раз за кадр рендера, после позы
  onFrame(dt) {
    const g = this.game, w = g.world, p = w.player, b = w.ball, d = this.d;
    this._feet.forEach((mesh, i) => { mesh.visible = this.showFeet; const f = p.feet[i]; mesh.position.set(f.x, f.h + 0.01, f.z); });
    if (g.rig.ready) {
      // опора по фактическому положению костей после IK (не по целям симуляции)
      const meas = g.rig.measureFeet(this._meas || (this._meas = [{}, {}]));
      for (let i = 0; i < 2; i++) {
        const planted = p.feet[i].planted, prev = this._m.lastAnkle[i];
        if (planted && prev && this._m.plantedPrev[i] && !g.simPaused && meas[i].pitch >= 0) {
          d.slipMax = Math.max(d.slipMax * 0.995, Math.hypot(meas[i].x - prev.x, meas[i].z - prev.z));
          d.soleErrMax = Math.max(d.soleErrMax * 0.995, Math.abs(meas[i].soleErr));
        }
        this._m.lastAnkle[i] = { x: meas[i].x, z: meas[i].z }; this._m.plantedPrev[i] = planted;
        d.reachMax = Math.max(d.reachMax * 0.995, g.rig.diag.reachErr[i]);
      }
    }
    if (!this.open) return;
    const f2 = (v) => (v === null || v === undefined ? '—' : v.toFixed(2));
    const k = p.kick, s = w.stats;
    const ti = d.touchIntervals.length ? d.touchIntervals.reduce((a, c) => a + c, 0) / d.touchIntervals.length : null;
    const total = s.touches + s.misses;
    this.pre.textContent = [
      `тик ${w.tick}  ${g.replay ? 'ПОВТОР ' + g.replay.i + '/' + g.replay.frames.length : 'запись ' + w.inputLog.length}  seed ${w.seed}`,
      `fps ${g.fps.toFixed(0)}  шаг ${w.P.simHz} Гц  профиль ${w.P.version}`,
      `скорость ${f2(Math.hypot(p.vx, p.vz))} м/с  режим ${p.mode}  y ${f2(p.y)}`,
      `разгон до 90%: ${f2(d.t90)} с   остановка: ${f2(d.stop)} с`,
      `мяч: дист ${f2(Math.hypot(b.x - p.x, b.z - p.z))} м  v ${f2(Math.hypot(b.vx, b.vy, b.vz))}  h ${f2(b.y)}  wy ${f2(b.wy)}`,
      `владение ${p.possession ? 'да' : 'нет'}  время мяча позади ${f2(s.behindTime)} с`,
      `касания ${s.touches} / промахи ${s.misses} (${total ? Math.round((100 * s.touches) / total) : 100}%)  интервал ${f2(ti)} с`,
      `удары ${s.kicks} / мимо ${s.kickMisses}  приёмы ${s.receives}  потери ${s.lostControl}`,
      `последний зазор промаха ${f2(d.lastTouchGap)} м`,
      `удар: ${k ? k.phase + ' заряд ' + f2(k.charge) + ' цель ' + f2(k.aimLat) + '/' + f2(k.aimHigh) + ' нога ' + (k.footSide > 0 ? 'П' : 'Л') : '—'}`,
      `план удара: поза ${f2(g.rig.diag.plan.w)}  высота контакта ${f2(g.rig.diag.plan.h)} м  до контакта ${f2(g.rig.diag.plan.tc)} с`,
      `нога из клипа: вес ${f2(g.rig.diag.kick.legK)}  к мячу ${f2(g.rig.diag.kick.sim)}  поправка ${(g.rig.diag.kick.corr * 100).toFixed(0)} см  срезано ${(g.rig.diag.kick.cut * 100).toFixed(0)} см`,
      `стопы: Л ${p.feet[0].planted ? 'опора' : 'мах'} h ${f2(p.feet[0].h)}  П ${p.feet[1].planted ? 'опора' : 'мах'} h ${f2(p.feet[1].h)}`,
      `опора (кости после IK): дрейф ${(d.slipMax * 100).toFixed(1)} см/кадр, высота ${(d.soleErrMax * 100).toFixed(1)} см, недотяг ${(d.reachMax * 100).toFixed(1)} см`,
      g.rig.ready ? `модель: рост ${g.rig.info.height} м (×${g.rig.info.scale.toFixed(4)}), бедро ${f2(g.rig.info.thigh)}, голень ${f2(g.rig.info.shin)}, подошва y ${g.rig.info.soleY.toFixed(3)}` : 'модель загружается',
    ].join('\n');
  }
}
