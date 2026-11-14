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

export const CLIPS = { idle, jogForward, jogBackward, jogLeft, jogRight, kick, strikeJog, receive };
export const BONES = idle.bones;
const INDEX = Object.fromEntries(BONES.map((b, i) => [b, i]));
// зеркальная пара кости (для удара другой ногой)
const MIRROR = BONES.map((b) => INDEX[b.startsWith('Left') ? 'Right' + b.slice(4) : b.startsWith('Right') ? 'Left' + b.slice(5) : b]);

const _a = new THREE.Quaternion(), _b = new THREE.Quaternion();

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
  add(clip, t, weight, mirror = false) {
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
      const o = b * 4;
      const sign = acc[o] * _a.x + acc[o + 1] * _a.y + acc[o + 2] * _a.z + acc[o + 3] * _a.w < 0 ? -weight : weight;
      acc[o] += _a.x * sign; acc[o + 1] += _a.y * sign; acc[o + 2] += _a.z * sign; acc[o + 3] += _a.w * sign;
    }
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

// Фаза клипа, в которой левая стопа встаёт на покрытие: симуляция считает фазу шага от постановки левой
export const strikePhase = (clip) => (clip.strikes && clip.strikes.L.length ? clip.strikes.L[0] : 0);
