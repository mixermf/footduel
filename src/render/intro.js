// Сцена перед сетевым матчем: игроки стоят у центра, идут навстречу, жмут руки, расходятся на свои места; камера —
// крупный план, затем отъезд к игровому ракурсу. Идёт, пока сервер держит отсчёт перед началом (COUNTDOWN_MS).
//
// Игроков ведут две «куклы» — обычные симуляции песочницы, которым подаётся ввод по расписанию: шаги, остановка, разворот
// и бег получаются теми же стопами и той же походкой, что в игре. Вторая кукла — та же сцена, повёрнутая на 180° вокруг
// центра поля, и запущенная на несколько кадров позже, чтобы игроки не шагали зеркально в ногу.
// Сцена — функция времени отсчёта: оба клиента показывают одно и то же, сеть в ней не участвует.
import { World, emptyInput } from '../sim/world.js';
import { createProfile } from '../sim/profile.js';

// Расписание, с от начала сцены
export const INTRO = {
  startX: 1.9, side: 0.12, // где стоят в начале: от центра по длине поля и в сторону (правые плечи — на одной линии)
  walkAt: 0.5, meet: 0.33, walk: 0.36, // когда пошли, на каком расстоянии от центра встали, наклон стика (шаг, не бег)
  shake: [2.15, 3.55], pump: 2.3, // рукопожатие: начало и конец, качаний в секунду
  leave: 3.75, home: 4, // когда разошлись; место ввода мяча от центра
  cam: [3.7, 5.8], // отъезд камеры: начало и конец
  blend: 0.45, // за сколько секунд до конца сцена сходится к настоящим положениям игроков
};
const sm = (x) => { const y = Math.max(0, Math.min(1, x)); return y * y * (3 - 2 * y); };

export class MatchIntro {
  constructor() {
    this.pu = [0, 1].map((i) => ({ w: new World(createProfile(), { seed: 3 + i }), inp: emptyInput(), n: 0, delay: i * 0.1, met: false, back: false, backT: 0, view: {} }));
    this.v1 = { feet: [{}, {}] };
    this.aux = [0, 1].map(() => ({ ball: { x: 0, y: 1.6, z: 0 }, kick: null, gesture: null, guard: false, withBall: false, juggle: null, hand: { i: 1, x: 0, y: 1, z: 0, w: 0 } }));
    this.cam = { px: 0, py: 1.5, pz: 4, lx: 0, ly: 1.1, lz: 0, out: 0 };
    this.reset();
  }

  reset() {
    for (const u of this.pu) {
      const w = u.w; w.reset('motor');
      const p = w.player; p.x = -INTRO.startX; p.z = -INTRO.side; p.yaw = 0; p.vx = p.vz = 0; w._placeFeet(p);
      u.n = 0; u.met = u.back = false; u.backT = 0;
      w._snapPlayer(p, u.view);
    }
  }

  _step(u) {
    const w = u.w, p = w.player, I = INTRO, ts = u.n / w.P.simHz, inp = u.inp;
    let mx = 0;
    if (ts >= I.walkAt && !u.met) { if (p.x < -(I.meet + 0.1)) mx = I.walk; else u.met = true; }
    // расходятся спиной вперёд, не отворачиваясь друг от друга: два разворота на 180° подряд выглядели суетой
    let away = false;
    if (ts >= I.leave && !u.back) { if (p.x > -(I.home - 0.14)) { mx = -1; away = true; } else { u.back = true; u.backT = ts; } }
    inp.guardHeld = away; // в стойке игрок держит лицо к мячу (он впереди) и отходит спиной
    inp.mx = mx; inp.mz = 0;
    const b = w.ball; b.x = 7; b.z = p.z; b.y = w.P.ball.radius; b.vx = b.vy = b.vz = 0; // мяч куклы — далеко впереди, по линии взгляда
    w.step(inp);
    u.n++;
  }

  // t — секунды от начала сцены. Возвращает снимки игроков (как World._snapPlayer), дополнения для рига и камеру.
  frame(t) {
    const I = INTRO;
    for (const u of this.pu) {
      const hz = u.w.P.simHz, want = Math.max(0, Math.floor((t - u.delay) * hz));
      if (want < u.n) this.reset(); // время пошло назад: сцена начинается заново
      let guard = 0;
      while (u.n < want && guard++ < 2400) this._step(u);
      u.w._snapPlayer(u.w.player, u.view);
    }
    // второй игрок — та же сцена, повёрнутая на 180° вокруг центра поля
    const a = this.pu[1].view, b = this.v1;
    b.px = -a.px; b.pz = -a.pz; b.py = a.py; b.vx = -a.vx; b.vz = -a.vz; b.yaw = a.yaw + Math.PI; b.gp = a.gp; b.gait = a.gait;
    for (let i = 0; i < 2; i++) { const s = a.feet[i], d = b.feet[i]; d.x = -s.x; d.z = -s.z; d.h = s.h; d.yaw = s.yaw + Math.PI; d.planted = s.planted; d.u = s.u; d.top = s.top; }
    const v0 = this.pu[0].view;
    // рукопожатие: правые кисти сходятся над центром и качаются вместе
    const w = sm((t - I.shake[0]) / 0.3) * (1 - sm((t - I.shake[1] + 0.3) / 0.3));
    const hy = 1.03 + 0.05 * Math.sin(2 * Math.PI * I.pump * (t - I.shake[0] - 0.3)) * sm((t - I.shake[0] - 0.3) / 0.15) * (1 - sm((t - I.shake[1] + 0.45) / 0.15));
    const views = [v0, b];
    for (let i = 0; i < 2; i++) {
      const A = this.aux[i], o = views[1 - i];
      A.ball.x = o.px; A.ball.z = o.pz; A.ball.y = 1.6; // взгляд — на соперника
      A.hand.w = w; A.hand.x = 0; A.hand.y = hy; A.hand.z = 0;
    }
    // камера: медленный наезд на пару, после рукопожатия — отъезд к игровому ракурсу
    const k = sm(t / 2.2), c = this.cam;
    c.px = 0.5 - 0.5 * k; c.py = 1.5 - 0.08 * k; c.pz = 4.6 - 1.2 * k; c.lx = 0; c.ly = 1.12; c.lz = 0;
    c.out = sm((t - I.cam[0]) / (I.cam[1] - I.cam[0]));
    return { v: views, aux: this.aux, cam: c };
  }
}

// Смешать снимок сцены с настоящим положением игрока (конец сцены): k = 0 — сцена, 1 — игра
export function blendView(out, a, b, k) {
  const L = (x, y) => x + (y - x) * k;
  let dy = (b.yaw - a.yaw) % (Math.PI * 2); if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
  out.px = L(a.px, b.px); out.pz = L(a.pz, b.pz); out.py = L(a.py, b.py); out.vx = L(a.vx, b.vx); out.vz = L(a.vz, b.vz);
  out.yaw = a.yaw + dy * k; out.gp = k > 0.5 ? b.gp : a.gp; out.gait = k > 0.5 ? b.gait : a.gait;
  out.feet = out.feet || [{}, {}];
  for (let i = 0; i < 2; i++) {
    const fa = a.feet[i], fb = b.feet[i], f = out.feet[i];
    let fy = (fb.yaw - fa.yaw) % (Math.PI * 2); if (fy > Math.PI) fy -= Math.PI * 2; else if (fy < -Math.PI) fy += Math.PI * 2;
    f.x = L(fa.x, fb.x); f.z = L(fa.z, fb.z); f.h = L(fa.h, fb.h); f.yaw = fa.yaw + fy * k;
    f.planted = k > 0.5 ? fb.planted : fa.planted; f.u = k > 0.5 ? fb.u : fa.u; f.top = false;
  }
  return out;
}
