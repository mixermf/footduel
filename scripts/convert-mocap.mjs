// Воспроизводимый импорт motion-capture клипов Mixamo (FBX пользователя) в компактные позы для рига.
// Исходные FBX в репозиторий не кладутся: путь к распакованному набору передаётся аргументом.
//
//   node scripts/convert-mocap.mjs "<папка с FBX из Soccer Game Pack>" "<путь к Dribble.fbx>"
//
// Формат клипа: для каждой кости — мировой поворот относительно T-позы (D = Q(t) * Q(T)^-1) в осях
// «Y вверх, персонаж смотрит на +Z». Риг применяет его к своей T-позе: Q = Qyaw * D * Qrest.
// Скелет исходников и player.glb один и тот же (Mixamo, 67 костей), поэтому перенос точный.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const packDir = process.argv[2], dribblePath = process.argv[3];
if (!packDir) { console.error('usage: node scripts/convert-mocap.mjs <pack dir> [Dribble.fbx]'); process.exit(1); }
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'mocap');
fs.mkdirSync(outDir, { recursive: true });

export const BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
const FPS = 30;

// имя результата, файл, зацикленный ли клип
const CLIPS = [
  ['idle', 'offensive idle.fbx', true],
  ['jog-forward', 'jog forward.fbx', true],
  ['jog-backward', 'jog backward.fbx', true],
  ['jog-left', 'jog strafe left.fbx', true],
  ['jog-right', 'jog strafe right.fbx', true],
  ['dribble', dribblePath, true],
  ['kick', 'kick soccerball.fbx', false],
  ['strike-jog', 'strike foward jog.fbx', false],
  ['receive', 'receive soccerball.fbx', false],
  ['knee', 'kneeing soccerball.fbx', false],
  ['header', 'header soccerball.fbx', false],
];

const r4 = (v) => Math.round(v * 10000) / 10000;
const report = [];
for (const [name, file, loop] of CLIPS) {
  if (!file) { console.warn('пропуск', name, '(нет файла)'); continue; }
  const full = path.isAbsolute(file) ? file : path.join(packDir, file);
  const buf = fs.readFileSync(full);
  const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const bones = {};
  obj.traverse((n) => { if (n.isBone) bones[n.name.replace(/^mixamorig:?/, '')] = n; });
  obj.updateMatrixWorld(true);
  const restInv = {}, q = new THREE.Quaternion(), v = new THREE.Vector3();
  for (const b of BONES) restInv[b] = bones[b].getWorldQuaternion(new THREE.Quaternion()).invert();
  const H = bones.Hips.getWorldPosition(new THREE.Vector3()).y; // высота таза в T-позе, единицы исходника
  const clip = obj.animations[0];
  const mixer = new THREE.AnimationMixer(obj);
  mixer.clipAction(clip).play();
  const frames = Math.max(2, Math.round(clip.duration * FPS) + (loop ? 0 : 1));
  const quats = [], hips = [], feet = [];
  for (let i = 0; i < frames; i++) {
    mixer.setTime(Math.min(clip.duration, i / FPS));
    obj.updateMatrixWorld(true);
    for (const b of BONES) { bones[b].getWorldQuaternion(q).multiply(restInv[b]); quats.push(r4(q.x), r4(q.y), r4(q.z), r4(q.w)); }
    bones.Hips.getWorldPosition(v); hips.push(v.x / H, v.y / H, v.z / H);
    const row = [];
    for (const side of ['Left', 'Right']) {
      bones[side + 'Foot'].getWorldPosition(v); row.push(v.x / H, v.y / H, v.z / H);
      bones[side + 'ToeBase'].getWorldPosition(v); row.push(v.y / H);
    }
    feet.push(row);
  }
  // горизонтальный ход таза: у зацикленных клипов убирается линейный снос, остаётся естественное покачивание
  const n = frames, x0 = hips[0], z0 = hips[2], x1 = hips[(n - 1) * 3], z1 = hips[(n - 1) * 3 + 2];
  const travel = Math.hypot(x1 - x0, z1 - z0);
  for (let i = 0; i < n; i++) {
    const k = loop ? i / (n - 1) : 0;
    hips[i * 3] = r4(hips[i * 3] - x0 - (x1 - x0) * k); hips[i * 3 + 2] = r4(hips[i * 3 + 2] - z0 - (z1 - z0) * k);
    hips[i * 3 + 1] = r4(hips[i * 3 + 1]);
  }
  // постановки стоп (минимум высоты носка после маха) — для синхронизации с фазой шага симуляции
  const strikes = { L: [], R: [] };
  ['L', 'R'].forEach((s, si) => {
    const ty = feet.map((r) => r[si * 4 + 3]), lo = Math.min(...ty), hi = Math.max(...ty), thr = lo + (hi - lo) * 0.25;
    for (let i = 0; i < n; i++) { const prev = ty[(i - 1 + n) % n]; if (prev > thr && ty[i] <= thr && (loop || i > 0)) strikes[s].push(r4(i / n)); }
  });
  // профиль маха левой стопы (для настройки траектории в симуляции): высота голеностопа и продвижение вперёд
  const ay = feet.map((r) => r[1]), az = feet.map((r) => r[2] - 0), ayMin = Math.min(...ay);
  // ударные клипы: бьющая нога — та, чья стопа летит вперёд быстрее всего; контакт — кадр наибольшей скорости
  let contact = 0, kickFoot = 'R', best = 0;
  if (!loop) {
    for (let i = 1; i < n; i++) for (const [si, s] of [[0, 'L'], [1, 'R']]) {
      const sp = (feet[i][si * 4 + 2] - feet[i - 1][si * 4 + 2]) * FPS;
      if (sp > best) { best = sp; contact = i / FPS; kickFoot = s; }
    }
  }
  const data = { name, fps: FPS, frames, duration: r4(clip.duration), loop, bones: BONES, strikes, contact: r4(contact), kickFoot, quats, hips };
  fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify(data));
  report.push({ name, file: path.basename(full), sec: r4(clip.duration), frames, hipTravel: r4(travel), hipY: [r4(Math.min(...hips.filter((_, i) => i % 3 === 1))), r4(Math.max(...hips.filter((_, i) => i % 3 === 1)))],
    contact: r4(contact), kickFoot, strikes, ankleLift: r4(Math.max(...ay) - ayMin), ankleZ: [r4(Math.min(...az)), r4(Math.max(...az))], kb: Math.round(JSON.stringify(data).length / 1024) });
}
console.table(report.map((r) => ({ ...r, strikes: JSON.stringify(r.strikes), hipY: r.hipY.join('..'), ankleZ: r.ankleZ.join('..') })));
fs.writeFileSync(path.join(outDir, 'import-report.json'), JSON.stringify(report, null, 1));
