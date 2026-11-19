// Импорт клипа Mixamo «Getting Up» (подъём из положения сидя на земле с опорой на руки) в формат scripts/convert-mocap.mjs.
// Исходный FBX в репозиторий не кладётся: путь передаётся аргументом.
//
//   node scripts/convert-getup.mjs "<Getting Up.fbx>" [--from <с>] [--to <с>]
//
// --from / --to задают кусок подъёма вручную (иначе — по движению стоп и таза, см. rise ниже). В игре кусок взят
// 0,15–1,6 с: в первые 0,15 с клип почти неподвижен, после 1,6 с игрок только выпрямляется — это доигрывает переход
// в обычную стойку, и подъём укладывается в 1 с без сильного ускорения клипа.
//
// Кроме обычных полей клип хранит:
//   feet  — по кадрам [Lx, Ly, Lz, Rx, Ry, Rz]: голеностопы в высотах таза, x/z — от таза первого кадра (как hips);
//   rise  — { from, to }: с какой секунды клипа стопы начинают двигаться и к какой игрок уже стоит (таз выше 0,93 и не
//           движется) — по ним игра берёт кусок клипа для подъёма;
//   seat  — поза старта: высота таза и наклон корпуса назад (рад) в кадре from.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { BONES } from './convert-mocap-bones.mjs';

const file = process.argv[2], arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : null; };
if (!file) { console.error('usage: node scripts/convert-getup.mjs <Getting Up.fbx>'); process.exit(1); }
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'mocap');
const FPS = 30, r4 = (v) => Math.round(v * 10000) / 10000;

const buf = fs.readFileSync(file);
const warn = console.warn; console.warn = () => {};
const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
console.warn = warn;
const bones = {};
obj.traverse((n) => { if (n.isBone) bones[n.name.replace(/^mixamorig:?/, '')] = n; });
for (const b of BONES) if (!bones[b]) throw new Error('в клипе нет кости ' + b);
obj.updateMatrixWorld(true);
const restInv = {}, q = new THREE.Quaternion(), v = new THREE.Vector3(), hp = new THREE.Vector3(), nk = new THREE.Vector3();
for (const b of BONES) restInv[b] = bones[b].getWorldQuaternion(new THREE.Quaternion()).invert();
const H = bones.Hips.getWorldPosition(new THREE.Vector3()).y;
const clip = obj.animations[0];
const mixer = new THREE.AnimationMixer(obj);
mixer.clipAction(clip).play();
const frames = Math.round(clip.duration * FPS) + 1;
const quats = [], hips = [], feet = [], lean = [];
for (let i = 0; i < frames; i++) {
  mixer.setTime(Math.min(clip.duration, i / FPS));
  obj.updateMatrixWorld(true);
  for (const b of BONES) { bones[b].getWorldQuaternion(q).multiply(restInv[b]); quats.push(r4(q.x), r4(q.y), r4(q.z), r4(q.w)); }
  bones.Hips.getWorldPosition(hp); hips.push(hp.x / H, hp.y / H, hp.z / H);
  const row = [];
  for (const side of ['Left', 'Right']) { bones[side + 'Foot'].getWorldPosition(v); row.push(v.x / H, v.y / H, v.z / H); }
  feet.push(row);
  bones.Neck.getWorldPosition(nk); nk.sub(hp).normalize(); lean.push(Math.atan2(-nk.z, nk.y)); // > 0 — корпус откинут назад
}
const x0 = hips[0], z0 = hips[2];
for (let i = 0; i < frames; i++) {
  hips[i * 3] = r4(hips[i * 3] - x0); hips[i * 3 + 1] = r4(hips[i * 3 + 1]); hips[i * 3 + 2] = r4(hips[i * 3 + 2] - z0);
  const f = feet[i]; for (const k of [0, 3]) { f[k] = r4(f[k] - x0); f[k + 1] = r4(f[k + 1]); f[k + 2] = r4(f[k + 2] - z0); }
}
// начало подъёма — первая стопа сдвинулась больше чем на 2 % высоты таза; конец — таз выше 0,93 и за 0,1 с сдвинулся меньше 0,5 %
const moved = (i) => [0, 3].some((k) => Math.hypot(feet[i][k] - feet[0][k], feet[i][k + 2] - feet[0][k + 2]) > 0.02);
let from = 0; while (from < frames - 1 && !moved(from)) from++;
from = Math.max(0, from - 2);
let to = from; while (to < frames - 4 && !(hips[to * 3 + 1] > 0.93 && Math.abs(hips[(to + 3) * 3 + 1] - hips[to * 3 + 1]) < 0.005)) to++;
if (arg('--from') !== null) from = Math.round(arg('--from') * FPS);
if (arg('--to') !== null) to = Math.round(arg('--to') * FPS);
const data = { name: 'getup', fps: FPS, frames, duration: r4(clip.duration), loop: false, bones: BONES, strikes: { L: [], R: [] }, contact: 0, kickFoot: 'R',
  quats, hips, feet: feet.flat(), rise: { from: r4(from / FPS), to: r4(to / FPS) }, seat: { hipY: hips[from * 3 + 1], lean: r4(lean[from]) } };
fs.writeFileSync(path.join(outDir, 'getup.json'), JSON.stringify(data));
const row = (i) => ({ t: r4(i / FPS), hipY: hips[i * 3 + 1], hipX: hips[i * 3], hipZ: hips[i * 3 + 2], lean: Math.round(lean[i] * 57.3),
  L: feet[i].slice(0, 3).join(' '), R: feet[i].slice(3).join(' ') });
console.table([0, from, ...[0.3, 0.5, 0.7, 0.9, 1.1, 1.3, 1.5].map((t) => Math.round(t * FPS)), to, frames - 1].map(row));
console.log('rise', data.rise, 'seat', data.seat, 'kb', Math.round(JSON.stringify(data).length / 1024));
// таблица для симуляции (src/sim/profile.js, fall.getup): каждые 0,1 с куска подъёма — таз и голеностопы в высотах таза,
// [вперёд, вправо] от таза первого кадра: [hipF, hipR, LF, LR, RF, RR]
const tab = [];
for (let t = from / FPS; t <= to / FPS + 1e-6; t += 0.1) {
  const i = Math.min(frames - 1, Math.round(t * FPS)), f = feet[i], k = (x) => Math.round(x * 100) / 100;
  tab.push([k(hips[i * 3 + 2]), k(-hips[i * 3]), k(f[2]), k(-f[0]), k(f[5]), k(-f[3])]);
}
const i = to, f = feet[i], k = (x) => Math.round(x * 100) / 100;
tab.push([k(hips[i * 3 + 2]), k(-hips[i * 3]), k(f[2]), k(-f[0]), k(f[5]), k(-f[3])]);
console.log('sim table (step 0.1 s, last row = end):', JSON.stringify(tab));
