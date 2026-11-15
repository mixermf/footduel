// Обзор набора FBX перед импортом: скелет первого файла и по каждому клипу — длительность, путь и скорость таза,
// высота таза, разворот, какая стопа быстрее всего летит вперёд и когда.
//   node scripts/inspect-fbx.mjs "<папка с FBX>" [--bones]
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const dir = process.argv[2], showBones = process.argv.includes('--bones');
// покадровый профиль одного клипа: node scripts/inspect-fbx.mjs "<папка>" --timeline <файл> [шаг, с] [от, с] [до, с]
const tlAt = process.argv.indexOf('--timeline');
if (tlAt > 0) {
  const file = process.argv[tlAt + 1], step = Number(process.argv[tlAt + 2] || 0.1), from = Number(process.argv[tlAt + 3] || 0), to = Number(process.argv[tlAt + 4] || 1e9);
  const buf = fs.readFileSync(path.join(dir, file));
  const warn = console.warn; console.warn = () => {};
  const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  console.warn = warn;
  const bones = []; obj.traverse((n) => { if (n.isBone) bones.push(n); });
  const find = (name) => bones.find((b) => b.name === name);
  const hips = find('Hips'), feet = [find('LeftFoot'), find('RightFoot')], hands = [find('LeftHand'), find('RightHand')], chest = find('Spine4');
  const clip = obj.animations[0], mixer = new THREE.AnimationMixer(obj); mixer.clipAction(clip).play();
  const fps = 60, v = new THREE.Vector3(), q = new THREE.Quaternion();
  const sample = (t) => {
    mixer.setTime(Math.min(clip.duration, Math.max(0, t))); obj.updateMatrixWorld(true);
    hips.getWorldQuaternion(q); const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q); const yaw = Math.atan2(f.x, f.z);
    return { h: hips.getWorldPosition(new THREE.Vector3()), yaw, f: feet.map((b) => b.getWorldPosition(new THREE.Vector3())), hd: hands.map((b) => b.getWorldPosition(new THREE.Vector3())),
      lean: new THREE.Vector3(0, 1, 0).applyQuaternion(chest.getWorldQuaternion(new THREE.Quaternion())) };
  };
  const p = (x, w = 6) => String(Math.round(x * 100) / 100).padStart(w);
  console.log(file, 'длительность', r2s(clip.duration));
  console.log('     t   hipY  vFwd  vSide   yaw°   Ly    Ry   Lfwd  Rfwd   vL    vR  handsY  lean°');
  for (let t = from; t <= Math.min(to, clip.duration) + 1e-6; t += step) {
    const a = sample(t - 0.5 / fps), b = sample(t + 0.5 / fps);
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), dx = (b.h.x - a.h.x) * fps / 100, dz = (b.h.z - a.h.z) * fps / 100;
    const rel = (k) => ((b.f[k].x - b.h.x) * fx + (b.f[k].z - b.h.z) * fz) / 100;
    console.log(p(t), p(b.h.y / 94), p(dx * fx + dz * fz), p(dx * fz - dz * fx), p(b.yaw * 180 / Math.PI, 7), p(b.f[0].y / 100, 5), p(b.f[1].y / 100, 5), p(rel(0)), p(rel(1)),
      p(b.f[0].distanceTo(a.f[0]) * fps / 100, 5), p(b.f[1].distanceTo(a.f[1]) * fps / 100, 5), p(Math.max(b.hd[0].y, b.hd[1].y) / 100, 6), p(Math.acos(Math.min(1, b.lean.y)) * 180 / Math.PI, 6));
  }
  process.exit(0);
}
function r2s(v) { return Math.round(v * 100) / 100; }
const files = fs.readdirSync(dir).filter((f) => /\.fbx$/i.test(f)).sort();
const r2 = (v) => Math.round(v * 100) / 100;
const rows = [];
files.forEach((file, fi) => {
  const buf = fs.readFileSync(path.join(dir, file));
  const warn = console.warn; console.warn = () => {};
  const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  console.warn = warn;
  const bones = []; obj.traverse((n) => { if (n.isBone) bones.push(n); });
  obj.updateMatrixWorld(true);
  const byName = Object.fromEntries(bones.map((b) => [b.name, b]));
  if (fi === 0 && showBones) {
    console.log('кости (' + bones.length + '), мировые положения в позе покоя:');
    for (const b of bones) { const p = b.getWorldPosition(new THREE.Vector3()); console.log(' ', b.name.padEnd(22), 'родитель', (b.parent?.name || '').padEnd(18), [r2(p.x), r2(p.y), r2(p.z)].join(', ')); }
    console.log('анимации:', obj.animations.map((a) => `${a.name} ${r2(a.duration)}с, дорожек ${a.tracks.length}`).join('; '));
    console.log('дорожки:', obj.animations[0].tracks.slice(0, 6).map((t) => `${t.name} [${t.times.length}]`).join(' | '));
  }
  const find = (re) => bones.find((b) => re.test(b.name));
  const hips = find(/hips|pelvis/i), lf = find(/left.*foot|foot.*_l$/i), rf = find(/right.*foot|foot.*_r$/i);
  const H = hips.getWorldPosition(new THREE.Vector3()).y;
  const clip = obj.animations.reduce((a, b) => (b.duration > a.duration ? b : a));
  const mixer = new THREE.AnimationMixer(obj); mixer.clipAction(clip).play();
  const fps = 30, n = Math.round(clip.duration * fps) + 1, v = new THREE.Vector3(), q = new THREE.Quaternion();
  const hp = [], yaw = [], fz = [[], []];
  for (let i = 0; i < n; i++) {
    mixer.setTime(Math.min(clip.duration, i / fps)); obj.updateMatrixWorld(true);
    hips.getWorldPosition(v); hp.push(v.clone());
    hips.getWorldQuaternion(q); const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q); yaw.push(Math.atan2(f.x, f.z));
    [lf, rf].forEach((b, k) => { b.getWorldPosition(v); fz[k].push(v.clone()); });
  }
  let pathLen = 0, vmax = 0, best = 0, bestAt = 0, bestFoot = '';
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(hp[i].x - hp[i - 1].x, hp[i].z - hp[i - 1].z); pathLen += d; vmax = Math.max(vmax, d * fps);
    for (const k of [0, 1]) { const s = fz[k][i].distanceTo(fz[k][i - 1]) * fps; if (s > best) { best = s; bestAt = i / fps; bestFoot = k ? 'R' : 'L'; } }
  }
  const ys = hp.map((p) => p.y / H);
  rows.push({ file, sec: r2(clip.duration), tracks: clip.tracks.length, hipRest: r2(H), net: r2(Math.hypot(hp[n - 1].x - hp[0].x, hp[n - 1].z - hp[0].z) / H), path: r2(pathLen / H),
    vAvg: r2(pathLen / H / clip.duration), vMax: r2(vmax / H), hipY: r2(Math.min(...ys)) + '..' + r2(Math.max(...ys)), yaw0: r2(yaw[0]), yawEnd: r2(yaw[n - 1]),
    footMax: r2(best / H), at: r2(bestAt), foot: bestFoot });
});
console.table(rows);
