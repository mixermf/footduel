// Импорт клипов Mixamo для сцены выхода перед матчем (ходьба и рукопожатие) в тот же формат, что scripts/convert-mocap.mjs.
// Исходные FBX в репозиторий не кладутся: пути передаются аргументами.
//
//   node scripts/convert-intro.mjs "<Walking.fbx>" "<Strut Walking.fbx>" "<Shaking Hands 2.fbx>"
//
// Дополнительно к обычным полям клип получает:
//   speed — собственная скорость ходьбы, в высотах таза в секунду: по ней сцена двигает игрока, чтобы стопы не скользили
//           (берётся по сносу таза; у клипа «на месте» — по скорости опорной стопы относительно таза);
//   hand  — у рукопожатия: кадр, в котором правая кисть вынесена вперёд дальше всего, и окно, пока она держится впереди.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { BONES } from './convert-mocap-bones.mjs';

const [walkPath, strutPath, shakePath] = process.argv.slice(2);
if (!walkPath || !strutPath || !shakePath) { console.error('usage: node scripts/convert-intro.mjs <Walking.fbx> <Strut Walking.fbx> <Shaking Hands 2.fbx>'); process.exit(1); }
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'mocap');
const FPS = 30, r4 = (v) => Math.round(v * 10000) / 10000;
const CLIPS = [['intro-walk', walkPath, true], ['intro-strut', strutPath, true], ['intro-shake', shakePath, false]];

const report = [];
for (const [name, file, loop] of CLIPS) {
  const buf = fs.readFileSync(file);
  const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const bones = {};
  obj.traverse((n) => { if (n.isBone) bones[n.name.replace(/^mixamorig:?/, '')] = n; });
  for (const b of BONES) if (!bones[b]) throw new Error(name + ': в клипе нет кости ' + b);
  obj.updateMatrixWorld(true);
  const restInv = {}, q = new THREE.Quaternion(), v = new THREE.Vector3(), hp = new THREE.Vector3();
  for (const b of BONES) restInv[b] = bones[b].getWorldQuaternion(new THREE.Quaternion()).invert();
  const H = bones.Hips.getWorldPosition(new THREE.Vector3()).y; // высота таза в T-позе, единицы исходника
  const clip = obj.animations[0];
  const mixer = new THREE.AnimationMixer(obj);
  mixer.clipAction(clip).play();
  const frames = Math.max(2, Math.round(clip.duration * FPS) + (loop ? 0 : 1));
  const quats = [], hips = [], feet = [], hand = [];
  for (let i = 0; i < frames; i++) {
    mixer.setTime(Math.min(clip.duration, i / FPS));
    obj.updateMatrixWorld(true);
    for (const b of BONES) { bones[b].getWorldQuaternion(q).multiply(restInv[b]); quats.push(r4(q.x), r4(q.y), r4(q.z), r4(q.w)); }
    bones.Hips.getWorldPosition(hp); hips.push(hp.x / H, hp.y / H, hp.z / H);
    const row = [];
    for (const side of ['Left', 'Right']) { bones[side + 'Foot'].getWorldPosition(v); row.push((v.x - hp.x) / H, v.y / H, (v.z - hp.z) / H); }
    for (const side of ['Left', 'Right']) { bones[side + 'ToeBase'].getWorldPosition(v); row.push(v.y / H); } // [6], [7] — высота носков
    feet.push(row);
    bones.RightHand.getWorldPosition(v); hand.push([(v.x - hp.x) / H, v.y / H, (v.z - hp.z) / H]);
  }
  const n = frames, x0 = hips[0], z0 = hips[2], x1 = hips[(n - 1) * 3], z1 = hips[(n - 1) * 3 + 2];
  const travel = Math.hypot(x1 - x0, z1 - z0);
  // скорость по опорной стопе: у стопы, которая ниже, скорость назад относительно таза — это скорость ходьбы
  // (только кадры, где стопа стоит всей подошвой: и голеностоп, и носок у нижней точки — пока стопа перекатывается через
  // носок, голеностоп идёт вперёд вместе с телом и занижает скорость; медиана — без кадров постановки и отрыва)
  const ds = [];
  for (const k of [0, 3]) {
    const ys = feet.map((r) => r[k + 1]), lo = Math.min(...ys), hi = Math.max(...ys), ts = feet.map((r) => r[6 + k / 3]), tl = Math.min(...ts), th = Math.max(...ts);
    const flat = (i) => ys[i] < lo + (hi - lo) * 0.06 && ts[i] < tl + (th - tl) * 0.12;
    for (let i = 1; i < n; i++) if (flat(i) && flat(i - 1)) { const d = -(feet[i][k + 2] - feet[i - 1][k + 2]) * FPS; if (d > 0) ds.push(d); }
  }
  ds.sort((x, y) => x - y);
  const stance = ds.length ? ds[ds.length >> 1] : 0, drift = loop ? travel / ((n - 1) / FPS) : 0;
  for (let i = 0; i < n; i++) {
    const k = loop ? i / (n - 1) : 0;
    hips[i * 3] = r4(hips[i * 3] - x0 - (x1 - x0) * k); hips[i * 3 + 2] = r4(hips[i * 3 + 2] - z0 - (z1 - z0) * k);
    hips[i * 3 + 1] = r4(hips[i * 3 + 1]);
  }
  const strikes = { L: [], R: [] };
  ['L', 'R'].forEach((s, si) => {
    const ty = feet.map((r) => r[si * 3 + 1]), lo = Math.min(...ty), hi = Math.max(...ty), thr = lo + (hi - lo) * 0.25;
    for (let i = 0; i < n; i++) { const prev = ty[(i - 1 + n) % n]; if (prev > thr && ty[i] <= thr && (loop || i > 0)) strikes[s].push(r4(i / n)); }
  });
  const data = { name, fps: FPS, frames, duration: r4(clip.duration), loop, bones: BONES, strikes, contact: 0, kickFoot: 'R', quats, hips };
  if (loop) data.speed = r4(drift > 0.2 ? drift : stance);
  let handInfo = null;
  if (!loop) {
    // рукопожатие: кисть впереди таза; пик выноса и окно, пока вынос не меньше 85 % пика
    const fz = hand.map((h) => h[2]), mx = Math.max(...fz), pk = fz.indexOf(mx), thr = fz[0] + (mx - fz[0]) * 0.85;
    let a = pk, b = pk; while (a > 0 && fz[a - 1] >= thr) a--; while (b < n - 1 && fz[b + 1] >= thr) b++;
    handInfo = data.hand = { peak: r4(pk / FPS), from: r4(a / FPS), to: r4(b / FPS), fwd: r4(mx), y: r4(hand[pk][1]), side: r4(hand[pk][0]) };
  }
  fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify(data));
  report.push({ name, file: path.basename(file), sec: r4(clip.duration), frames, hipTravel: r4(travel), driftPerSec: r4(drift), stancePerSec: r4(stance), speed: data.speed ?? '-',
    hipY: r4(Math.min(...hips.filter((_, i) => i % 3 === 1))) + '..' + r4(Math.max(...hips.filter((_, i) => i % 3 === 1))), strikes: JSON.stringify(strikes), hand: handInfo ? JSON.stringify(handInfo) : '-', kb: Math.round(JSON.stringify(data).length / 1024) });
}
console.table(report);
fs.writeFileSync(path.join(outDir, 'import-report-intro.json'), JSON.stringify(report, null, 1));
