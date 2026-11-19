// Шортс-сцены (только dev-сервер): ввод обоих игроков по сценарию. Чистая логика без DOM — её же гоняет
// scripts/shorts-check.mjs и tests/shorts.test.js в Node. Время — секунды симуляции от начала сцены (не реальное время:
// замедление и повтор не меняют, что произойдёт).
//
// Действие игрока — объект с интервалом from..to (секунды) или моментом at:
//   { at: 1.2, press: 'jump' }                 — нажатие на один шаг: jump | kick | lob | super | receive
//   { from: 1, to: 2, hold: 'kick' }           — удержание: kick | lob | super | sprint | guard | control | face
//   { from: 0, to: 1, move: [mx, mz] }         — стик (x — вдоль поля, z — поперёк; +z — вниз экрана)
//   { from: 0, to: 2, go: [x, z], sprint }     — бег к точке (останавливается рядом)
//   { from: 0, to: 2, chase: true, sprint }    — бег к мячу
//   { from: 0, to: 9, ai: 'hard' }             — играет бот этого уровня
//   { from: 1, to: 2, analog: true }           — аналоговый стик (прицел следует за стиком, а не копится)
import { emptyInput } from '../sim/world.js';
import { Bot } from '../ai/bot.js';

const PRESS = { jump: 'jumpPressed', kick: 'kickPressed', lob: 'lobPressed', super: 'superPressed', receive: 'receivePressed' };
const HOLD = { kick: 'kickHeld', lob: 'lobHeld', super: 'superHeld', sprint: 'sprintHeld', guard: 'guardHeld', control: 'controlHeld', face: 'faceGoalHeld' };

export class ShortRunner {
  constructor(world, scene) {
    this.w = world; this.scene = scene;
    this.dt = world.dt;
    this.step = 0; // номер шага от начала сцены
    this.out = [emptyInput(), emptyInput()];
    this.bots = [null, null];
  }

  get t() { return this.step * this.dt; }

  // Ввод обоих игроков на текущий шаг; после world.step вызвать advance()
  inputs() {
    const w = this.w, t = this.t, i0 = Math.round(t / this.dt);
    for (let i = 0; i < 2; i++) {
      const o = this.out[i], p = w.players[i];
      Object.assign(o, emptyInput());
      for (const a of this.scene.players[i] || []) {
        if (a.at !== undefined) { if (Math.round(a.at / this.dt) === i0 && PRESS[a.press]) o[PRESS[a.press]] = true; continue; }
        if (t < a.from || t >= a.to) continue;
        if (a.hold) o[HOLD[a.hold]] = true;
        if (a.analog) o.digital = false;
        if (a.move) { o.mx = a.move[0]; o.mz = a.move[1]; }
        if (a.go || a.chase) {
          const tx = a.go ? a.go[0] : w.ball.x, tz = a.go ? a.go[1] : w.ball.z;
          const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
          if (d > (a.near ?? 0.25)) { const s = Math.min(1, d / 0.8); o.mx = dx / d * s; o.mz = dz / d * s; o.digital = false; }
          if (a.sprint) o.sprintHeld = true;
        }
        if (a.ai) {
          let b = this.bots[i];
          if (!b || b.level !== a.ai || b.since !== a.from) { b = this.bots[i] = new Bot(i, a.ai, (this.scene.seed || 1) * 31 + i); b.since = a.from; }
          Object.assign(o, b.think(w));
        }
      }
    }
    return this.out;
  }

  advance() { this.step++; }
}

// Сцена с нуля: мир дуэли сброшен с зерном сцены, расстановка — scene.stage(w)
export function stageShort(world, scene) {
  world.seed = scene.seed || 1;
  world.reset('duel');
  if (scene.stage) scene.stage(world);
  world.events.length = 0;
}

// Поставить игрока: положение, взгляд (рад; 0 — вправо по полю, π — влево), стопы под корпусом
export function place(w, i, x, z, yaw) {
  const p = w.players[i];
  p.x = x; p.z = z; p.yaw = yaw; p.vx = p.vz = 0;
  w._placeFeet(p);
  return p;
}

// Мяч: положение и скорость
export function setBall(w, x, z, y = w.P.ball.radius, vx = 0, vy = 0, vz = 0) {
  Object.assign(w.ball, { x, y, z, vx, vy, vz, wx: 0, wy: 0, wz: 0, inGoal: false });
}
