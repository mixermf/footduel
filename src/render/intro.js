// Сцена перед сетевым матчем. Идёт, пока сервер держит отсчёт перед началом (COUNTDOWN_MS); сеть в ней не участвует:
// сцена — функция времени отсчёта, оба клиента показывают одно и то же.
//
// Два плана, между ними склейка:
//  1. Крупный план (motion capture, клипы Mixamo). Игроки идут навстречу своей походкой и жмут руки. Все кости — из клипов,
//     симуляции нет. Корень игрока двигается со скоростью, замеренной у самого клипа (стопы не скользят), а расстановка
//     считается по клипу рукопожатия: игроки встают так, чтобы правые кисти сошлись в одной точке, и IK доводит обе кисти
//     до неё точно.
//  2. Общий план (симуляция). Игроки отходят на свои места спиной вперёд, в стойке: их ведут две «куклы», симуляции
//     песочницы с вводом по расписанию. Камера отъезжает к игровому ракурсу, к концу сцена сходится к настоящим
//     положениям игроков.
// Второй игрок — та же постановка, повёрнутая на 180° вокруг центра поля.
import { World, emptyInput } from '../sim/world.js';
import { createProfile } from '../sim/profile.js';
import { CLIPS } from './mocap.js';

export const WALKS = [CLIPS.introWalk, CLIPS.introStrut]; // походки: какая у кого — выбирает вызывающий (по номеру игрока)

// Расписание, с от начала сцены
export const INTRO = {
  stride: 1.15, // поправка скорости ходьбы к замеренной по клипу: без неё опорная стопа ползла назад на 0,085 м/с
  walkAt: 0.25, walkLen: 1.75, ease: 0.4, // ходьба: начало, длительность, разгон и остановка
  shakeAt: 1.85, shakeFrom: 0.45, shakeTo: 3.2, // рукопожатие: начало в сцене и окно клипа (до и после — стойка)
  grip: [1.25, 2.6], gripIn: 0.3, gripOut: 0.22, // время клипа, пока кисти сцеплены; за сколько IK берёт и отпускает кисть
  home: 4, // место ввода мяча от центра, м
  camOut: 1.3, // за сколько секунд после склейки камера доезжает до игрового ракурса
  blend: 0.45, // за сколько секунд до конца сцена сходится к настоящим положениям игроков
};
INTRO.cut = INTRO.shakeAt + (INTRO.shakeTo - INTRO.shakeFrom); // склейка: рукопожатие кончилось

const sm = (x) => { const y = Math.max(0, Math.min(1, x)); return y * y * (3 - 2 * y); };
// доля полной скорости ходьбы в момент t: разгон, ровный шаг, остановка
const pace = (t) => sm((t - INTRO.walkAt) / INTRO.ease) * (1 - sm((t - (INTRO.walkAt + INTRO.walkLen - INTRO.ease)) / INTRO.ease));
// сколько секунд ходьбы «в полную скорость» набежало к моменту t
const walked = (t) => { let s = 0; const h = 1 / 120; for (let x = 0; x < Math.min(t, INTRO.walkAt + INTRO.walkLen); x += h) s += pace(x + h / 2) * h; return s; };

export class MatchIntro {
  // rig — любой загруженный риг игрока: по нему считается геометрия клипов (оба игрока — одна модель)
  constructor(rig) {
    this.rig = rig;
    this.pu = [0, 1].map((i) => ({ w: new World(createProfile(), { seed: 3 + i }), inp: emptyInput(), n: 0, delay: i * 0.08, back: false, backT: 0, view: {} }));
    this.v1 = { feet: [{}, {}] };
    this.aux = [0, 1].map(() => ({ ball: { x: 0, y: 1.6, z: 0 }, kick: null, gesture: null, guard: false, withBall: false, juggle: null }));
    this.cam = { px: 0, py: 1.5, pz: 4, lx: 0, ly: 1.1, lz: 0, out: 0 };
    this.roots = [{ x: 0, z: 0, yaw: 0 }, { x: 0, z: 0, yaw: Math.PI }];
    this.layers = [[], []];
    this.hands = [{ i: 1, x: 0, y: 1, z: 0, w: 0 }, { i: 1, x: 0, y: 1, z: 0, w: 0 }];
    // где кисть в рукопожатии относительно корня (среднее за время сцепки): вперёд и вправо, м
    const S = CLIPS.introShake; let fx = 0, fz = 0, n = 0;
    for (let t = INTRO.grip[0]; t <= INTRO.grip[1]; t += 0.05) { const p = rig.clipPoint(S, t, 'RightHand'); fx += p.x; fz += p.z; n++; }
    this.reach = fx / n; this.side = fz / n;
    this.walkT = walked(99);
    this._simOn = false;
  }

  _resetSim() {
    for (const u of this.pu) {
      const w = u.w; w.reset('motor');
      const p = w.player; p.x = -this.reach; p.z = -this.side; p.yaw = 0; p.vx = p.vz = 0; w._placeFeet(p);
      u.n = 0; u.back = false; u.backT = 0;
      w._snapPlayer(p, u.view);
    }
  }

  reset() { this._simOn = false; }

  _step(u) {
    const w = u.w, p = w.player, I = INTRO, ts = u.n / w.P.simHz, inp = u.inp;
    let mx = 0;
    // на свои места отходят спиной вперёд, в стойке, не отворачиваясь от соперника. Вариант «развернулся, добежал,
    // развернулся» по замеру давал рывок стопы на последнем развороте (кадр в 26 раз быстрее соседних)
    let away = false;
    if (!u.back) { if (p.x > -(I.home - 0.14)) { mx = -1; away = true; } else { u.back = true; u.backT = ts; } }
    inp.guardHeld = away;
    inp.mx = mx; inp.mz = 0;
    const b = w.ball; b.x = 7; b.z = p.z; b.y = w.P.ball.radius; b.vx = b.vy = b.vz = 0; // мяч куклы — далеко впереди, по линии взгляда
    w.step(inp);
    u.n++;
  }

  // t — секунды от начала сцены; pick — номера походок игроков. Возвращает кадр постановки:
  //   clip: true  — крупный план: roots, layers и hands для PlayerRig.updateClip;
  //   clip: false — общий план: v и aux для PlayerRig.update;  cam — камера (out: доля игрового ракурса).
  frame(t, pick = [0, 1]) {
    const I = INTRO, c = this.cam, S = CLIPS.introShake, H = this.rig.hipRestY;
    if (t < I.cut) {
      this._simOn = false;
      const e = pace(t), E = walked(t), wWalk = sm(e * 1.6);
      const tc = I.shakeFrom + Math.max(0, t - I.shakeAt);
      const hw = sm((tc - (I.grip[0] - I.gripIn)) / I.gripIn) * (1 - sm((tc - I.grip[1]) / I.gripOut));
      const hy = this.rig.clipPoint(S, tc, 'RightHand').y; // высота сцепки — из клипа: качание руки остаётся как снято
      for (let i = 0; i < 2; i++) {
        const W = WALKS[pick[i] % WALKS.length], v = W.speed * H * I.stride, sgn = i ? 1 : -1;
        const r = this.roots[i];
        r.x = sgn * (this.reach + v * (this.walkT - E)); r.z = sgn * this.side; r.yaw = i ? Math.PI : 0;
        const L = this.layers[i]; L.length = 0;
        if (wWalk > 0.001) L.push({ clip: W, t: E + i * W.duration * 0.5, w: wWalk });
        if (wWalk < 0.999) L.push({ clip: S, t: tc, w: 1 - wWalk });
        const h = this.hands[i]; h.w = hw; h.x = 0; h.y = hy; h.z = 0; // точка сцепки — над центром: середина между двумя кистями
      }
      const k = sm(t / 2.2);
      c.px = 0.45 - 0.45 * k; c.py = 1.48 - 0.06 * k; c.pz = 4.4 - 1.2 * k; c.lx = 0; c.ly = 1.12; c.lz = 0; c.out = 0;
      return { clip: true, roots: this.roots, layers: this.layers, hands: this.hands, hw, cam: c };
    }
    if (!this._simOn) { this._resetSim(); this._simOn = true; }
    for (const u of this.pu) {
      const hz = u.w.P.simHz, want = Math.max(0, Math.floor((t - I.cut - u.delay) * hz));
      if (want < u.n) this._resetSim(); // время пошло назад
      let guard = 0;
      while (u.n < want && guard++ < 2400) this._step(u);
      u.w._snapPlayer(u.w.player, u.view);
    }
    const a = this.pu[1].view, b = this.v1;
    b.px = -a.px; b.pz = -a.pz; b.py = a.py; b.vx = -a.vx; b.vz = -a.vz; b.yaw = a.yaw + Math.PI; b.gp = a.gp; b.gait = a.gait;
    for (let i = 0; i < 2; i++) { const s = a.feet[i], d = b.feet[i]; d.x = -s.x; d.z = -s.z; d.h = s.h; d.yaw = s.yaw + Math.PI; d.planted = s.planted; d.u = s.u; d.top = s.top; }
    const views = [this.pu[0].view, b];
    for (let i = 0; i < 2; i++) { const A = this.aux[i], o = views[1 - i]; A.ball.x = o.px; A.ball.z = o.pz; A.ball.y = 1.6; }
    c.px = 0; c.py = 1.42; c.pz = 3.2; c.lx = 0; c.ly = 1.12; c.lz = 0;
    c.out = 0.45 + 0.55 * sm((t - I.cut) / I.camOut); // после склейки — уже общий план, дальше плавный отъезд
    return { clip: false, v: views, aux: this.aux, hw: 0, cam: c };
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
