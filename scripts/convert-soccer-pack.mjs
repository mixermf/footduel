// Импорт клипов из набора «Mocap Pack 05 Soccer» (скелет Rokoko, папка mocap/Rokoko_Default) в формат assets/mocap.
// Исходные FBX в репозиторий не кладутся: путь к распакованной папке передаётся аргументом.
//
//   node scripts/convert-soccer-pack.mjs "<папка Rokoko_Default>"
//
// Формат тот же, что у convert-mocap.mjs: мировой поворот кости относительно T-позы в осях «Y вверх, взгляд на +Z».
// Скелет Rokoko стоит в такой же T-позе, что и Mixamo (руки по X, ноги вниз), поэтому поворот переносится по именам
// костей без пересчёта осей; у Rokoko четыре звена позвоночника — грудь берётся с верхнего (Spine4).
// Отличия от Mixamo-клипов: первый и последний кадры набора — T-поза, поэтому из дубля вырезается окно;
// актёр в окне может стоять под углом — клип доворачивается так, чтобы опорное направление смотрело на +Z;
// ход таза по горизонтали отбрасывается (положением игрока владеет симуляция), остаётся высота.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const packDir = process.argv[2];
if (!packDir) { console.error('usage: node scripts/convert-soccer-pack.mjs <Rokoko_Default dir>'); process.exit(1); }
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'mocap');

const BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
const SRC = { Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Spine4', LeftUpLeg: 'LeftThigh', LeftLeg: 'LeftShin', RightUpLeg: 'RightThigh', RightLeg: 'RightShin' };
const FPS = 30;

// имя, файл, окно [от, до] в секундах, зацикливание (сек. сшивки конца с началом) или удар (нога)
const CLIPS = [
  { name: 'pack-kick-side', file: '08_Side_Foot_Kick.fbx', from: 0.55, to: 2.0, kick: 'R' },
  { name: 'pack-kick-power', file: '09_Power_Kick.fbx', from: 1.5, to: 3.15, kick: 'L' },
  { name: 'pack-guard', file: '18_Defending_01.fbx', from: 0.5, to: 4.4, loop: 0.4 },
  { name: 'pack-juggle', file: '04_Juggling_01.fbx', from: 1.6, to: 12.0, loop: 0.5 },
  { name: 'pack-celebrate', file: '13_Goal_Celebration_02.fbx', from: 0.2, to: 3.3 },
];

const r4 = (v) => Math.round(v * 10000) / 10000;
const UP = new THREE.Vector3(0, 1, 0);
const report = [];
for (const c of CLIPS) {
  const buf = fs.readFileSync(path.join(packDir, c.file));
  const warn = console.warn; console.warn = () => {};
  const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  console.warn = warn;
  // в файле у каждой кости есть одноимённый вложенный узел; дорожки анимации привязаны к внешнему — он встречается первым
  const all = {}; obj.traverse((n) => { if (n.isBone && !all[n.name]) all[n.name] = n; });
  const bones = Object.fromEntries(BONES.map((b) => [b, all[SRC[b] || b]]));
  for (const b of BONES) if (!bones[b]) throw new Error(c.file + ': нет кости ' + (SRC[b] || b));
  obj.updateMatrixWorld(true);
  const restInv = {}, q = new THREE.Quaternion(), v = new THREE.Vector3(), v0 = new THREE.Vector3();
  for (const b of BONES) restInv[b] = bones[b].getWorldQuaternion(new THREE.Quaternion()).invert();
  const H = bones.Hips.getWorldPosition(new THREE.Vector3()).y;
  const clip = obj.animations[0];
  const mixer = new THREE.AnimationMixer(obj); mixer.clipAction(clip).play();
  const set = (t) => { mixer.setTime(Math.min(clip.duration, Math.max(0, t))); obj.updateMatrixWorld(true); };
  const hipYaw = () => { bones.Hips.getWorldQuaternion(q); v.set(0, 0, 1).applyQuaternion(q); return Math.atan2(v.x, v.z); };
  const frames = Math.round((c.to - c.from) * FPS) + 1;

  // удар: контакт — кадр наибольшей скорости бьющей стопы; опорное направление — куда она в этот момент летит
  let contact = 0, refYaw = 0, peak = 0;
  if (c.kick) {
    const foot = bones[(c.kick === 'L' ? 'Left' : 'Right') + 'Foot'];
    for (let t = c.from; t <= c.to; t += 1 / 120) {
      set(t - 1 / 240); foot.getWorldPosition(v0); set(t + 1 / 240); foot.getWorldPosition(v);
      const sp = Math.hypot(v.x - v0.x, v.z - v0.z) * 120;
      if (sp > peak) { peak = sp; contact = t - c.from; refYaw = Math.atan2(v.x - v0.x, v.z - v0.z); }
    }
  } else {
    // стойка, чеканка, празднование: опорное направление — средний разворот таза за окно
    let sx = 0, sz = 0;
    for (let i = 0; i < frames; i++) { set(c.from + i / FPS); const y = hipYaw(); sx += Math.sin(y); sz += Math.cos(y); }
    refYaw = Math.atan2(sx, sz);
  }
  const unYaw = new THREE.Quaternion().setFromAxisAngle(UP, -refYaw);

  // удары: траектория голеностопов относительно тазобедренного сустава своей ноги, в долях длины ноги —
  // по ней риг ведёт бьющую ногу; у персонажа игры ноги другой длины, доли переносятся без растяжения
  const legLen = (side) => all[side + 'Shin'].getWorldPosition(new THREE.Vector3()).distanceTo(all[side + 'Thigh'].getWorldPosition(new THREE.Vector3()))
    + all[side + 'Foot'].getWorldPosition(new THREE.Vector3()).distanceTo(all[side + 'Shin'].getWorldPosition(new THREE.Vector3()));
  const LL = { Left: legLen('Left'), Right: legLen('Right') };
  const quats = [], hips = [], feet = [];
  for (let i = 0; i < frames; i++) {
    set(c.from + i / FPS);
    for (const b of BONES) { bones[b].getWorldQuaternion(q).multiply(restInv[b]).premultiply(unYaw); quats.push(q.x, q.y, q.z, q.w); }
    bones.Hips.getWorldPosition(v); hips.push(0, r4(v.y / H), 0);
    if (c.kick) for (const side of ['Left', 'Right']) {
      bones[side + 'Foot'].getWorldPosition(v).sub(bones[side + 'UpLeg'].getWorldPosition(v0)).applyQuaternion(unYaw).multiplyScalar(1 / LL[side]);
      feet.push(r4(v.x), r4(v.y), r4(v.z));
    }
  }
  // зацикливание: последние кадры плавно подводятся к началу окна, чтобы на стыке не было рывка
  if (c.loop) {
    const nb = Math.round(c.loop * FPS), B = BONES.length, a = new THREE.Quaternion(), b = new THREE.Quaternion();
    for (let k = 0; k < nb; k++) {
      const i = frames - nb + k, w = (k + 1) / (nb + 1), s = w * w * (3 - 2 * w);
      for (let j = 0; j < B; j++) {
        const o = (i * B + j) * 4, o0 = j * 4;
        a.set(quats[o], quats[o + 1], quats[o + 2], quats[o + 3]); b.set(quats[o0], quats[o0 + 1], quats[o0 + 2], quats[o0 + 3]);
        a.slerp(b, s); quats[o] = a.x; quats[o + 1] = a.y; quats[o + 2] = a.z; quats[o + 3] = a.w;
      }
      hips[i * 3 + 1] = r4(hips[i * 3 + 1] + (hips[1] - hips[i * 3 + 1]) * s);
    }
  }
  const ys = hips.filter((_, i) => i % 3 === 1);
  const data = { name: c.name, fps: FPS, frames, duration: r4((frames - (c.loop ? 0 : 1)) / FPS), loop: !!c.loop, bones: BONES, strikes: { L: [], R: [] },
    contact: r4(contact), kickFoot: c.kick || 'R', quats: quats.map(r4), hips, source: `${c.file} ${c.from}–${c.to} с` };
  if (c.kick) data.feet = feet;
  fs.writeFileSync(path.join(outDir, c.name + '.json'), JSON.stringify(data));
  report.push({ name: c.name, source: data.source, frames, sec: data.duration, loop: data.loop, contact: data.contact, kickFoot: c.kick || '', footPeak: r4(peak / 100),
    refYawDeg: Math.round(refYaw * 180 / Math.PI), hipY: r4(Math.min(...ys)) + '..' + r4(Math.max(...ys)), kb: Math.round(JSON.stringify(data).length / 1024) });
}
console.table(report);
fs.writeFileSync(path.join(outDir, 'import-report-pack.json'), JSON.stringify(report, null, 1));
