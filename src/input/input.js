// Единый набор игровых действий для клавиатуры и геймпада.
// Разделены удержание и события нажатия; автоповтор клавиш не создаёт событий.

export const DEFAULT_KEYS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  kick: ['KeyJ'], jump: ['Space'], receive: ['KeyE'], faceGoal: ['KeyQ'],
  sprint: ['KeyC', 'ShiftLeft', 'ShiftRight'], feint: ['KeyT'], super: ['KeyX'],
  pause: ['Escape'], confirm: ['Enter'], ballReturn: ['KeyR'], serve: ['KeyF'], wall: ['KeyG'],
};

// Стандартная раскладка Gamepad API (позиции кнопок)
export const DEFAULT_PAD = {
  kick: 2, jump: 3, receive: 0, control: 7, faceGoal: 6, sprint: 5, feint: 1, super: 4,
  pause: 9, confirm: 0, back: 1, up: 12, down: 13, left: 14, right: 15,
};

const STORAGE_KEY = 'soccer-duel-desktop.bindings.v1';

export function findConflicts(keys) {
  const seen = new Map(), conflicts = [];
  for (const [action, codes] of Object.entries(keys)) {
    for (const c of codes) {
      if (seen.has(c) && seen.get(c) !== action) conflicts.push([c, seen.get(c), action]);
      seen.set(c, action);
    }
  }
  return conflicts;
}

export class Input {
  constructor({ deadzone = 0.15, target = window } = {}) {
    this.deadzone = deadzone;
    this.keys = structuredClone(DEFAULT_KEYS);
    this.pad = { ...DEFAULT_PAD };
    this._loadBindings();
    this.down = new Set(); // удерживаемые коды клавиш
    this.blocked = new Set(); // удержанные до паузы — не срабатывают, пока не отпущены
    this.pressed = new Set(); // события нажатия действий до ближайшего шага симуляции
    this.menu = []; // события меню: up/down/left/right/confirm/back/pause
    this.padPrev = [];
    this.padBlocked = new Set();
    this.stickBlocked = false;
    this.padIndex = null;
    this.padKind = null;
    this.lastDevice = 'keyboard';
    this.capture = null; // режим переназначения: ввод не передаётся в игру
    this.onDeviceLost = null;
    this._stick = { x: 0, z: 0 };
    this._padHeld = {};

    target.addEventListener('keydown', (e) => this._keydown(e));
    target.addEventListener('keyup', (e) => { this.down.delete(e.code); this.blocked.delete(e.code); });
    target.addEventListener('gamepadconnected', (e) => { if (this.padIndex === null) this._attach(e.gamepad); });
    target.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.padIndex) {
        this.padIndex = null; this.padPrev = []; this._padHeld = {}; this._stick.x = this._stick.z = 0;
        this.pressed.clear();
        if (this.lastDevice !== 'keyboard') { this.lastDevice = 'keyboard'; this.onDeviceLost?.(); }
      }
    });
  }

  _attach(gp) {
    this.padIndex = gp.index;
    this.padKind = /sony|playstation|dualshock|dualsense|054c/i.test(gp.id) ? 'playstation' : 'xbox';
    this.padPrev = [];
  }

  _loadBindings() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (raw?.keys) for (const a of Object.keys(this.keys)) if (Array.isArray(raw.keys[a])) this.keys[a] = raw.keys[a];
      if (raw?.pad) Object.assign(this.pad, raw.pad);
    } catch { /* хранилище недоступно — остаются значения по умолчанию */ }
  }

  saveBindings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ keys: this.keys, pad: this.pad })); } catch { /* ignore */ }
  }

  rebindKey(action, code) {
    const next = structuredClone(this.keys);
    next[action] = [code];
    const conflicts = findConflicts(next);
    if (conflicts.length) return { ok: false, conflicts };
    this.keys = next; this.saveBindings();
    return { ok: true };
  }

  resetBindings() { this.keys = structuredClone(DEFAULT_KEYS); this.pad = { ...DEFAULT_PAD }; this.saveBindings(); }

  _actionOf(code) {
    for (const [a, codes] of Object.entries(this.keys)) if (codes.includes(code)) return a;
    return null;
  }

  _keydown(e) {
    if (this.capture) { e.preventDefault(); const c = this.capture; this.capture = null; c(e.code); return; }
    if (e.target && e.target.closest && e.target.closest('#net')) return; // экраны сетевой игры: текст и кнопки
    const action = this._actionOf(e.code);
    if (!action) return;
    e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.lastDevice = 'keyboard';
    this.pressed.add(action);
    if (['up', 'down', 'left', 'right', 'confirm', 'pause'].includes(action)) this.menu.push(action);
  }

  _held(action) {
    for (const c of this.keys[action] || []) if (this.down.has(c) && !this.blocked.has(c)) return true;
    return !!this._padHeld[action];
  }

  // Опрос геймпада — раз за кадр рендера
  poll() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    if (this.padIndex === null) { for (const g of pads) if (g && g.connected && g.mapping === 'standard') { this._attach(g); break; } }
    const gp = this.padIndex !== null ? pads[this.padIndex] : null;
    if (!gp) { this._padHeld = {}; this._stick.x = this._stick.z = 0; return; }
    let any = false;
    const held = {};
    for (const [action, idx] of Object.entries(this.pad)) {
      const b = gp.buttons[idx];
      const on = !!b && (b.pressed || b.value > 0.5);
      const was = !!this.padPrev[idx + ':' + action];
      if (!on) this.padBlocked.delete(idx);
      const active = on && !this.padBlocked.has(idx);
      if (active && !was) {
        any = true;
        this.pressed.add(action);
        if (['up', 'down', 'left', 'right', 'confirm', 'back', 'pause'].includes(action)) this.menu.push(action);
      }
      this.padPrev[idx + ':' + action] = active;
      held[action] = active;
    }
    this._padHeld = held;
    // радиальная мёртвая зона с пересчётом оставшегося диапазона
    let x = gp.axes[0] || 0, z = gp.axes[1] || 0;
    const m = Math.hypot(x, z);
    if (m <= this.deadzone) { x = 0; z = 0; this.stickBlocked = false; }
    else if (this.stickBlocked) { x = 0; z = 0; }
    else { const k = Math.min(1, (m - this.deadzone) / (1 - this.deadzone)) / m; x *= k; z *= k; any = true; }
    this._stick.x = x; this._stick.z = z;
    if (any) this.lastDevice = this.padKind;
  }

  // Заполнить кадр ввода для одного шага симуляции. edges=true — отдать и сбросить события нажатия.
  fill(out, edges) {
    let x = 0, z = 0, digital = true;
    const kx = (this._held('right') ? 1 : 0) - (this._held('left') ? 1 : 0);
    const kz = (this._held('down') ? 1 : 0) - (this._held('up') ? 1 : 0);
    if (kx || kz) { const l = Math.hypot(kx, kz); x = kx / l; z = kz / l; }
    else if (this._stick.x || this._stick.z) { x = this._stick.x; z = this._stick.z; digital = false; }
    out.mx = x; out.mz = z; out.digital = digital;
    out.kickHeld = this._held('kick');
    out.controlHeld = this._held('receive') || this._held('control');
    out.faceGoalHeld = this._held('faceGoal');
    out.sprintHeld = this._held('sprint');
    const p = this.pressed;
    out.kickPressed = edges && p.has('kick');
    out.jumpPressed = edges && p.has('jump');
    out.receivePressed = edges && p.has('receive');
    out.feintPressed = edges && p.has('feint');
    out.superPressed = edges && p.has('super');
    return out;
  }

  // Одноразовые команды песочницы (не входят в кадр симуляции)
  take(action) { const had = this.pressed.has(action); this.pressed.delete(action); return had; }
  endFrameEdges() { this.pressed.clear(); }
  takeMenu() { const m = this.menu; this.menu = []; return m; }

  // После паузы/потери фокуса: удержанное до паузы не срабатывает, пока не отпущено
  suppressHeld() {
    for (const c of this.down) this.blocked.add(c);
    for (const [action, idx] of Object.entries(this.pad)) if (this._padHeld[action]) this.padBlocked.add(idx);
    if (this._stick.x || this._stick.z) this.stickBlocked = true;
    this._padHeld = {}; this._stick.x = this._stick.z = 0;
    this.pressed.clear(); this.menu = [];
  }

  releaseAll() { this.down.clear(); this.blocked.clear(); this.pressed.clear(); this._padHeld = {}; }

  rumble(strength, ms) {
    if (this.padIndex === null || this.lastDevice === 'keyboard') return;
    const gp = navigator.getGamepads()[this.padIndex];
    gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 })?.catch?.(() => {});
  }

  hintFor(action) {
    if (this.lastDevice === 'keyboard') return KEY_LABEL[this.keys[action]?.[0]] || this.keys[action]?.[0]?.replace(/^Key/, '') || '?';
    const names = this.lastDevice === 'playstation' ? PS_NAMES : XBOX_NAMES;
    return names[this.pad[action]] ?? '?';
  }
}

const KEY_LABEL = { Space: 'Пробел', Escape: 'Esc', Enter: 'Enter', ShiftLeft: 'Shift', ArrowUp: '↑' };
const XBOX_NAMES = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 9: 'Menu' };
const PS_NAMES = { 0: '×', 1: '○', 2: '□', 3: '△', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 9: 'Options' };
