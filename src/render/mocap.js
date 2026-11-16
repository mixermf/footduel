// Motion-capture позы (импорт scripts/convert-mocap.mjs). Клип хранит для каждой кости мировой поворот
// относительно T-позы в осях «Y вверх, персонаж смотрит на +Z» и нормированное положение таза.
import * as THREE from 'three';
import idle from '../../assets/mocap/idle.json';
import jogForward from '../../assets/mocap/jog-forward.json';
import jogBackward from '../../assets/mocap/jog-backward.json';
import jogLeft from '../../assets/mocap/jog-left.json';
import jogRight from '../../assets/mocap/jog-right.json';
import kick from '../../assets/mocap/kick.json';
import strikeJog from '../../assets/mocap/strike-jog.json';
import receive from '../../assets/mocap/receive.json';

// клипы набора «Mocap Pack 05 Soccer» (импорт scripts/convert-soccer-pack.mjs)
import packKickSide from '../../assets/mocap/pack-kick-side.json';
import packKickPower from '../../assets/mocap/pack-kick-power.json';
import packGuard from '../../assets/mocap/pack-guard.json';
import packJuggle from '../../assets/mocap/pack-juggle.json';
import packCelebrate from '../../assets/mocap/pack-celebrate.json';

// клипы сцены выхода перед матчем (Mixamo, импорт scripts/convert-intro.mjs): две походки и рукопожатие
import introWalk from '../../assets/mocap/intro-walk.json';
import introStrut from '../../assets/mocap/intro-strut.json';
import introShake from '../../assets/mocap/intro-shake.json';

export const CLIPS = { idle, jogForward, jogBackward, jogLeft, jogRight, kick, strikeJog, receive, packKickSide, packKickPower, packGuard, packJuggle, packCelebrate, introWalk, introStrut, introShake };
export const BONES = idle.bones;
const INDEX = Object.fromEntries(BONES.map((b, i) => [b, i]));
// зеркальная пара кости (для удара другой ногой)
const MIRROR = BONES.map((b) => INDEX[b.startsWith('Left') ? 'Right' + b.slice(4) : b.startsWith('Right') ? 'Left' + b.slice(5) : b]);

const _a = new THREE.Quaternion(), _b = new THREE.Quaternion();

// Верх тела для ходьбы: руки целиком, плечи и корпус частично. Ноги ставит IK, таз остаётся от клипа бега.
export const UPPER_BODY = Float32Array.from(BONES, (b) => (/Arm|Hand/.test(b) ? 1 : /Shoulder/.test(b) ? 0.7 : /Spine|Neck|Head/.test(b) ? 0.5 : b === 'Hips' ? 0.3 : 0));

// Накопитель смешивания: взвешенная сумма кватернионов с приведением к одной полусфере
export class PoseBlend {
  constructor() {
    this.q = BONES.map(() => new THREE.Quaternion());
    this.acc = new Float32Array(BONES.length * 4);
    this.hips = new THREE.Vector3();
    this.w = 0;
  }

  reset() { this.acc.fill(0); this.hips.set(0, 0, 0); this.w = 0; }

  // t — секунды; для зацикленных клипов время берётся по модулю. mirror — отразить слева направо.
  // mask — вес по костям (см. UPPER_BODY): клип добавляет только повороты, таз остаётся от основных клипов.
  add(clip, t, weight, mirror = false, mask = null) {
    if (weight <= 1e-4) return;
    const n = clip.frames, B = BONES.length;
    let f = t * clip.fps;
    let i0, i1, k;
    if (clip.loop) { f = ((f % n) + n) % n; i0 = Math.floor(f); i1 = (i0 + 1) % n; k = f - i0; }
    else { f = Math.max(0, Math.min(n - 1, f)); i0 = Math.floor(f); i1 = Math.min(n - 1, i0 + 1); k = f - i0; }
    const Q = clip.quats, acc = this.acc;
    for (let b = 0; b < B; b++) {
      const s = mirror ? MIRROR[b] : b, o0 = (i0 * B + s) * 4, o1 = (i1 * B + s) * 4;
      _a.set(Q[o0], Q[o0 + 1], Q[o0 + 2], Q[o0 + 3]); _b.set(Q[o1], Q[o1 + 1], Q[o1 + 2], Q[o1 + 3]);
      _a.slerp(_b, k);
      if (mirror) { _a.y = -_a.y; _a.z = -_a.z; }
      const o = b * 4, wb = mask ? weight * mask[b] : weight;
      if (wb <= 0) continue;
      const sign = acc[o] * _a.x + acc[o + 1] * _a.y + acc[o + 2] * _a.z + acc[o + 3] * _a.w < 0 ? -wb : wb;
      acc[o] += _a.x * sign; acc[o + 1] += _a.y * sign; acc[o + 2] += _a.z * sign; acc[o + 3] += _a.w * sign;
    }
    if (mask) return;
    const H = clip.hips, h0 = i0 * 3, h1 = i1 * 3;
    const hx = H[h0] + (H[h1] - H[h0]) * k, hy = H[h0 + 1] + (H[h1 + 1] - H[h0 + 1]) * k, hz = H[h0 + 2] + (H[h1 + 2] - H[h0 + 2]) * k;
    this.hips.x += (mirror ? -hx : hx) * weight; this.hips.y += hy * weight; this.hips.z += hz * weight;
    this.w += weight;
  }

  finish() {
    const acc = this.acc;
    for (let b = 0; b < BONES.length; b++) {
      const o = b * 4;
      this.q[b].set(acc[o], acc[o + 1], acc[o + 2], acc[o + 3]);
      if (this.q[b].lengthSq() < 1e-8) this.q[b].identity(); else this.q[b].normalize();
    }
    if (this.w > 1e-6) this.hips.multiplyScalar(1 / this.w); else this.hips.set(0, 1, 0);
    return this;
  }

  get(name) { return this.q[INDEX[name]]; }
}

// Голеностоп из клипа удара: положение относительно тазобедренного сустава в долях длины ноги, оси клипа.
// foot: 0 — левая, 1 — правая нога персонажа; mirror — клип отражён (бьёт другая нога).
export function clipFoot(clip, t, foot, mirror, out) {
  const n = clip.frames, f = Math.max(0, Math.min(n - 1, t * clip.fps)), i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1), k = f - i0;
  const s = (mirror ? 1 - foot : foot) * 3, o0 = i0 * 6 + s, o1 = i1 * 6 + s, F = clip.feet;
  out.set(F[o0] + (F[o1] - F[o0]) * k, F[o0 + 1] + (F[o1 + 1] - F[o0 + 1]) * k, F[o0 + 2] + (F[o1 + 2] - F[o0 + 2]) * k);
  if (mirror) out.x = -out.x;
  return out;
}

// Фаза клипа, в которой левая стопа встаёт на покрытие: симуляция считает фазу шага от постановки левой
export const strikePhase = (clip) => (clip.strikes && clip.strikes.L.length ? clip.strikes.L[0] : 0);
