// Процедурная поза футболиста поверх скелета player.glb (клипов в модели нет).
// Симуляция задаёт положения стоп и корпуса; риг только показывает их: IK ног, наклон, руки, голова.
// Кости ставятся в мировых осях: Q = B(желаемый) * B(покой)^-1 * Q(покой) — без догадок о локальных осях Mixamo.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import modelUrl from '../../assets/player/player.glb?url';
import { CLIPS, PoseBlend, strikePhase, UPPER_BODY, clipFoot, BONES } from './mocap.js';

// порядок костей для полного клипа: родители раньше детей
const CLIP_ORDER = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
const BONE_SET = new Set(BONES);

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion(), _qI = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _x = new THREE.Vector3(), _z = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

function basisQuat(dir, axis, out) {
  _x.copy(axis).addScaledVector(dir, -axis.dot(dir));
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0).addScaledVector(dir, -dir.x);
  _x.normalize();
  _z.crossVectors(_x, dir);
  _m.makeBasis(_x, dir, _z);
  return out.setFromRotationMatrix(_m);
}

function setWorldQuat(bone, q) {
  bone.parent.getWorldQuaternion(_q3);
  bone.quaternion.copy(_q3.invert().multiply(q));
}

// Опорные позы удара по высоте контакта: h — центр мяча над опорой игрока в момент удара, м.
// Высоту заранее сообщает план удара из симуляции, поза набирается до того, как нога пошла к мячу.
//   back — наклон корпуса назад, рад (< 0 — вперёд, над мячом); side — наклон от бьющей ноги, рад;
//   open — раскрытие корпуса к бьющей ноге перед ударом, рад; drop — приседание на опорной ноге, м;
//   kneeUp, kneeOut — куда смотрит колено бьющей ноги (вверх, наружу); along — стопа продолжает линию голени (0..1);
//   arms — разведение рук для баланса, рад; high — доля «удара с лёта» для размаха рук и корпуса.
// Значения — оценка по прежней процедурной позе; заменяются числами из раскадровки видеореференсов.
export const KICK_POSES = [
  { h: 0.11, back: -0.04, side: 0.05, open: 0.22, drop: 0.035, kneeUp: 0, kneeOut: 0, along: 0, arms: 0.1, high: 0 },
  { h: 0.35, back: 0.03, side: 0.1, open: 0.26, drop: 0.03, kneeUp: 0.25, kneeOut: 0.15, along: 0.35, arms: 0.18, high: 0.15 },
  // мяч на весу: удар сбоку — бедро отводится в сторону и нога идёт к мячу по горизонтальной дуге, корпус клонится
  // от бьющей ноги, руки широко разведены. Колено смотрит наружу, а не вверх: иначе бедро задирается выше таза.
  { h: 0.6, back: 0.07, side: 0.3, open: 0.32, drop: 0.025, kneeUp: 0.3, kneeOut: 0.8, along: 0.9, arms: 0.2, high: 0.65 },
  { h: 0.9, back: 0.1, side: 0.42, open: 0.38, drop: 0.02, kneeUp: 0.35, kneeOut: 1.2, along: 1, arms: 0.24, high: 1 },
];
const KICK_KEYS = ['back', 'side', 'open', 'drop', 'kneeUp', 'kneeOut', 'along', 'arms', 'high'];

// Поза для высоты h: линейное смешивание двух соседних опорных поз, умноженное на вес w
function kickPose(h, w, out) {
  const T = KICK_POSES, n = T.length;
  let i = 0;
  while (i < n - 2 && h > T[i + 1].h) i++;
  const a = T[i], b = T[i + 1], k = clamp((h - a.h) / (b.h - a.h), 0, 1);
  for (const key of KICK_KEYS) out[key] = (a[key] + (b[key] - a[key]) * k) * w;
  return out;
}

// Профиль удара с места по раскадровке refs/kick-reference.mp4 (замедленная съёмка сбоку, замедление ~3,5× — оценка).
// Точки — [время относительно контакта, с; добавка, рад]; между точками — линейно. Добавки ложатся поверх клипа удара:
//   lean — корпус: в замахе наклонён вперёд, к контакту выпрямляется и уходит назад, в проводке отклонён назад;
//   side — наклон от бьющей ноги к опорной: наибольший в момент контакта;
//   arm  — рука, противоположная бьющей ноге: в замахе поднята в сторону для баланса.
// Углы сняты на глаз с одного ракурса: тайминг и форма надёжны, абсолютные значения — оценка.
export const KICK_REF = {
  lean: [[-0.22, 0.4], [-0.1, 0.48], [0, -0.14], [0.12, -0.55], [0.26, -0.15]],
  side: [[-0.22, 0.04], [-0.08, 0.14], [0, 0.3], [0.12, 0.24], [0.26, 0.04]],
  arm: [[-0.22, 0.25], [-0.1, 0.4], [0, 0.2], [0.12, 0]],
  // таз отходит от мяча назад, м: в референсе тазобедренный сустав в момент контакта позади мяча, нога почти прямая;
  // в игре игрок стоит ближе к мячу, и без этого бьющая нога в контакте сложена пополам
  hipBack: [[-0.2, 0], [-0.06, 0.1], [0, 0.18], [0.1, 0.1], [0.24, 0]],
  pelvis: 0.85, // насколько выпрямляется приседание из клипа: в клипе актёр бьёт с длинного выпада, в игре стопы стоят ближе
};
function profile(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
  return pts[pts.length - 1][1];
}

export class PlayerRig {
  constructor() {
    this.ready = false;
    this.root = new THREE.Group();
    this.bones = {};
    this.info = {};
    this.diag = { reachErr: [0, 0], pitch: [0, 0], pelvisY: 0, cap: [9, 9] }; // cap — предел высоты таза по каждой опорной ноге
    this.sp = {}; this.t = 0; this._wasAir = false;
    this.pose = new PoseBlend(); this._gp = 0; this._kc = 0; this._kOn = false; this._kSide = 1; this._kDyn = false; this._kCharge = 0; this._py = 0;
    this._pv = { x: 0, z: 0 }; this._acc = { f: 0, r: 0 };
    this._pelvisY = null; this._look = 0;
    this.skeletonHelper = null;
    // клипы набора Mocap Pack 05 Soccer: удары, стойка защитника, чеканка, празднование. Выключатель — для сравнения в лаборатории
    this.packClips = true;
    this._kClip = CLIPS.kick; this._kPack = false; this._cel = null;
    // Подстройка клипа к ситуации. Бьющая нога идёт по траектории из клипа; к точке, где стопу держит симуляция
    // (контакт с мячом), её подтягивает поправка не длиннее kickReach. simLead/simHold — за сколько секунд до контакта
    // поправка набирает полный вес и как быстро отпускает ногу в проводку; simAfter — остаток веса в проводке.
    // kneeFront — насколько колено обязано смотреть вперёд-вверх от линии бедро — стопа (0 — на линии, 1 — строго вперёд);
    // kneeRate — предел скорости поворота колена вокруг этой линии, 1/с.
    this.adapt = { kickLeg: true, kickRef: true, kickReach: 0.45, simLead: 0.14, simHold: 0.12, simAfter: 0.15, kneeFront: 0.25, kneeRate: 30,
      antLead: 0.55, antFull: 0.2, pelvisReach: 0.18, legMin: 0.9, legMax: 0.97, clipLead: 0.15, leadBall: 0.67, idleCalm: 0.6, idleDrop: 0.012,
      slide: { drop: 0.75, back: 0.75, roll: 0.5, turn: 0.35, hipBack: 0.16, tuckFwd: 0.34, tuckIn: 0.06, curl: [0.92, 0.8, 0.66, 0.42, 0.12] }, // curl: share of the body tilt taken by Spine, Spine1, chest, neck, head; // tuck*: where the foot of the bent leg lies, m forward of the body and across to the leading side // slide tackle: pelvis drop, m; lean back, roll onto the side and turn of the chest, rad
      // at rest: share of the clip's pelvis sway and bob removed; extra crouch, m
      legFree: 0.85, legBall: 0.2 };
    // clipLead — the run clip is sampled this share of the cycle ahead of the sim phase: measured, the clip's pelvis was lowest
    //   at the toe-off instead of the middle of the support (the body sank in flight and rose on landing);
    // legFree / legBall — how much the swinging leg follows the run clip (ankle path, knee direction, foot rotation) without
    //   the ball and with it. The supporting foot always stays where the sim planted it; with the ball the sim leads the
    //   swing too, because the foot has to meet the ball. // поза удара начинает набираться за antLead с до контакта и набрана полностью за antFull с
    this._kLeg = false; this._kH = 0.11; this._kSideA = 0; this._kp = {};
    this.diag.plan = { w: 0, h: 0.11, tc: 0 }; // вес позы удара, высота контакта по плану, время до контакта
    this.diag.kick = { corr: 0, cut: 0, legK: 0, sim: 0 }; // длина поправки, срезанная часть, вес клипа в ноге, вес симуляции
  }

  // празднование гола: руки и корпус из клипа, пока игрок не начал удар
  celebrate() { this._cel = 0; }

  // Сброс сглаживания позы: после скачка мира (новая сцена, повтор с середины) следующий кадр ставит позу сразу,
  // а не доводит её пружинами из позы прошлой сцены
  resetMotion() {
    this.sp = {}; this._wasAir = false; this.pose = new PoseBlend(); this._gp = 0; this._kc = 0; this._kOn = false; this._kDyn = false; this._kCharge = 0;
    this._pv = { x: 0, z: 0 }; this._acc = { f: 0, r: 0 }; this._pelvisY = null; this._kClip = CLIPS.kick; this._kPack = false; this._cel = null;
    this._kLeg = false; this._kH = 0.11; this._kSideA = 0; this._kp = {}; this._prevYaw = undefined; this._armW = null; this._fallSide = 0;
    if (this.ready) this._grip(0);
    for (const L of this.legs || []) { L.pole = null; L.pitch = 0; L.kw = 0; L.bw = 0; L.kDyn = false; L.aw = null; L.lw = null; L.ankSide = 0; }
    this._guW = 0; if (this._gu) { this._gu.rw = 0; this._gu.hw = 0; }
  }

  async load(scene, targetHeight) {
    const gltf = await new GLTFLoader().loadAsync(modelUrl);
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const refreshSkin = () => model.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.update(); });
    refreshSkin();
    const box = new THREE.Box3().setFromObject(model, true);
    const rawH = box.max.y - box.min.y;
    const s = targetHeight / rawH;
    const c = box.getCenter(new THREE.Vector3());
    model.scale.setScalar(s);
    model.position.set(-c.x * s, -box.min.y * s, -c.z * s);
    this.root.add(model);
    scene.add(this.root);
    let shoes = null;
    model.traverse((o) => {
      if (o.isBone) this.bones[o.name.replace(/^mixamorig:?/, '')] = o;
      if (o.isMesh) {
        o.castShadow = true; o.frustumCulled = false;
        if (/Shoes/i.test(o.name)) shoes = o;
        const mat = o.material;
        if (mat.transparent) { mat.alphaTest = 0.35; mat.depthWrite = true; mat.transparent = /lash/i.test(mat.name); }
      }
    });
    this._stylize(model);
    this.root.updateMatrixWorld(true);
    refreshSkin();
    const B = this.bones;
    for (const need of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand']) {
      if (!B[need]) throw new Error('В модели нет кости ' + need);
    }
    const wp = (b) => b.getWorldPosition(new THREE.Vector3());
    const wq = (b) => b.getWorldQuaternion(new THREE.Quaternion());
    // направление «вперёд» модели — по стопам
    const F0 = wp(B.LeftToeBase).sub(wp(B.LeftFoot)).add(wp(B.RightToeBase).sub(wp(B.RightFoot)));
    F0.y = 0; F0.normalize();
    this.F0 = F0; this.phi0 = Math.atan2(F0.x, F0.z);
    this.rest = {};
    for (const [name, b] of Object.entries(B)) this.rest[name] = { q: wq(b), p: wp(b) };

    const R = this.rest;
    const limb = (name, childName, axisFromDir) => {
      const dir = R[childName].p.clone().sub(R[name].p).normalize();
      const axis = axisFromDir(dir).normalize();
      const k = basisQuat(dir, axis, new THREE.Quaternion()).invert().multiply(R[name].q);
      return { bone: B[name], k };
    };
    const legAxis = (dir) => new THREE.Vector3().crossVectors(F0, dir); // сгиб колена: голень назад
    const armAxis = (dir) => new THREE.Vector3().crossVectors(dir, F0); // сгиб локтя: предплечье вперёд
    this.legs = [-1, 1].map((side) => {
      const n = side < 0 ? 'Left' : 'Right';
      return {
        side, name: n, restDir: R[n + 'Leg'].p.clone().sub(R[n + 'UpLeg'].p).normalize(),
        thigh: limb(n + 'UpLeg', n + 'Leg', legAxis), shin: limb(n + 'Leg', n + 'Foot', legAxis), shinDir: R[n + 'Foot'].p.clone().sub(R[n + 'Leg'].p).normalize(),
        up: B[n + 'UpLeg'], foot: B[n + 'Foot'], footRest: R[n + 'Foot'].q,
        l1: R[n + 'Leg'].p.distanceTo(R[n + 'UpLeg'].p), l2: R[n + 'Foot'].p.distanceTo(R[n + 'Leg'].p),
        pitch: 0, ankleH: R[n + 'Foot'].p.y, toe: B[n + 'ToeBase'], toeH: R[n + 'ToeBase'].p.y,
        toeFwd: (R[n + 'ToeBase'].p.x - R[n + 'Foot'].p.x) * F0.x + (R[n + 'ToeBase'].p.z - R[n + 'Foot'].p.z) * F0.z,
        // голеностоп: направление на носок в покое и его угол к голени — от него считается подъём стопы
        toeRest: R[n + 'ToeBase'].p.clone().sub(R[n + 'Foot'].p).normalize(), footRestInv: R[n + 'Foot'].q.clone().invert(),
      };
    });
    // покой голеностопа — стопа ровно на покрытии под вертикальной голенью (в позе покоя модели нога стоит иначе)
    for (const L of this.legs) L.ankle0 = Math.PI / 2 - Math.acos(clamp(-L.toeRest.y, -1, 1));
    this.arms = [-1, 1].map((side) => {
      const n = side < 0 ? 'Left' : 'Right';
      return { side, upper: limb(n + 'Arm', n + 'ForeArm', armAxis), fore: limb(n + 'ForeArm', n + 'Hand', armAxis) };
    });
    this.hipRestY = R.Hips.p.y;
    this.hipJointDy = (R.LeftUpLeg.p.y + R.RightUpLeg.p.y) / 2 - R.Hips.p.y;
    this.hipHalf = R.LeftUpLeg.p.distanceTo(R.RightUpLeg.p) / 2;
    // подошва: нижняя граница обуви в позе покоя; пятка/носок — для точки середины стопы
    let soleY = 0, shoeMinF = 0, shoeMaxF = 0;
    if (shoes) {
      const sb = new THREE.Box3().setFromObject(shoes, true);
      soleY = sb.min.y;
      const corners = [sb.min, sb.max].map((v) => v.x * F0.x + v.z * F0.z);
      shoeMinF = Math.min(...corners); shoeMaxF = Math.max(...corners);
    }
    const ankleF = (R.LeftFoot.p.x * F0.x + R.LeftFoot.p.z * F0.z + R.RightFoot.p.x * F0.x + R.RightFoot.p.z * F0.z) / 2;
    this.ankleFwd = shoes ? clamp((shoeMinF + shoeMaxF) / 2 - ankleF, 0.02, 0.14) : 0.07;
    this.soleY = soleY;
    this.heelBack = shoes ? Math.max(0.08, (shoeMaxF - shoeMinF) / 2 - 0.015) : 0.12;
    // расслабленные кисти: в T-позе пальцы прямые, это главный признак «манекена»
    let curled = 0;
    for (const [name, b] of Object.entries(B)) {
      const m = /Hand(Index|Middle|Ring|Pinky|Thumb)([123])$/.exec(name);
      if (!m || !b.children[0]) continue;
      const dir0 = wp(b.children[0]).sub(R[name].p).normalize();
      const axisW = new THREE.Vector3().crossVectors(dir0, new THREE.Vector3(0, -1, 0)); // к ладони (в T-позе ладони вниз)
      if (axisW.lengthSq() < 1e-6) continue;
      const axisL = axisW.normalize().applyQuaternion(R[name].q.clone().invert());
      const ang = m[1] === 'Thumb' ? 0.18 : [0.42, 0.5, 0.38][Number(m[2]) - 1] * (m[1] === 'Pinky' ? 1.15 : m[1] === 'Index' ? 0.85 : 1);
      b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axisL, ang));
      (this._fingers || (this._fingers = [])).push({ b, axisL, q0: b.quaternion.clone(), right: name.startsWith('Right'), thumb: m[1] === 'Thumb' });
      curled++;
    }
    this.info = {
      rawHeight: rawH, scale: s, height: targetHeight, soleY,
      ankleH: this.legs[0].ankleH, thigh: this.legs[0].l1, shin: this.legs[0].l2,
      shoeLength: shoeMaxF - shoeMinF, ankleFwd: this.ankleFwd, forward: [F0.x, F0.z],
      bones: Object.keys(B).length, fingersCurled: curled,
    };
    this.skeletonHelper = new THREE.SkeletonHelper(model);
    this.skeletonHelper.visible = false;
    scene.add(this.skeletonHelper);
    model.traverse((o) => { if (o.isSkinnedMesh && /^Tops/i.test(o.name) && !this._back) this._buildBack(o); });
    // правая кисть в позе покоя: куда смотрят пальцы и ладонь (в T-позе ладонь вниз) — по ним кисть разворачивается в рукопожатии
    if (B.RightHandMiddle1 && B.RightHandIndex1 && B.RightHandPinky1) {
      const w = R.RightHand.p, d0 = R.RightHandMiddle1.p.clone().sub(w);
      this.handLen = d0.length(); d0.normalize();
      const p0 = new THREE.Vector3().crossVectors(R.RightHandIndex1.p.clone().sub(w), R.RightHandPinky1.p.clone().sub(w)).normalize();
      if (p0.y > 0) p0.multiplyScalar(-1); // сторона ладони
      p0.addScaledVector(d0, -p0.dot(d0)).normalize();
      this._palmRest = new THREE.Matrix4().makeBasis(d0, p0, new THREE.Vector3().crossVectors(d0, p0));
      this.palmOff = this.handLen * 0.6; // от запястья до середины ладони
    }
    this.ready = true;
    return this.info;
  }

  _yawQuat(theta, out) { return out.setFromAxisAngle(UP, Math.PI / 2 - theta - this.phi0); }

  // Пружина с затуханием: вторичное движение догоняет цель с небольшой инерцией
  // Стилизованный материал игрока: свет ложится тремя ступенями вместо плавного перехода, форма — чистым цветом без рисунка
  // ткани (складки остаются от карты нормалей), по контуру — светлая кайма, которая отделяет фигуру от поля.
  _stylize(model) {
    const ramp = new THREE.DataTexture(new Uint8Array([92, 92, 92, 255, 150, 150, 150, 255, 205, 205, 205, 255]), 3, 1, THREE.RGBAFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
    const LOOK = { // тон поверх текстуры и сила каймы
      Tops: { flat: true, color: 0x2a66d6, rim: 0.22 }, Bottoms: { flat: true, color: 0x15316f, rim: 0.18 },
      Body: { color: 0xe6d3c6, rim: 0.14 }, Hair: { color: 0xe2d6c2, rim: 0.1 }, Shoes: { color: 0xdedede, rim: 0.12 },
    };
    model.traverse((o) => {
      if (!o.isMesh) return;
      const src = o.material, look = LOOK[Object.keys(LOOK).find((k) => o.name.startsWith(k))] || { color: 0xffffff, rim: 0 };
      const mat = new THREE.MeshToonMaterial({
        name: src.name, map: look.flat ? null : src.map, normalMap: src.normalMap, gradientMap: ramp, color: look.color,
        transparent: src.transparent, alphaTest: src.alphaTest, depthWrite: src.depthWrite, side: src.side,
      });
      if (src.normalMap) mat.normalScale.copy(src.normalScale).multiplyScalar(look.flat ? 0.45 : 1); // on a flat colour full-strength folds break the shading into blotches
      if (look.rim > 0) {
        mat.onBeforeCompile = (sh) => {
          sh.uniforms.rimK = { value: look.rim };
          sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform float rimK;\nvoid main() {').replace('#include <opaque_fragment>',
            'float rim = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.6);\n  outgoingLight += vec3(1.0, 0.97, 0.9) * rim * rimK * (0.35 + 0.65 * diffuseColor.rgb);\n  #include <opaque_fragment>');
        };
      }
      o.material = mat; src.dispose();
    });
  }

  // Номер и имя на спине. Надпись не висит отдельной табличкой, а спроецирована на футболку: это копия треугольников спины
  // (собирается при загрузке, _buildBack) с теми же костями и весами, поэтому она лежит на ткани и гнётся вместе с ней.
  setBack(name, num) {
    if (!this.ready || !this._back) return;
    const nm = String(name || '').toUpperCase().slice(0, 12), key = nm + '|' + num;
    if (key === this._backKey) return;
    this._backKey = key;
    const c = this._back.canvas, g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height); g.textAlign = 'center'; g.lineJoin = 'round'; g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(0,0,0,0.45)';
    let fs = 44; const font = () => { g.font = '900 ' + fs + 'px "Arial Narrow", Arial, sans-serif'; };
    font(); while (g.measureText(nm).width > 216 && fs > 18) { fs -= 2; font(); }
    g.lineWidth = 5; g.strokeText(nm, 128, 62); g.fillText(nm, 128, 62);
    g.font = '900 176px Impact, "Arial Black", sans-serif'; g.lineWidth = 8; g.strokeText(String(num), 128, 232); g.fillText(String(num), 128, 232);
    this._back.tex.needsUpdate = true;
  }

  // Полотно надписи: треугольники футболки, которые смотрят назад и попадают в прямоугольник проекции на спине.
  // Вызывается при загрузке, пока скелет стоит в исходной позе: по ней считается, куда попадает каждая вершина.
  _buildBack(tops) {
    const R = this.rest.Spine2, F0 = this.F0, W = 0.36, H = 0.4;
    const n = new THREE.Vector3().copy(F0).multiplyScalar(-1), ax = new THREE.Vector3().crossVectors(UP, n).normalize();
    const C = R.p.clone().addScaledVector(UP, 0.035);
    const g0 = tops.geometry, pos = g0.attributes.position, idx = g0.index, si = g0.attributes.skinIndex, sw = g0.attributes.skinWeight, nr = g0.attributes.normal;
    const wp = [], v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) { tops.getVertexPosition(i, v); wp.push(v.applyMatrix4(tops.matrixWorld).clone()); }
    const P = [], N = [], UV = [], SI = [], SW = [], map = new Map(), I = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), fn = new THREE.Vector3();
    const tri = idx ? idx.count / 3 : pos.count / 3, at = (k) => (idx ? idx.getX(k) : k);
    const uvOf = (p) => [p.clone().sub(C).dot(ax) / W + 0.5, p.clone().sub(C).dot(UP) / H + 0.5];
    for (let t = 0; t < tri; t++) {
      const i0 = at(t * 3), i1 = at(t * 3 + 1), i2 = at(t * 3 + 2), p0 = wp[i0], p1 = wp[i1], p2 = wp[i2];
      fn.crossVectors(a.subVectors(p1, p0), b.subVectors(p2, p0)).normalize();
      if (fn.dot(n) < 0.25) continue; // смотрит не назад
      if (p0.clone().sub(C).dot(n) < 0.02) continue; // не на спине (грудь, рукав спереди)
      const uvs = [uvOf(p0), uvOf(p1), uvOf(p2)];
      if (uvs.every((u) => u[0] < 0 || u[0] > 1 || u[1] < 0 || u[1] > 1)) continue; // целиком вне надписи
      [i0, i1, i2].forEach((vi, k) => {
        let j = map.get(vi);
        if (j === undefined) {
          j = P.length / 3; map.set(vi, j);
          P.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi)); N.push(nr.getX(vi), nr.getY(vi), nr.getZ(vi)); UV.push(uvs[k][0], uvs[k][1]);
          SI.push(si.getX(vi), si.getY(vi), si.getZ(vi), si.getW(vi)); SW.push(sw.getX(vi), sw.getY(vi), sw.getZ(vi), sw.getW(vi));
        }
        I.push(j);
      });
    }
    if (!I.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
    geo.setIndex(I);
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 288;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    // вне прямоугольника надписи текстура прозрачна: край полотна не виден
    const mat = new THREE.MeshToonMaterial({ map: tex, gradientMap: tops.material.gradientMap, color: 0xffffff, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.name = 'BackPrint'; mesh.frustumCulled = false; mesh.renderOrder = 2;
    mesh.position.copy(tops.position); mesh.quaternion.copy(tops.quaternion); mesh.scale.copy(tops.scale);
    tops.parent.add(mesh); mesh.updateMatrixWorld(true);
    mesh.bind(tops.skeleton, tops.bindMatrix);
    this._back = { mesh, tex, canvas, tris: I.length / 3 };
  }

  // ---------- полный клип без симуляции: все кости — из motion capture, корень двигает постановка (сцена выхода)
  // root — { x, z, yaw }; layers — [{ clip, t, w, mirror }]; opt.hand — { i, x, y, z, w }: кисть дотягивается до точки (IK)
  updateClip(root, layers, opt = {}) {
    if (!this.ready) return;
    const B = this.bones, R = this.rest, P = this.pose;
    P.reset();
    for (const l of layers) P.add(l.clip, l.t, l.w, !!l.mirror);
    P.finish();
    const th = root.yaw, f = new THREE.Vector3(Math.cos(th), 0, Math.sin(th)), r = new THREE.Vector3(-f.z, 0, f.x);
    const yawQ = this._yawQuat(th, new THREE.Quaternion()), H = this.hipRestY;
    const hp = new THREE.Vector3(root.x, P.hips.y * H, root.z).addScaledVector(r, -P.hips.x * H).addScaledVector(f, P.hips.z * H);
    for (const name of CLIP_ORDER) {
      setWorldQuat(B[name], _q.copy(yawQ).multiply(P.get(name)).multiply(R[name].q));
      if (name === 'Hips') B.Hips.position.copy(B.Hips.parent.worldToLocal(hp));
    }
    if (opt.hand && opt.hand.w > 0.001) this._reach(opt.hand.i, opt.hand, opt.hand.w, f, r);
    this._grip(opt.hand && opt.hand.palm ? opt.hand.w : 0);
    if (!this._clipMode) { this._clipMode = true; this._armW = null; }
  }

  // Положение кости в клипе относительно корня при взгляде вдоль +X (вперёд — x, вправо — z): по нему сцена расставляет
  // игроков так, чтобы кисти в рукопожатии сошлись. Считается по цепочке костей, скелет при этом не трогается.
  clipPoint(clip, t, bone, out = new THREE.Vector3()) {
    const P = this._probe || (this._probe = new PoseBlend()), R = this.rest, H = this.hipRestY;
    P.reset(); P.add(clip, t, 1); P.finish();
    const yawQ = this._yawQuat(0, new THREE.Quaternion()), chain = [];
    for (let b = this.bones[bone]; b && b !== this.bones.Hips; b = b.parent) chain.unshift(b.name.replace(/^mixamorig:?/, ''));
    out.set(P.hips.z * H, P.hips.y * H, -P.hips.x * H);
    // поворот кости в клипе задан относительно позы покоя: звено «родитель — ребёнок» из покоя поворачивается поворотом родителя
    let prev = 'Hips', rot = 'Hips';
    for (const name of chain) {
      out.add(_x.subVectors(R[name].p, R[prev].p).applyQuaternion(_q.copy(yawQ).multiply(P.get(rot))));
      prev = name; if (BONE_SET.has(name)) rot = name;
    }
    return out;
  }

  // Сжать правую кисть: k = 0 — расслаблена, 1 — пальцы обхватывают чужую ладонь
  _grip(k) {
    if (!this._fingers || k === this._gripK) return;
    this._gripK = k;
    for (const F of this._fingers) if (F.right) F.b.quaternion.copy(F.q0).multiply(_q.setFromAxisAngle(F.axisL, (F.thumb ? 0.22 : 0.42) * k));
  }

  // Двухзвенный IK руки: запястье — в точку target с весом w. target.palm — рукопожатие: кисть разворачивается пальцами
  // вперёд по корпусу, ладонью влево (к ладони соперника), большим пальцем вверх
  _reach(i, target, w, f, r) {
    const B = this.bones, n = i ? ['RightArm', 'RightForeArm', 'RightHand'] : ['LeftArm', 'LeftForeArm', 'LeftHand'];
    const S = B[n[0]].getWorldPosition(new THREE.Vector3()), E = B[n[1]].getWorldPosition(new THREE.Vector3()), Hd = B[n[2]].getWorldPosition(new THREE.Vector3());
    const sp = B.Spine2.getWorldPosition(new THREE.Vector3());
    const l1 = E.distanceTo(S), l2 = Hd.distanceTo(E);
    const to = new THREE.Vector3(target.x - S.x, target.y - S.y, target.z - S.z);
    const d = clamp(to.length(), Math.abs(l1 - l2) + 0.03, (l1 + l2) * 0.985); to.normalize();
    // подсказка локтю — как он стоит в самом клипе: IK только доводит кисть, а не перекладывает руку
    const pole = new THREE.Vector3().subVectors(E, S).addScaledVector(to, -new THREE.Vector3().subVectors(E, S).dot(to));
    if (pole.lengthSq() < 1e-5) pole.set(0, -1, 0).addScaledVector(new THREE.Vector3(S.x - sp.x, 0, S.z - sp.z), 2).addScaledVector(to, 0);
    pole.addScaledVector(to, -pole.dot(to)).normalize();
    const ca = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const elbow = new THREE.Vector3().copy(S).addScaledVector(to, l1 * ca).addScaledVector(pole, l1 * Math.sqrt(1 - ca * ca));
    const hand = new THREE.Vector3().copy(S).addScaledVector(to, d);
    const aim = (bone, from, cur, des) => {
      const a = new THREE.Vector3().subVectors(cur, from).normalize(), b2 = new THREE.Vector3().subVectors(des, from).normalize();
      const wq = bone.getWorldQuaternion(new THREE.Quaternion());
      setWorldQuat(bone, new THREE.Quaternion().setFromUnitVectors(a, b2).multiply(wq).slerp(wq, 1 - w).normalize());
    };
    aim(B[n[0]], S, E, elbow);
    const E2 = B[n[1]].getWorldPosition(new THREE.Vector3()), H2 = B[n[2]].getWorldPosition(new THREE.Vector3());
    aim(B[n[1]], E2, H2, hand);
    if (target.palm && this._palmRest && i === 1) {
      const d = _x.copy(f).normalize(), p = _z.copy(r).multiplyScalar(-1);
      const des = _m.makeBasis(d, p, new THREE.Vector3().crossVectors(d, p));
      const q = new THREE.Quaternion().setFromRotationMatrix(des.multiply(new THREE.Matrix4().copy(this._palmRest).invert())).multiply(this.rest.RightHand.q);
      const wq = B.RightHand.getWorldQuaternion(new THREE.Quaternion());
      setWorldQuat(B.RightHand, wq.slerp(q, w));
    }
  }

  // Цвет формы: футболка и шорты — чистый цвет
  setKit(top, bottom) {
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if (/^Tops/i.test(o.name)) o.material.color.set(top);
      else if (/^Bottoms/i.test(o.name)) o.material.color.set(bottom);
    });
  }

  _spring(name, target, hz, zeta, dt) {
    let s = this.sp[name];
    if (!s) s = this.sp[name] = { x: target, v: 0 };
    if (dt <= 0) return s.x;
    if (dt > 0.05) { s.x = target; s.v = 0; return s.x; }
    // подшаги по устойчивости: явная схема расходится при w·h около 0,9 (таз жёсткой пружины 14 Гц раскачивался
    // до бесконечности при шаге кадра 0,01 с — 100 Гц монитора или замедление), поэтому w·h не больше 0,5
    const w = 2 * Math.PI * hz, n = Math.max(1, Math.ceil(w * dt / 0.5)), h = dt / n;
    for (let i = 0; i < n; i++) { s.v += (w * w * (target - s.x) - 2 * zeta * w * s.v) * h; s.x += s.v * h; }
    return s.x;
  }

  // Смешивание motion-capture поз по состоянию игрока. Бег синхронизирован с фазой шага симуляции:
  // левая стопа клипа встаёт на покрытие тогда же, когда левая стопа симуляции.
  _mocapPose(s, aux, dt, f, r, speed) {
    const P = this.pose;
    P.reset();
    const vF = s.vx * f.x + s.vz * f.z, vR = s.vx * r.x + s.vz * r.z;
    const move = clamp((speed - 0.25) / 1.0, 0, 1);
    const sq = (v) => v * v, tot = sq(vF) + sq(vR) + 1e-6;
    const w = {
      idle: this._spring('wIdle', 1 - move, 5, 1, dt),
      fwd: this._spring('wF', move * sq(Math.max(0, vF)) / tot, 5, 1, dt),
      back: this._spring('wB', move * sq(Math.max(0, -vF)) / tot, 5, 1, dt),
      left: this._spring('wL', move * sq(Math.max(0, -vR)) / tot, 5, 1, dt),
      right: this._spring('wR', move * sq(Math.max(0, vR)) / tot, 5, 1, dt),
    };
    // фаза шага: пока цикл идёт — из симуляции; иначе плавно докручивается сама
    if (s.gait) this._gp = s.gp; else this._gp = (this._gp + dt / 0.66) % 1;
    // with the ball the steps are shorter and uneven (touches): a smaller lead keeps the pelvis in step there
    const lead = this._spring('clipLd', this.adapt.clipLead * (aux.withBall ? this.adapt.leadBall : 1), 3, 1, dt);
    const loco = (clip, weight) => P.add(clip, (this._gp + strikePhase(clip) + lead) * clip.duration, Math.max(0, weight));
    P.add(CLIPS.idle, this.t, Math.max(0, w.idle));
    loco(CLIPS.jogForward, w.fwd); loco(CLIPS.jogBackward, w.back); loco(CLIPS.jogLeft, w.left); loco(CLIPS.jogRight, w.right);
    // ходьба: клипа ходьбы нет, а беговой верх (локти под 90°, наклон) на шаге читается как трусца на месте —
    // руки и корпус берутся в основном из спокойной стойки, противоход рук добавляется процедурно
    if (this._wk > 0.01) P.add(CLIPS.idle, this.t, 2.6 * this._wk, false, UPPER_BODY);
    if (this.packClips) {
      // стойка защитника и чеканка: верх тела из клипа; ноги и высоту таза по-прежнему ведёт симуляция
      if (this._gd > 0.01) P.add(CLIPS.packGuard, this.t, 2.2 * this._gd, false, UPPER_BODY);
      const wj = this._spring('wJug', aux.juggle ? 1 : 0, 4, 1, dt);
      if (wj > 0.01) P.add(CLIPS.packJuggle, this.t, 2.2 * wj, false, UPPER_BODY);
      if (this._cel !== null) {
        this._cel += dt;
        const c = this._cel, wc = clamp(c / 0.25, 0, 1) * clamp((2.6 - c) / 0.5, 0, 1);
        if (c >= 2.6 || aux.kick) this._cel = null;
        else P.add(CLIPS.packCelebrate, c, 6 * wc * wc * (3 - 2 * wc), false, UPPER_BODY);
      }
    }

    // удар: клип привязан к моменту контакта; для другой ноги — зеркально
    const kick = aux.kick, ph = kick ? kick.phase : null;
    if (kick) this._kCharge = kick.charge;
    if (ph === 'windup') {
      if (!this._kOn) {
        // клип выбирается один раз на удар: с хода — прежний удар на бегу; с места — щёчкой или силовой по заряду
        const jog = kick.dyn && speed > 1.2;
        // мяч на весу: клипы набора сняты для лежащего мяча (пас щёчкой, удар подъёмом) и для удара с лёта не подходят
        const volley = !!(kick.dyn && kick.plan && kick.plan.high);
        this._kPack = this.packClips && !jog && !kick.bike && !volley;
        // нога из клипа — только для удара с места по лежащему мячу: клип снят именно для него. По летящему мячу
        // стопа идёт на другую высоту, и клип пришлось бы тянуть на 0,8–1 м — колено при этом выгибалось назад
        this._kLeg = this._kPack && !kick.dyn;
        this._kClip = jog || volley ? CLIPS.strikeJog : !this._kPack ? CLIPS.kick : kick.charge >= 0.55 ? CLIPS.packKickPower : CLIPS.packKickSide;
      }
      this._kc = -(kick.windDur - kick.t + (kick.dyn ? (kick.swingDur || 0.09) : 0.075)); this._kSide = kick.footSide; this._kDyn = !!kick.dyn; this._kOn = true;
    }
    else if (ph === 'swing') { this._kc = Math.min(0, this._kc + dt); this._kOn = true; }
    else if (ph === 'curl') { this._kc = kick.t; this._kOn = true; }
    // после удара клип доигрывает проводку, а не обрывается: поза входит в удар быстро и отпускается плавно
    else if (this._kOn) { this._kc += dt; if (this._kc > (this._kLeg ? 0.36 : 0.3) || this._kc < 0) this._kOn = false; }
    const kw = this._spring('wKick', this._kOn ? 1 : 0, this._kOn ? 9 : 3.5, 1, dt);
    if (kw > 0.01) {
      const clip = this._kClip;
      const mirror = (clip.kickFoot === 'R') !== (this._kSide > 0);
      // остальные позы приглушаются, чтобы удар читался целиком
      P.acc.forEach((v, i) => { P.acc[i] = v * (1 - kw * 0.85); }); P.hips.multiplyScalar(1 - kw * 0.85); P.w *= 1 - kw * 0.85;
      P.add(clip, clip.contact + this._kc, kw * Math.max(0.2, P.w + 1) , mirror);
    }
    // приём: короткий фрагмент клипа приёма на жест
    const g = aux.gesture;
    if (g && (g.type === 'chest' || g.type === 'thigh' || g.type === 'foot')) {
      const gw = Math.sin(Math.PI * Math.min(1, g.t / 0.35));
      P.add(CLIPS.receive, 1.45 + g.t, gw * 0.7 * Math.max(0.2, P.w));
    }
    return P.finish();
  }

  // s — интерполированный снимок симуляции; aux — { ball:{x,y,z}, kick, gesture }
  update(s, aux, dt) {
    if (!this.ready) return;
    // после полного клипа (сцена выхода) вторичное движение начинается с чистого листа: пружины не тянут позу из клипа
    if (this._clipMode) { this._clipMode = false; this.sp = {}; this._armW = null; this._grip(0); for (const L of this.legs) { L.pole = null; L.pitch = 0; } }
    const B = this.bones, R = this.rest;
    this.t += dt;
    const th = s.yaw;
    const f = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const speed = Math.hypot(s.vx, s.vz);
    const run = Math.min(1, speed / 3.5);
    const air = s.py > 0.001;

    // сглаженное ускорение: наклон в разгон, торможение и вираж поверх позы из motion capture
    if (dt > 0) {
      const ax = (s.vx - this._pv.x) / dt, az = (s.vz - this._pv.z) / dt;
      const k = Math.min(1, 12 * dt);
      this._acc.f += (clamp(ax * f.x + az * f.z, -24, 24) - this._acc.f) * k;
      this._acc.r += (clamp(ax * r.x + az * r.z, -24, 24) - this._acc.r) * k;
      this._pv.x = s.vx; this._pv.z = s.vz;
    }
    const accMag = Math.hypot(this._acc.f, this._acc.r);
    const g = aux.gesture, gw = g ? Math.sin(Math.PI * Math.min(1, g.t / 0.35)) : 0;
    const kick = aux.kick, kc = kick ? kick.charge : 0;
    const kPhase = kick ? kick.phase : null;
    const kicking = kPhase === 'windup' || kPhase === 'swing' || kPhase === 'curl';

    // доля ходьбы: шаг без мяча на малой скорости (те же границы, что у цикла шага в симуляции);
    // с мячом, в стойке, в ударе и в воздухе остаётся беговая постановка корпуса
    const wkS = clamp((speed - 1.4) / 0.6, 0, 1);
    const wkT = aux.withBall || aux.guard || air || kick ? 0 : (1 - wkS * wkS * (3 - 2 * wkS)) * clamp((speed - 0.3) / 0.5, 0, 1);
    const wk = this._wk = clamp(this._spring('walk', wkT, 3, 1, dt), 0, 1);

    const gd = this._gd = this._spring('guard', aux.guard ? 1 : 0, 5, 0.85, dt);
    const pose = this._mocapPose(s, aux, dt, f, r, speed);
    // slide tackle / reach: pose weights follow the sim's leg extension
    const sl = clamp(this._spring('slide', aux.slide ? Math.max(aux.slide.ext, 0.25) : 0, 10, 1, dt), 0, 1);
    const rc = clamp(this._spring('reach', aux.reach ? aux.reach.ext : 0, 10, 1, dt), 0, 1);
    // падение после удара через себя: наклон всего тела назад (и разворот набок), высота таза, наклон вперёд при подъёме
    const fl = aux.fall, sm01 = (x) => { const y = clamp(x, 0, 1); return y * y * (3 - 2 * y); };
    let tiltT = 0, dropT = 0, fwdT = 0;
    // slide tackle, getting up in order: first the pelvis comes forward over the feet and the torso sits up (the hand
    // pushes off the turf), only then the body rises. With one weight for everything the body rose while still behind
    // the feet and then caught up with them.
    const sE = aux.slide ? aux.slide.ext : 0, sRise = !!aux.slide && aux.slide.t > 0.2 && sE < 0.999, sT0 = aux.slide ? Math.max(sE, 0.25) : 0;
    const sBack = clamp(this._spring('slBack', sRise ? sm01((sE - 0.45) / 0.55) : sT0, 10, 1, dt), 0, 1);
    const sHip = clamp(this._spring('slHip', sRise ? sm01((sE - 0.6) / 0.4) : sT0, 10, 1, dt), 0, 1);
    const sDrop = clamp(this._spring('slDrop', sRise ? Math.pow(sE, 0.55) : sT0, 10, 1, dt), 0, 1);
    const sUp = this._spring('slUp', sRise ? Math.sin(Math.PI * (1 - sE)) : 0, 8, 1, dt); // the lean over the feet while rising
    const sideFall = !!fl && fl.kind === 'side';
    if (sideFall) {
      // сбоку в полёте: до контакта корпус завален вбок; после него тело выпрямляется, разворачиваясь вслед за ногой,
      // и приходит на ноги с наклоном вперёд, который гаснет вместе с приседанием
      // Винт: корпус остаётся горизонтальным, пока тело проворачивается вокруг своей оси грудью вниз; завал вбок (в мире)
      // по мере разворота сменяется наклоном вперёд (относительно тела), и на покрытие игрок приходит в низкую стойку.
      const sS = clamp((fl.spinT || 0) / fl.spinDur, 0, 1), land = fl.phase === 'land';
      tiltT = 1.25 * (1 - sm01((sS - 0.25) / 0.4));
      // the body comes upright while still in the air and takes the landing with the legs: a moderate lean and squat, no hands
      fwdT = land ? 0.5 * (1 - sm01((fl.t - 0.08) / 0.22)) : 0.5 * sm01((sS - 0.3) / 0.35);
      dropT = land ? 0.2 * fl.k + 0.07 * (1 - sm01(fl.t / 0.3)) : 0.05 + 0.05 * sm01(sS / 0.3);
    } else if (kick && kick.fly && kicking) tiltT = 0.4; // before the take-off the body already leans away from the kicking leg
    else if (fl) {
      if (fl.phase === 'air') tiltT = 1.2;
      else if (fl.phase === 'down') { tiltT = 1.2 + 0.25 * fl.k; dropT = 0.74 * fl.k; }
      else {
        // подъём в три приёма: приподняться на руке (корпус 83° -> ~45°, таз ещё на покрытии), собраться над стопами
        // (корпус вертикально и чуть вперёд, таз идёт вверх), выпрямиться
        const k = fl.k;
        tiltT = k > 0.7 ? 0.8 + 0.65 * sm01((k - 0.7) / 0.3) : 0.8 * sm01((k - 0.3) / 0.4);
        dropT = 0.74 * (k > 0.7 ? 1 - 0.12 * sm01((1 - k) / 0.3) : 0.88 * sm01(k / 0.7));
        fwdT = 0.42 * Math.sin(Math.PI * clamp(k / 0.55, 0, 1));
      }
    }
    const tilt = this._spring('tilt', tiltT, fl && (fl.phase === 'rise' || (sideFall && fl.spinT > 0)) ? 12 : 9, 1, dt), drop = clamp(this._spring('fdrop', dropT, 10, 1, dt), 0, 0.8), lie = drop / 0.74;
    const rollB = this._spring('froll', fl ? fl.roll * 1.15 : 0, 6, 1, dt) * clamp(tilt / 1.2, 0, 1);
    // slide tackle: the body goes down onto the hip of the trailing leg — leaning back and rolled onto that side
    if (aux.slide) { this._slSide = aux.slide.foot ? -1 : 1; this._slLead = aux.slide.foot; } // the side that touches the turf: opposite to the leading leg
    const slT = !fl && sl > 0.02, SL = this.adapt.slide;
    const tilted = tilt > 0.02 || slT;
    // на спину — наклон назад вокруг поперечной оси (с разворотом набок); сбоку в полёте — завал вбок от бьющей ноги вокруг продольной
    // ось завала — исходная линия удара: она стоит на месте, пока тело разворачивается вокруг своей оси
    if (!fl && kick && kick.fly && kicking) { this._fallSide = kick.fly; (this._fallAxis || (this._fallAxis = new THREE.Vector3())).set(kick.ax, 0, kick.az); }
    if (fl) { this._fallSide = sideFall ? fl.side : 0; if (sideFall) (this._fallAxis || (this._fallAxis = new THREE.Vector3())).set(fl.ax0, 0, fl.az0); }
    const bodyQ = slT ? new THREE.Quaternion().setFromAxisAngle(r, SL.back * sBack).multiply(new THREE.Quaternion().setFromAxisAngle(f, this._slSide * SL.roll * sBack)).multiply(new THREE.Quaternion().setFromAxisAngle(UP, -this._slSide * SL.turn * sBack))
      : this._fallSide
      ? new THREE.Quaternion().setFromAxisAngle(this._fallAxis, -this._fallSide * tilt)
      : new THREE.Quaternion().setFromAxisAngle(r, tilt).multiply(new THREE.Quaternion().setFromAxisAngle(UP, rollB));
    const lobW = clamp(this._spring('lob', kick && kick.type === 'lob' && kicking ? 1 : 0, 7, 1, dt), 0, 1);
    // поверх клипов набора процедурные добавки рук и корпуса ослаблены: движение уже есть в самом клипе
    const kProc = this._kPack ? 0.35 : 1, gProc = this.packClips ? 0.35 : 1;
    // удар через себя: корпус заваливается назад, пока идёт удар и игрок в воздухе после него
    const bk = this._spring('bike', kick && (kick.bike || kick.fly) && kicking ? 1 : 0, 5, 0.95, dt); // защитная стойка: ниже, шире, руки в стороны

    // ----- план удара: симуляция заранее знает высоту и время контакта (kick.plan — прогноз полёта мяча до 0,8 с).
    // Поза выбирается по этой высоте из опорных поз и набирается за adapt.antLead секунд до контакта,
    // а не подгоняется по высоте стопы, когда нога уже пошла к мячу.
    const kickSide = kick ? kick.footSide : 0;
    let antT = 0, tc = 0;
    if (kick && !kick.bike && !kick.fly) {
      const ad = this.adapt, waiting = kPhase === 'charge' || kPhase === 'ready';
      if (kick.plan && (waiting || kick.dyn)) this._kH = kick.plan.hRel;
      else if (kicking && !kick.dyn && aux.ball) this._kH = aux.ball.y - s.py; // удар с места: мяч уже здесь
      if (waiting && kick.plan) {
        tc = kick.plan.t;
        const a = clamp((ad.antLead - tc) / Math.max(0.01, ad.antLead - ad.antFull), 0, 1);
        antT = a * a * (3 - 2 * a);
      } else if (kicking) antT = 1;
      this._kSideA = kickSide;
    }
    const wA = clamp(this._spring('kAnt', antT, 6, 1, dt), 0, 1);
    const hPlan = wA < 0.02 ? (this.sp.kHs = { x: this._kH, v: 0 }).x : this._spring('kHs', this._kH, 6, 1, dt);
    const KP = kickPose(hPlan, wA * (this._kOn && this._kLeg ? 0.35 : 1), this._kp);
    const sideA = this._spring('kSideA', this._kSideA, 6, 1, dt); // план может сменить бьющую ногу: наклон переходит плавно
    this.diag.plan.w = wA; this.diag.plan.h = hPlan; this.diag.plan.tc = tc;
    // профиль по видеореференсу — для удара с места по лежащему мячу; силовой — в полную меру, щёчкой — слабее
    const refW = this.adapt.kickRef && this._kLeg ? clamp(this.sp.kLeg ? this.sp.kLeg.x : 0, 0, 1) * (this._kClip === CLIPS.packKickPower ? 1 : 0.4) : 0;
    const refLean = refW > 0.01 ? profile(KICK_REF.lean, this._kc) * refW : 0, refSide = refW > 0.01 ? profile(KICK_REF.side, this._kc) * refW : 0;
    const refArm = refW > 0.01 ? profile(KICK_REF.arm, this._kc) * refW : 0;
    // добавочный наклон: поза клипа уже содержит наклон бега, здесь только ускорение, спринт и события
    // sprint leans clearly further than the run; the start throws the body forward, braking sits it back
    const spr = air || aux.withBall ? 0 : clamp((speed - 3.5) / 1.1, 0, 1);
    // juggling: jg — share of the juggling pose, jb — a pulse on every touch (the leg goes to the ball, then springs back)
    const jg = clamp(this.sp.wJug ? this.sp.wJug.x : 0, 0, 1), jb = this._spring('jugBeat', aux.juggle && aux.juggle.swing ? 1 : 0, 4.5, 0.45, dt);
    let leanFT = clamp(0.021 * this._acc.f + 0.03 * run + 0.045 * Math.max(0, speed - 2.6) + 0.1 * spr, -0.3, 0.46);
    if (g && g.type === 'chest') leanFT -= 0.18 * gw;
    if (g && g.type === 'hit') leanFT -= 0.32 * gw; // непринятый мяч в корпус: игрока отбрасывает назад
    leanFT += 0.15 * gd - (0.07 + 0.06 * jb) * jg; // the body sits back a little from the ball and rocks with every touch
    if (air && !kicking) leanFT -= 0.12; // в прыжке корпус выпрямляется, а не горбится
    // jump: jp — the crouch before the push-off (0..1), jU — vertical speed as a share of the take-off speed (1 up, -1 down)
    const jp = aux.jumpPrep > 0 && !air ? clamp(1 - aux.jumpPrep / 0.075, 0.25, 1) : 0, jU = air ? clamp((aux.vy || 0) / 3.7, -1, 1) : 0;
    const jpS = this._spring('jPrep', jp, 12, 1, dt);
    leanFT += 0.9 * jpS + 0.5 * Math.max(0, this.sp.squash ? this.sp.squash.x : 0) / 0.1 * 0.2;
    const leanF = this._spring('leanF', leanFT, 3.4, 0.8, dt) - KP.back * (1 - bk) - (fl ? 0.1 : 0.8) * bk + refLean + 0.32 * sUp - 0.14 * lobW - 0.1 * rc + this._spring('fFwd', fwdT, 12, 1, dt);
    const leanS = this._spring('leanS', clamp(0.017 * this._acc.r, -0.3, 0.3), 3.4, 0.75, dt) + sideA * KP.side + this._kSide * refSide; // наклон от бьющей ноги к опорной (знак проверен пробой позы: раньше корпус клонился к мячу)
    const yawQ = this._yawQuat(th, new THREE.Quaternion());
    let dYaw = this._prevYaw === undefined ? 0 : th - this._prevYaw; this._prevYaw = th;
    if (dYaw > Math.PI) dYaw -= 2 * Math.PI; else if (dYaw < -Math.PI) dYaw += 2 * Math.PI;
    if (!(fl && sideFall)) dYaw = 0; // only for the spin after the flying side volley

    // ----- аркадное усиление, чтобы движение читалось с игровой камеры
    const foX = [0, 1].map((i) => (s.feet[i].x - s.px) * f.x + (s.feet[i].z - s.pz) * f.z);
    const dStride = foX[1] - foX[0]; // > 0 — правая стопа впереди
    // корпус скручивается навстречу тазу: левое плечо идёт вперёд вместе с правой ногой
    let twistT = clamp(dStride * 0.36, -0.3, 0.3) * (0.35 + 0.65 * run);
    // удар: корпус раскрывается к бьющей ноге на замахе и закручивается следом после контакта
    const kOn = this._kOn, kSide = this._kSide, kAmp = kOn ? (0.55 + 0.45 * this._kCharge + 0.25 * KP.high) * kProc : 0;
    const kPre = kOn && this._kc < 0, kPost = kOn && this._kc >= 0;
    if (kPre) twistT += kSide * 0.4 * kAmp; else if (kPost) twistT -= kSide * 0.5 * kAmp;
    else twistT += sideA * KP.open; // до замаха: корпус уже раскрывается к бьющей ноге
    const twist = this._spring('twist', twistT, 6.5, 0.65, dt);
    const twQ = (k) => new THREE.Quaternion().setFromAxisAngle(UP, -twist * k); // поворот вправо в осях сцены — отрицательный вокруг Y
    const vyEst = dt > 0 ? (s.py - this._py) / dt : 0; this._py = s.py;
    const addQ = new THREE.Quaternion().setFromAxisAngle(r, -leanF).multiply(_q.setFromAxisAngle(f, -leanS)).multiply(twQ(1));
    // руки: противоход ногам; в ударе — баланс и размах; в прыжке — мах вверх и разведение
    const armQ = [-1, 1].map((side, i) => {
      // противоход ногам, одинаково вперёд и назад: руки не выносятся обе перед грудью
      // run: relaxed arms low at the waist; sprint: a wide drive — the elbow goes far back, the hand comes up in front
      // (the elbow stays bent behind the body: a straight arm thrown back reads as flailing)
      let swT = clamp(-side * dStride * (0.9 + 0.5 * spr), -0.45 - 0.22 * spr, 0.45 + 0.4 * spr) * Math.max(0.25 + 0.75 * run, 0.85 * wk);
      let abdT = 0.07 + 0.14 * run, flexT = (0.3 + 0.15 * spr) * run + Math.max(0, swT) * 0.45 - Math.min(0, swT) * 0.35 * spr;
      if (kOn) {
        // удар: рука со стороны бьющей ноги уходит назад, противоположная — вперёд и немного в сторону; без «самолёта»
        const same = (kSide > 0) === (side > 0);
        if (kPre) { swT = same ? -0.55 * kAmp : 0.45 * kAmp; abdT = same ? 0.25 * kAmp : 0.5 * kAmp * (1 - 0.5 * Math.min(1, KP.high)); flexT = same ? 0.25 : 0.4; }
        else { swT = same ? 0.4 * kAmp : -0.4 * kAmp; abdT = same ? 0.25 * kAmp : 0.4 * kAmp; flexT = same ? 0.45 : 0.25; }
      }
      if ((kSide > 0) !== (side > 0)) abdT += refArm; // рука напротив бьющей ноги поднята в сторону, как в референсе
      abdT += KP.arms * (kOn ? 0.4 + 0.6 * Math.min(1, KP.high * 1.5) : 1); // баланс: чем выше мяч, тем шире руки; начинается до замаха
      if (air && !kOn) {
        // прыжок: согнутые руки идут вперёд-вверх до уровня плеч на взлёте и расходятся для баланса на спуске
        if (jU > 0.1) { swT = 1.4; abdT = Math.max(abdT, 0.3); flexT = 0.55; }
        else { swT = 0.95 + 0.6 * jU; abdT = Math.max(abdT, 0.65); flexT = 0.4; }
      }
      if (jp > 0 && !kOn) { swT = -0.7; abdT = Math.max(abdT, 0.2); flexT = 0.35; } // crouch before the jump: both arms go back
      if (sideFall && fl.phase === 'air') { swT *= 0.3; abdT = Math.max(abdT, 1.05); flexT *= 0.4; } // в полёте руки раскинуты
      if (sideFall && fl.phase === 'land') { const k = clamp(1 - fl.t / 0.3, 0, 1); abdT = Math.max(abdT, 0.3 + 0.5 * k); flexT = 0.35; swT *= 0.4; } // на посадке — в стороны, для баланса
      if (lie > 0.01 && !sideFall) { swT += (0 - swT) * lie; abdT = Math.max(abdT, 0.95 * lie * (1 - 0.6 * Math.min(1, Math.abs(rollB))) * (this._fallSide ? 0.45 : 1)); flexT += (0.25 - flexT) * lie; } // лёжа руки раскинуты
      // slide: the arm away from the turf is thrown up and out for balance; the other one goes to the turf (placed below)
      if (sl > 0.01) { const upArm = side !== this._slSide; swT += ((upArm ? 0.35 : -0.5) - swT) * sl; abdT = Math.max(abdT, (upArm ? 1.15 : 0.5) * sl); flexT += ((upArm ? 0.45 : 0.2) - flexT) * sl; }
      if (bk > 0.01) { swT += (0.35 - swT) * bk; abdT = Math.max(abdT, 0.6 * bk); flexT += (0.4 - flexT) * bk; } // руки в стороны для баланса
      if (jg > 0.01 && !kOn && !air) { abdT = Math.max(abdT, (0.3 + 0.18 * jb) * jg); swT += side * 0.12 * jb * jg * (aux.juggle && aux.juggle.side > 0 ? 1 : -1); } // arms out for balance, they answer every touch
      if (gd > 0.01 && !kOn && !air) { const k = gd * gProc; swT += (0.28 - swT) * k; abdT = Math.max(abdT, 0.55 * k); flexT += (0.75 - flexT) * k; }
      const sw = this._spring('aSw' + i, swT, 5.5, 0.55, dt), abd = this._spring('aAbd' + i, abdT, 5, 0.65, dt), flex = this._spring('aFl' + i, flexT, 5.5, 0.6, dt);
      const upper = addQ.clone().multiply(_q.setFromAxisAngle(r, sw)).multiply(_q2.setFromAxisAngle(f, -side * abd));
      const fore = addQ.clone().multiply(_q.setFromAxisAngle(r, sw + flex)).multiply(_q2.setFromAxisAngle(f, -side * abd));
      return { upper, fore };
    });
    // bk — share of the whole-body tilt this bone takes. In the slide the pelvis lies back on the turf, but the spine curls
    // up from it and the head stays level, eyes on the ball: a body tilted as one plank looked detached
    const _qb = new THREE.Quaternion();
    const world = (name, extra, bk = 1) => {
      const q = (extra ? extra.clone().multiply(yawQ) : yawQ.clone()).multiply(pose.get(name)).multiply(R[name].q);
      setWorldQuat(B[name], tilted ? q.premultiply(bk === 1 ? bodyQ : _qb.identity().slerp(bodyQ, bk)) : q);
    };
    const curl = slT ? this.adapt.slide.curl : [1, 1, 1, 1, 1];

    const fo = [0, 1].map((i) => (s.feet[i].x - s.px) * f.x + (s.feet[i].z - s.pz) * f.z);

    // ----- стопы с учётом жестов
    const feetT = [0, 1].map((i) => {
      const ft = s.feet[i];
      let h = ft.h, x = ft.x, z = ft.z;
      const lifted = g && g.type === 'thigh' && i === 1;
      if (lifted) { h += 0.42 * gw; x += (s.px + f.x * 0.3 - x) * gw; z += (s.pz + f.z * 0.3 - z) * gw; }
      let yaw = ft.yaw;
      // остановка низового мяча: ближняя стопа выходит к мячу; подошвой сверху — остановка, раскрытой щёчкой — приём сильного мяча
      const stopping = g && (g.type === 'foot' || g.type === 'cushion') && g.foot === i;
      if (stopping) {
        const bx = aux.ball.x - s.px, bz = aux.ball.z - s.pz, bl = Math.hypot(bx, bz) || 1, reach = Math.min(bl, 0.5) * (g.type === 'foot' ? 0.9 : 0.7);
        x += (s.px + (bx / bl) * reach - x) * gw; z += (s.pz + (bz / bl) * reach - z) * gw;
        h += (g.type === 'foot' ? 0.13 : 0.05) * gw;
        if (g.type === 'cushion') yaw += (i ? 1 : -1) * 1.0 * gw;
      }
      // через себя: свободная нога тоже идёт вверх — «ножницы». Только стопа, оторванная от покрытия: опорную, пока
      // игрок ещё стоит на ней в замахе, это правило задирало к тазу (колено выше таза, при отрыве — скачок на 60°)
      if (bk > 0.01 && !fl && !ft.planted && !(kicking && (kickSide > 0) === (i === 1))) { h += 0.5 * bk; x += f.x * 0.3 * bk; z += f.z * 0.3 * bk; }
      // в прыжке свободная нога поджимается, а не висит
      if (air && sl < 0.05 && !fl && !(kicking && (kickSide > 0) === (i === 1))) {
        const tuck = 1 - jU * jU; // the height of the feet comes from the sim; here only the fore-aft split at the top
        x += f.x * (i ? 0.05 : -0.1) * tuck; z += f.z * (i ? 0.05 : -0.1) * tuck;
      }
      // slide tackle, the tucked leg (coaching references: the player lands on the hip and the outside of the bent leg, which
      // lies folded under the body like in a baseball slide): the shin lies on the turf across, under the thigh of the leading
      // leg, the knee points forward and out. The sim keeps this foot behind the body, which folded the knee upwards.
      if (slT && i !== this._slLead) {
        const T = this.adapt.slide, k = sm01(sl * 1.2);
        x += (s.px + f.x * T.tuckFwd - r.x * this._slSide * T.tuckIn - x) * k; z += (s.pz + f.z * T.tuckFwd - r.z * this._slSide * T.tuckIn - z) * k;
        h += (s.py + 0.05 - h) * k; yaw += this._slSide * 0.9 * k;
      }
      return { x, z, h, yaw, planted: ft.planted && !lifted && !stopping, u: ft.u || 0, top: !!ft.top };
    });
    const sup = feetT.map((ft) => (ft.planted ? 1 : 0));

    // ----- таз: высота и покачивание из клипа, ограничение — досягаемость опорных ног
    // landing: the legs take the fall — the deeper, the faster the player came down
    if (this._wasAir && !air && !fl) this.sp.squash = { x: (this.sp.squash ? this.sp.squash.x : 0), v: 0.8 + 0.75 * Math.max(0, -(this._vyAir || 0)) };
    this._wasAir = air; if (air) this._vyAir = aux.vy || 0;
    const squash = this._spring('squash', 0, 2.6, 0.7, dt);
    // standing still: the idle clip was captured with the actor shifting from foot to foot, while here the feet stay planted.
    // At full sway the pelvis ran into the straight-leg limit and bounced off it — the knees twitched (25° to 5° in a few frames).
    // So at rest the sway and the bob are damped and the stance sits a little lower: the knees keep a reserve
    const idleW = clamp(this.sp.wIdle ? this.sp.wIdle.x : 0, 0, 1) * (1 - gd);
    const crouch = 0.012 + 0.012 * run * (1 - wk) /* the run lands on a bent knee, not on a straight leg */ + KP.drop +Math.min(0.05, accMag * 0.0035) + (kPhase === 'windup' || kPhase === 'swing' ? 0.02 + 0.02 * kc : 0)
      + (feetT[0].top || feetT[1].top ? 0.03 : 0) + Math.max(0, squash) + 0.15 * jpS + 0.1 * gd + SL.drop * sDrop + 0.3 * rc + drop + this.adapt.idleDrop * idleW + (0.01 + 0.026 * (1 - jb)) * jg; // juggling: soft knees between the touches, the body rises into every touch (the working leg meets the ball straight)
    const swayX = pose.hips.x * this.hipRestY * (1 - this.adapt.idleCalm * idleW);
    const hipBack = refW > 0.01 ? profile(KICK_REF.hipBack, this._kc) * refW : 0;
    const hipB = hipBack + 0.05 * jg + this.adapt.slide.hipBack * sHip - 0.1 * sUp; // slide: the pelvis trails behind, the leading leg stretches out to the ball // juggling: the pelvis stays behind the ball, the working leg reaches forward nearly straight
    const cx = s.px + r.x * -swayX + f.x * (leanF * 0.15 - hipB), cz = s.pz + r.z * -swayX + f.z * (leanF * 0.15 - hipB);
    let allowed = 9;
    const A0 = new THREE.Vector3();
    if (!air) {
      for (let i = 0; i < 2; i++) {
        const L = this.legs[i], ft = feetT[i];
        this.diag.cap[i] = 9;
        if (!ft.planted && ft.h > 0.03) continue;
        const jx = cx + r.x * L.side * this.hipHalf, jz = cz + r.z * L.side * this.hipHalf;
        this._ankle(L, ft, fo[i] < 0 ? 0.9 : Math.min(0, L.pitch) * wk, A0); // стопа позади может подняться на носок; в шаге передняя стоит на пятке
        const dh2 = (A0.x - jx) ** 2 + (A0.z - jz) ** 2;
        const Lmax = (L.l1 + L.l2) * 0.992;
        const cap = A0.y + Math.sqrt(Math.max(0.04, Lmax * Lmax - dh2)) - this.hipJointDy;
        this.diag.cap[i] = cap;
        allowed = Math.min(allowed, cap);
      }
      allowed = Math.max(allowed, this.hipRestY - 0.16 - 0.08 * gd - (SL.drop + 0.04) * sDrop - 0.22 * rc - 0.8 * lie);
    }
    // ходьба: у бегового клипа таз ниже всего в середине опоры, у шага — наоборот. Высоту задаёт сама опорная нога:
    // почти прямая, таз идёт над ней дугой — выше всего над стопой, ниже всего на двойной опоре
    const walkY = Math.min(allowed, this.hipRestY) - 0.008;
    const clipY0 = pose.hips.y < 1 ? pose.hips.y + (1 - pose.hips.y) * KICK_REF.pelvis * refW : pose.hips.y;
    const clipY = clipY0 + (0.985 - clipY0) * this.adapt.idleCalm * idleW;
    const pelT = Math.min((clipY * this.hipRestY - crouch) * (1 - wk) + walkY * wk, allowed);
    const pelvisY = s.py + this._spring('pelY', pelT, 8, 0.9, dt);
    this.diag.pelvisY = pelvisY;

    // ----- добор тазом в ударе по летящему мячу: бьющая нога не должна ни тянуться (стопа не достаёт до мяча),
    // ни складываться пополам (мяч слишком близко). Таз сдвигается к мячу или от него так, чтобы расстояние
    // тазобедренный сустав — голеностоп осталось в пределах legMin..legMax длины ноги; сдвиг не больше pelvisReach.
    let regX = 0, regZ = 0;
    // только в проносе и контакте: в замахе нога сложена намеренно, отодвигать от неё таз незачем
    const kPlanned = kPhase === 'windup' && kick.dyn && !kick.bike && kick.plan && kick.t > kick.windDur * 0.35;
    if (((kPhase === 'swing' || kPhase === 'curl') && kick.dyn && !kick.bike) || kPlanned) {
      const ad = this.adapt, ki = kickSide > 0 ? 1 : 0, L = this.legs[ki], LL = L.l1 + L.l2;
      const jx = cx + r.x * L.side * this.hipHalf, jz = cz + r.z * L.side * this.hipHalf, jy = pelvisY + this.hipJointDy;
      let dx, dy, dz;
      if (kPlanned) {
        // second half of the windup: the contact geometry is already known from the strike plan, so the pelvis
        // takes its place before the leg starts forward (during the swing itself there is no time left for it)
        const pl = kick.plan, pyC = pl.by - pl.hRel;
        dx = pl.bx - kick.ax * 0.2 - pl.sx - r.x * L.side * this.hipHalf; dz = pl.bz - kick.az * 0.2 - pl.sz - r.z * L.side * this.hipHalf;
        dy = pl.by - (pyC + (pelvisY - s.py) + this.hipJointDy);
      } else {
        this._ankle(L, feetT[ki], air ? 0.5 : 0.55, A0);
        dx = A0.x - jx; dz = A0.z - jz; dy = A0.y - jy;
      }
      const dh = Math.hypot(dx, dz) || 1e-6, d = Math.hypot(dh, dy);
      const want = clamp(d, ad.legMin * LL, ad.legMax * LL);
      const sh = clamp(dh - Math.sqrt(Math.max(0, want * want - dy * dy)), -ad.pelvisReach, ad.pelvisReach); // > 0 — к мячу
      regX = (dx / dh) * sh; regZ = (dz / dh) * sh;
      this.diag.kick.pelvis = sh;
    } else this.diag.kick.pelvis = 0;
    if (aux.reach && rc > 0.01) {
      // reach: pelvis shifts toward the stretched foot so the leg can actually get there
      const ft = feetT[aux.reach.foot], dx = ft.x - cx, dz = ft.z - cz, dh = Math.hypot(dx, dz) || 1e-6, sh = Math.min(0.32 * rc, dh * 0.4);
      regX += (dx / dh) * sh; regZ += (dz / dh) * sh;
    }
    const pvx = this._spring('pvX', regX, 14, 1, dt), pvz = this._spring('pvZ', regZ, 14, 1, dt);

    world('Hips', new THREE.Quaternion().setFromAxisAngle(r, -leanF * 0.6).multiply(_q.setFromAxisAngle(f, -leanS * 0.6)).multiply(twQ(-0.4)));
    B.Hips.position.copy(B.Hips.parent.worldToLocal(new THREE.Vector3(cx + pvx, pelvisY, cz + pvz)));

    // ----- ноги: двухзвенный IK к точкам стоп из симуляции, перекат стопы
    const H = new THREE.Vector3(), A = new THREE.Vector3(), dir = new THREE.Vector3(), bend = new THREE.Vector3(), knee = new THREE.Vector3(), axis = new THREE.Vector3(), v = new THREE.Vector3();
    const cA = new THREE.Vector3(), corr = new THREE.Vector3(), clipFootQ = new THREE.Quaternion(), hinge = new THREE.Vector3();
    const sf = clamp(speed / 3.5, 0.3, 1.15);
    const heel = Math.max(run, 0.85 * wk); // в шаге стопа ставится с пятки так же отчётливо, как в беге
    const bw = clamp((-(s.vx * f.x + s.vz * f.z) - 0.5) / 0.8, 0, 1); // доля движения спиной вперёд: перекат стопы идёт наоборот
    // legs from the run clip: in plain running the swing follows motion capture; anything that needs the foot in an exact
    // place (the ball at the feet, a kick, a stance, a slide, a jump) hands the leg back to the sim
    const locoT = s.gait && !air && !kick && !this._kOn && !g && !fl && !aux.slide && !aux.reach && !aux.juggle && !aux.guard
      ? (aux.withBall ? this.adapt.legBall : this.adapt.legFree) * clamp((speed - 1.6) / 0.8, 0, 1) : 0;
    const locoK = clamp(this._spring('locoLeg', locoT, 4, 1, dt), 0, 1);
    this.diag.loco = locoK;
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i], ft = feetT[i];
      const ff = new THREE.Vector3(Math.cos(ft.yaw), 0, Math.sin(ft.yaw));
      const fr = new THREE.Vector3(-ff.z, 0, ff.x);
      const isKickFoot = kicking && ((kick.footSide > 0) === (i === 1));
      const behind = fo[i] < 0;
      L.up.getWorldPosition(H);
      // dmin — колено сгибается не больше чем на 150° (угол между бедром и голенью не меньше 30°): дальше — уже сквозь ногу
      const dmax = (L.l1 + L.l2) * 0.999, dmin = Math.sqrt(L.l1 * L.l1 + L.l2 * L.l2 - 2 * L.l1 * L.l2 * Math.cos(0.52));
      let pitch; // > 0 — пятка вверх (носок вниз), < 0 — носок на себя
      if (ft.planted) {
        pitch = 0;
        if (behind) {
          // толчок: пятка поднимается вокруг носка по мере ухода стопы назад — и не меньше, чем нужно ноге, чтобы дотянуться
          // спиной вперёд эта стопа — ведущая: она только что встала, с носка, и толкаться ей ещё рано
          const natural = clamp((-fo[i] - 0.06) / 0.3, 0, 1) * 0.85 * Math.max(run, 0.35) * (1 - bw) + 0.14 * bw * clamp(-fo[i] / 0.25, 0, 1);
          for (; pitch < 1.0; pitch += 0.05) { if (this._ankle(L, ft, pitch, A).distanceTo(H) <= dmax) break; }
          pitch = Math.max(pitch, natural);
        } else if (fo[i] > 0.08 && heel > 0.25) pitch = -0.34 * clamp((fo[i] - 0.08) / 0.18, 0, 1) * heel * (1 - bw); // постановка с пятки
        // спиной вперёд стопа перед корпусом — толчковая: пятка поднимается, толчок идёт с носка
        if (!behind && bw > 0.01) pitch += 0.55 * bw * clamp((fo[i] - 0.05) / 0.3, 0, 1);
        // без скачка в момент постановки и отрыва
        L.pitch += (pitch - L.pitch) * (dt > 0 ? Math.min(1, 30 * dt) : 1);
        if (!behind || L.pitch > pitch) pitch = L.pitch; else L.pitch = pitch;
      } else {
        const u = ft.u;
        let target = u < 0.62 ? 0.3 + 0.95 * sf * Math.sin(Math.PI * u / 0.62) * (1 - 0.3 * u) : -0.36 * Math.max(sf, heel) * ((u - 0.62) / 0.38); // захлёст, затем носок на себя
        target += (0.22 - target) * bw; // спиной вперёд: без захлёста, стопа идёт низко и почти ровно
        if (ft.top) target *= 1 - u; // подошва ложится на мяч плоско
        if (isKickFoot) target = 0.55;
        if (aux.juggle && (aux.juggle.side > 0) === (i === 1) && aux.juggle.swing) target = 0.12; // juggling: the instep meets the ball nearly level
        if (air) target = 0.5;
        if (sl > 0.3 && aux.slide) target = aux.slide.foot === i ? -0.25 : 0.7; // lead foot: toes up; trailing foot: laid back
        const k = dt > 0 ? Math.min(1, 26 * dt) : 1;
        L.pitch += (target - L.pitch) * k;
        pitch = L.pitch;
      }
      this.diag.pitch[i] = pitch;
      this._ankle(L, ft, pitch, A);
      // ----- бьющая нога из клипа: траектория голеностопа, направление колена и разворот стопы — как в motion capture;
      // симуляция только подтягивает стопу к точке контакта, и не дальше, чем на adapt.kickReach
      let legK = 0;
      const kClip = this._kClip;
      if (this.adapt.kickLeg && this._kLeg && kClip.feet && (this._kSide > 0) === (i === 1)) {
        // в удар нога входит быстро, а из проводки на покрытие опускается плавно — иначе стопа падает рывком
        if (!this.sp.kLeg) this.sp.kLeg = { x: 0, v: 0 }; // первый удар (после запуска или сброса) входит из нуля, а не скачком
        legK = clamp(this._spring('kLeg', this._kOn ? 1 : 0, this._kOn ? 9 : 2.5, 1, dt), 0, 1);
        if (legK > 0.01) {
          const ad = this.adapt, kcNow = this._kc, sm = (x) => { const y = clamp(x, 0, 1); return y * y * (3 - 2 * y); };
          // вес симуляции: к контакту — полный (стопа точно у мяча), в проводке нога снова идёт по клипу;
          // на покрытие её возвращает затухание самого клипа удара (legK), а не эта поправка
          const sim = kcNow < 0 ? sm((kcNow + ad.simLead) / ad.simLead) : 1 - (1 - ad.simAfter) * sm(kcNow / ad.simHold);
          clipFoot(kClip, kClip.contact + kcNow, i, (kClip.kickFoot === 'R') !== (this._kSide > 0), cA);
          cA.applyQuaternion(yawQ).multiplyScalar(L.l1 + L.l2).add(H);
          cA.y = Math.max(cA.y, s.py + L.toeH + 0.04); // стопа из клипа не уходит под покрытие
          corr.subVectors(A, cA).multiplyScalar(sim);
          const cl = corr.length(), cut = Math.max(0, cl - ad.kickReach);
          if (cut > 0) corr.multiplyScalar(ad.kickReach / cl);
          const D = this.diag.kick; D.corr = cl; D.cut = cut; D.legK = legK; D.sim = sim;
          A.lerp(cA.add(corr), legK);
          clipFootQ.copy(yawQ).multiply(pose.get(L.name + 'Foot')).multiply(L.footRest);
        }
      }
      if (legK <= 0.01 && (this._kSide > 0) === (i === 1)) { const D = this.diag.kick; D.corr = D.cut = D.legK = D.sim = 0; }
      if (legK <= 0.01 && locoK > 0.01 && !ft.planted) {
        // the window closes at both ends of the swing: the foot leaves the turf and comes back to it exactly where the sim says
        const wS = locoK * sm01(ft.u / 0.25) * sm01((1 - ft.u) / 0.3);
        if (wS > 0.01) {
          cA.copy(L.restDir).applyQuaternion(_q.copy(yawQ).multiply(pose.get(L.name + 'UpLeg'))).multiplyScalar(L.l1);
          cA.addScaledVector(corr.copy(L.shinDir).applyQuaternion(_q.copy(yawQ).multiply(pose.get(L.name + 'Leg'))), L.l2).add(H);
          cA.y = Math.max(cA.y, A.y); // the clip is a jog: at speed the heel comes up higher than in it
          A.lerp(cA, wS);
          legK = wS;
          clipFootQ.copy(yawQ).multiply(pose.get(L.name + 'Foot')).multiply(L.footRest);
        }
      }
      // Голеностоп. Стопа ставится в осях поля (ровно, с наклоном pitch) или по клипу — и то и другое ничего не знает
      // о голени: у перевёрнутого в ударе через себя тела стопа выламывалась к голени на 55°, в ударе с лёта — оттягивалась
      // на 90° и скручивалась вбок на 70°. В воздухе и в махе ноги стопа ограничена живым ходом голеностопа относительно
      // голени; на весу в полёте она расслаблена — носок слегка оттянут. Опорная стопа лежит на покрытии и не трогается;
      // предел входит и выходит плавно (окно маха, вес полёта и удара), поэтому стопа не перескакивает
      const flying = air || (!!fl && fl.phase === 'air') || (kicking && kick.bike) ? 1 : 0;
      const aw = L.aw = L.aw == null ? flying : L.aw + (flying - L.aw) * (dt > 0 ? Math.min(1, 10 * dt) : 1); // после склейки — сразу по позе
      const putFoot = (q) => {
        // вес предела меняется плавно: на отрыве в удар с лёта симуляция ставит стопу в опору посреди маха, и предел
        // выключался за кадр (стопа поворачивалась на 46°)
        const lwT = ft.planted ? aw : Math.max(aw, sm01(ft.u / 0.2) * sm01((1 - ft.u) / 0.2), L.kw || 0), kw = L.kw || 0;
        const limW = L.lw = L.lw == null ? lwT : L.lw + (lwT - L.lw) * (dt > 0 ? Math.min(1, (lwT > L.lw ? 12 : 5) * dt) : 1);
        if (legK > 0.01) q.slerp(clipFootQ, legK);
        if (limW > 0.01) {
          const lo = -0.6 + (0.1 + 0.6) * aw, hi = 1.0 - 0.15 * aw, tw = 0.4 - 0.2 * Math.max(aw, kw);
          this._ankleLimit(L, q, knee, A, axis, lo + (-0.25 - lo) * kw, hi + (0.95 - hi) * kw, tw, limW);
        }
        setWorldQuat(L.foot, q);
      };
      v.subVectors(A, H);
      let dist = v.length();
      this.diag.reachErr[i] = Math.max(0, dist - dmax);
      if (dist > dmax) { A.copy(H).addScaledVector(v, dmax / dist); dist = dmax; }
      if (dist < dmin) { if (dist > 1e-4) A.copy(H).addScaledVector(v, dmin / dist); dist = dmin; } // стопа не подтягивается к тазу ближе предела сгиба
      dir.subVectors(A, H).normalize();
      bend.copy(ff).multiplyScalar(0.5).addScaledVector(f, 0.5).addScaledVector(r, L.side * 0.12);
      if (tilted) bend.applyQuaternion(bodyQ); // «вперёд» для колена — по корпусу, а корпус наклонён
      const tuck = slT && i !== this._slLead ? sm01(sl * 1.2) : 0;
      if (tuck > 0) bend.multiplyScalar(1 - tuck).addScaledVector(r, this._slSide * 1.0 * tuck).addScaledVector(f, 0.45 * tuck).addScaledVector(UP, -0.1 * tuck); // the tucked knee lies out to the side, on the turf
      if (sideFall) bend.addScaledVector(cA.copy(UP).applyQuaternion(bodyQ), 0.45); // in a fall or a spin the hint never degenerates: a leg pointing along the body front bends with the knee towards the chest
      // бьющая нога на весу: колено смотрит вверх и наружу, а не строго вперёд — иначе бедро выворачивается
      // kick-leg weight fades out smoothly after the kick: the knee hint must not jump on the frame the kick ends
      const kw = L.kw = (L.kw || 0) + ((isKickFoot ? 1 : 0) - (L.kw || 0)) * (dt > 0 ? Math.min(1, (isKickFoot ? 30 : 6) * dt) : 1);
      if (kw > 0.01) bend.multiplyScalar(1 - 0.6 * Math.min(1, KP.high) * kw).addScaledVector(UP, KP.kneeUp * kw).addScaledVector(r, L.side * KP.kneeOut * kw);
      // side volley: the leg whips around the hip in a near-horizontal plane, the knee leads the shin - so the knee looks
      // along the travel of the foot (tangent to its arc), not up or down; otherwise it flips when the leg passes hip level
      if (isKickFoot) L.kDyn = !!kick.dyn && !kick.bike;
      if (kw > 0.01 && L.kDyn && KP.high > 0.2) {
        cA.crossVectors(dir, UP).multiplyScalar(-L.side); cA.y += 0.25;
        if (cA.lengthSq() > 0.02) bend.normalize().lerp(cA.normalize(), kw * Math.min(1, (KP.high - 0.2) * 2));
      }
      // колено бьющей ноги смотрит туда же, куда бедро в клипе
      // Направление колена задаёт только часть бедра поперёк линии бедро — стопа. Когда нога в клипе почти прямая, этой
      // части почти нет и её направление случайно (колено разворачивалось на 77° за кадр после навеса) — тогда клип не берётся
      if (legK > 0.01) {
        cA.copy(L.restDir).applyQuaternion(_q.copy(yawQ).multiply(pose.get(L.name + 'UpLeg')));
        cA.addScaledVector(dir, -cA.dot(dir));
        const m = cA.length(), wC = legK * sm01((m - 0.05) / 0.15);
        if (wC > 0.01) bend.multiplyScalar(1 - 0.9 * wC).addScaledVector(cA, 2 * wC / m);
      }
      // длина подсказки до нормировки: слагаемые (поза удара, клип, правило удара с лёта) иногда почти гасят друг друга,
      // и направление короткого вектора случайно — такой подсказке колено почти не следует (иначе скачок на 50° за кадр)
      bend.addScaledVector(dir, -bend.dot(dir));
      let hintLen = bend.length();
      bend.normalize();
      // анатомия колена: оно сгибается только вперёд-вверх относительно корпуса и не перескакивает за кадр.
      // Какой бы ни была подсказка (клип, удар, шаг), колено позади линии бедро — стопа не допускается.
      // the remembered knee direction turns with the body: otherwise a fast spin leaves it behind and the knee pops
      // Удар через себя и падение на спину: тело перевёрнуто, «вперёд» и «вниз» мира для колена ничего не значат.
      // Колено лежит в плоскости таза и повёрнуто от линии бедро — стопа на 90° к груди: нога висит — колено вперёд,
      // нога поднята перед собой — колено к голове, нога позади — колено вниз-вперёд. Направление непрерывно при любом
      // махе ноги, поэтому не перескакивает (раньше подсказка в осях мира гнула колено назад и разворачивала его за кадр)
      const sag = (fl && !sideFall) || (kicking && kick.bike);
      if (sag) {
        const Rb = cA.copy(r); if (tilted) Rb.applyQuaternion(bodyQ);
        const Ub = corr.copy(UP); if (tilted) Ub.applyQuaternion(bodyQ);
        const Fb = knee.copy(f); if (tilted) Fb.applyQuaternion(bodyQ);
        const s = v.crossVectors(Rb, Ub).dot(Fb) > 0 ? -1 : 1; // знак, при котором висящая нога (dir = −Ub) даёт колено вперёд (Fb)
        bend.crossVectors(Rb, dir).multiplyScalar(s).addScaledVector(Rb, L.side * 0.1);
        bend.addScaledVector(dir, -bend.dot(dir));
        if (bend.lengthSq() < 1e-6) bend.copy(Fb);
        bend.normalize();
        hintLen = 1;
      }
      if (L.pole && dYaw) L.pole.applyAxisAngle(UP, -dYaw);
      if (L.pole && dt > 0) { bend.lerpVectors(L.pole, bend, Math.min(1, this.adapt.kneeRate * dt * (0.15 + 0.85 * sm01((hintLen - 0.1) / 0.4)))); bend.addScaledVector(dir, -bend.dot(dir)).normalize(); }
      // a leg stretched out behind the body (flight, landing on the other leg) can only bend with the knee below the
      // hip-ankle line; the usual 'forward and up' rule would flip it there
      const fB = tilted ? cA.copy(f).applyQuaternion(bodyQ) : f, backw = L.bw = (L.bw || 0) + ((fl && !sag ? clamp(-dir.dot(fB) * 1.5, 0, 1) : 0) - (L.bw || 0)) * (dt > 0 ? Math.min(1, 12 * dt) : 1); // eased: no knee pop when the leg comes back under the body
      if (backw > 0) bend.addScaledVector(UP, -1.2 * backw).addScaledVector(dir, 0).addScaledVector(dir, -bend.dot(dir)).normalize();
      hinge.copy(f).addScaledVector(UP, 0.6 - 1.8 * backw); if (tilted) hinge.applyQuaternion(bodyQ); hinge.addScaledVector(dir, -hinge.dot(dir));
      if (hinge.lengthSq() > 1e-6 && !sag) {
        // предел — после сглаживания: он жёсткий, сглаживание не может оставить колено позади
        hinge.normalize();
        // у ноги, отведённой в сторону для удара с лёта, колено смотрит наружу — предел для неё только «не назад»
        const front = bend.dot(hinge), need = this.adapt.kneeFront * (1 - 0.9 * Math.min(1, KP.high) * kw);
        if (front < need && tuck < 0.5) bend.addScaledVector(hinge, need - front).normalize(); // (the tucked leg of the slide lies on its side: the forward-and-up rule would stand its knee upright)
      }
      (L.pole || (L.pole = new THREE.Vector3())).copy(bend);
      const cosA = clamp((L.l1 * L.l1 + dist * dist - L.l2 * L.l2) / (2 * L.l1 * dist), -1, 1);
      knee.copy(H).addScaledVector(dir, L.l1 * cosA).addScaledVector(bend, L.l1 * Math.sqrt(1 - cosA * cosA));
      axis.crossVectors(bend, dir);
      setWorldQuat(L.thigh.bone, basisQuat(v.subVectors(knee, H).normalize(), axis, _q).multiply(L.thigh.k));
      setWorldQuat(L.shin.bone, basisQuat(v.subVectors(A, knee).normalize(), axis, _q).multiply(L.shin.k));
      if (isKickFoot && KP.along > 0.05) {
        // стопа продолжает линию голени с оттянутым носком и смотрит по направлению удара
        const shin = v.subVectors(A, knee).normalize();
        const fwdDir = new THREE.Vector3().copy(shin).multiplyScalar(0.75).addScaledVector(f, 0.65).normalize();
        const upDir = new THREE.Vector3().copy(shin).multiplyScalar(-1).addScaledVector(UP, 0.4);
        const zAx = fwdDir, xAx = new THREE.Vector3().crossVectors(upDir, zAx).normalize(), yAx = new THREE.Vector3().crossVectors(zAx, xAx);
        const des = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(xAx, yAx, zAx));
        const flat = _q.setFromAxisAngle(fr, -pitch).multiply(this._yawQuat(ft.yaw, _q2));
        // покой стопы задан в осях «вперёд = +Z модели»: переводим желаемую ориентацию в те же оси
        const restFrame = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(new THREE.Vector3().crossVectors(UP, this.F0).normalize(), UP, this.F0));
        des.multiply(restFrame.invert()).multiply(L.footRest);
        putFoot(flat.multiply(L.footRest).slerp(des, Math.min(1, KP.along)));
      } else {
        const footQ = _q.setFromAxisAngle(fr, -pitch).multiply(this._yawQuat(ft.yaw, _q2)).multiply(L.footRest);
        putFoot(footQ);
      }
    }

    // ----- корпус, плечи, руки: поза из motion capture; сверху — добавочный наклон, растущий к груди
    const part = (k, tw) => new THREE.Quaternion().setFromAxisAngle(r, -leanF * k).multiply(_q.setFromAxisAngle(f, -leanS * k)).multiply(twQ(tw));
    world('Spine', part(0.75, 0.1), curl[0]); world('Spine1', part(0.9, 0.55), curl[1]); world('Spine2', addQ, curl[2]);
    world('LeftShoulder', addQ, curl[2]); world('RightShoulder', addQ, curl[2]);
    world('LeftArm', armQ[0].upper); world('LeftForeArm', armQ[0].fore); world('LeftHand', armQ[0].fore);
    world('RightArm', armQ[1].upper); world('RightForeArm', armQ[1].fore); world('RightHand', armQ[1].fore);

    // ----- падение: рука встречает покрытие и служит опорой при подъёме. Работает рука с нижней стороны (на спине — обе):
    // в воздухе после удара кисть тянется к покрытию под плечом, с приземления стоит на месте, пока корпус на ней приподнимается
    const handFall = !!fl && !sideFall; // after the side volley the player lands on his feet: the arms balance, they do not go to the turf // после удара сбоку рука тянется к покрытию на посадке
    const handSlide = slT && sl > 0.15;
    const handAim = !!aux.hand && aux.hand.w > 0.01 && !handFall && !handSlide; // рука тянется к заданной точке (рукопожатие)
    if (handFall || handSlide || handAim || this._armW) {
      const aw = this._armW || (this._armW = [0, 0]), hT = this._handT || (this._handT = [new THREE.Vector3(), new THREE.Vector3()]);
      const S = [B.LeftArm.getWorldPosition(new THREE.Vector3()), B.RightArm.getWorldPosition(new THREE.Vector3())];
      const sp = B.Spine2.getWorldPosition(new THREE.Vector3()), chest = new THREE.Vector3().copy(f).applyQuaternion(bodyQ);
      const lowY = Math.min(S[0].y, S[1].y), ground = s.py > 0.001 ? 0 : 0; // покрытие — на нуле
      let any = false;
      for (let i = 0; i < 2; i++) {
        const names = i ? ['RightArm', 'RightForeArm', 'RightHand'] : ['LeftArm', 'LeftForeArm', 'LeftHand'];
        let wT = 0;
        if (handFall) {
          const lower = clamp(1 - (S[i].y - lowY) / 0.25, 0, 1); // рука с нижней стороны тела
          if (sideFall) wT = lower * (1 - sm01((fl.t - 0.2) / 0.22));
          else if (fl.phase === 'air') wT = !kick ? lower * clamp(1 - (S[i].y - 0.75) / 0.6, 0, 1) : 0;
          else if (fl.phase === 'down') wT = lower;
          else wT = lower * sm01((fl.k - 0.45) / 0.2);
          if (fl.phase === 'air' || !this._handSet) {
            // точка опоры: под плечом, чуть наружу от корпуса и к стопам; на боку — перед грудью
            const out = new THREE.Vector3(S[i].x - sp.x, 0, S[i].z - sp.z); if (out.length() > 0.05) out.normalize(); else out.set(0, 0, 0);
            hT[i].set(S[i].x, ground + 0.05, S[i].z).addScaledVector(out, 0.2).addScaledVector(v.set(fl.ux, 0, fl.uz), 0.12).addScaledVector(v.set(chest.x, 0, chest.z), sideFall ? 0.28 : 0);
          }
        }
        if (handSlide && (i ? 1 : -1) === this._slSide) {
          // the hand on the turf side: on the ground beside the hip, a little behind — it takes the weight and pushes the body up
          wT = sm01(sl * 1.4);
          hT[i].set(S[i].x, ground + 0.05, S[i].z).addScaledVector(r, this._slSide * 0.2).addScaledVector(f, -0.1);
        }
        if (handAim && i === aux.hand.i) { wT = aux.hand.w; hT[i].set(aux.hand.x, aux.hand.y, aux.hand.z); }
        const w = aw[i] = clamp(aw[i] + (wT - aw[i]) * (dt > 0 ? Math.min(1, 12 * dt) : 1), 0, 1);
        if (w < 0.01) continue;
        any = true;
        const E = B[names[1]].getWorldPosition(new THREE.Vector3()), Hd = B[names[2]].getWorldPosition(new THREE.Vector3());
        const l1 = E.distanceTo(S[i]), l2 = Hd.distanceTo(E);
        const to = new THREE.Vector3().subVectors(hT[i], S[i]);
        const d = clamp(to.length(), Math.abs(l1 - l2) + 0.03, (l1 + l2) * 0.985); to.normalize();
        // локоть смотрит назад от груди и наружу — как у руки, на которую опираются
        const pole = new THREE.Vector3().copy(chest).multiplyScalar(-0.7).addScaledVector(UP, 0.35).addScaledVector(v.set(S[i].x - sp.x, 0, S[i].z - sp.z), 1.2);
        if (handAim && i === aux.hand.i) pole.set(0, -0.8, 0).addScaledVector(v.set(S[i].x - sp.x, 0, S[i].z - sp.z), 2.2).addScaledVector(chest, -0.2); // рукопожатие: локоть вниз и чуть наружу
        pole.addScaledVector(to, -pole.dot(to)); if (pole.lengthSq() < 1e-4) pole.set(0, 1, 0).addScaledVector(to, -to.y); pole.normalize();
        const ca = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
        const elbow = new THREE.Vector3().copy(S[i]).addScaledVector(to, l1 * ca).addScaledVector(pole, l1 * Math.sqrt(1 - ca * ca));
        // the elbow must not go under the turf: turn the bend plane upwards until it clears
        for (let n = 0; n < 4 && elbow.y < 0.07; n++) {
          pole.addScaledVector(UP, 0.6); pole.addScaledVector(to, -pole.dot(to)).normalize();
          elbow.copy(S[i]).addScaledVector(to, l1 * ca).addScaledVector(pole, l1 * Math.sqrt(1 - ca * ca));
        }
        const hand = new THREE.Vector3().copy(S[i]).addScaledVector(to, d);
        const aim = (bone, from, cur, des) => {
          const a = new THREE.Vector3().subVectors(cur, from).normalize(), b2 = new THREE.Vector3().subVectors(des, from).normalize();
          const wq = bone.getWorldQuaternion(new THREE.Quaternion());
          setWorldQuat(bone, new THREE.Quaternion().setFromUnitVectors(a, b2).multiply(wq).slerp(wq, 1 - w).normalize());
        };
        aim(B[names[0]], S[i], E, elbow);
        const E2 = B[names[1]].getWorldPosition(new THREE.Vector3()), H2 = B[names[2]].getWorldPosition(new THREE.Vector3());
        aim(B[names[1]], E2, H2, hand);
      }
      if (handFall) this._handSet = fl.phase !== 'air'; else { this._handSet = false; if (!any) this._armW = null; }
    }

    // ----- голова: поза клипа плюс взгляд на мяч с небольшой инерцией
    let lookT = 0, lookP = 0;
    if (aux.ball) {
      const dd = Math.hypot(aux.ball.x - s.px, aux.ball.z - s.pz);
      const w = dd > 7 ? 0.45 : 1;
      lookT = clamp(angDiff(Math.atan2(aux.ball.z - s.pz, aux.ball.x - s.px), th), -1.15, 1.15) * 0.7 * w;
      lookP = clamp(Math.atan2(1.65 + s.py - aux.ball.y, Math.max(0.5, dd)), -0.5, 0.75) * 0.45 * w;
    }
    const look = this._spring('look', lookT, 4, 0.85, dt);
    const lookPitch = this._spring('lookP', lookP, 4, 0.85, dt);
    world('Neck', part(1, 0.4), curl[3]);
    // поворот к мячу: вокруг вертикали (в осях сцены положительный угол рыскания — по часовой сверху)
    const headExtra = new THREE.Quaternion().setFromAxisAngle(UP, -look).multiply(_q.setFromAxisAngle(r, -(lookPitch + leanF * 0.5) + (g && g.type === 'head' ? 0.35 * gw : 0))).multiply(_q2.setFromAxisAngle(f, -leanS * 0.5));
    world('Head', headExtra, curl[4]);
    this._getupLayer(s, aux, dt, f, r);
  }

  // ---------- падение на спину и подъём по клипу «Getting Up» (поверх процедурной позы, все кости)
  // После удара, ещё в полёте, тело за 0,3 с принимает позу «на спину»: стартовая поза клипа (сидя, колени согнуты),
  // откинутая назад вокруг таза — ноги вверх, корпус лёжа. Таз опускается к покрытию вместе с падением в симуляции (fall.k).
  // Затем тело перекатывается вперёд и садится ровно в стартовую позу клипа; с фазой rise клип играет кусок getup.rise за
  // время фазы, а по её концу слой гаснет за 0,3 с в обычную стойку. Симуляция ставит стопы и таз по той же таблице клипа
  // (profile.getup), поэтому стыки поз — без скачка. Кисти и локти не уходят под покрытие: рука доворачивается в плече.
  _getupLayer(s, aux, dt, f, r) {
    const fl = aux.fall, G = CLIPS.getup, back = !!fl && fl.kind === 'back';
    const air = back && fl.phase === 'air' && !aux.kick, on = back && (fl.phase === 'down' || fl.phase === 'rise');
    const sm01 = (x) => { const y = clamp(x, 0, 1); return y * y * (3 - 2 * y); };
    const st = this._gu || (this._gu = { x: 0, z: 0, yaw: 0, roll: 0, rw: 0, hw: 0, t: 0 });
    let e = 0, rollE = 0, tc = G.rise.from, follow = false;
    if (air || on) {
      st.yaw = fl.yaw; st.roll = fl.roll || 0;
      st.rw = Math.min(1, st.rw + (dt > 0 ? dt / 0.3 : 1));
      if (fl.phase === 'rise') {
        tc = G.rise.from + clamp(fl.t / (fl.dur || 1), 0, 1) * (G.rise.to - G.rise.from); st.hw = 1;
        if (fl.gx !== undefined) { st.x = fl.gx; st.z = fl.gz; }
      } else {
        // на спине треть фазы down после касания, затем перекат вперёд в сед к её концу
        const dn = fl.dur || 0.4, lie = fl.phase === 'air' ? 1 : 1 - sm01((fl.t - 0.35 * dn) / (0.65 * dn));
        e = 0.6 * lie; rollE = st.roll * 0.45 * lie;
        st.hw = fl.phase === 'down' ? clamp(fl.k, 0, 1) : 0; st.x = s.px; st.z = s.pz; // fl.k уже идёт по ускорению падения
      }
      st.t = tc;
    } else {
      // слой гаснет за 0,3 с (на ходу — за 0,15 с), уже под управлением: таз и разворот — за игроком, а не в точке подъёма
      if (st.rw <= 0) return;
      const moving = Math.hypot(s.vx, s.vz) > 0.5;
      st.rw = Math.max(0, st.rw - (dt > 0 ? dt / (moving ? 0.15 : 0.3) : 1)); st.hw = Math.min(st.hw, st.rw);
      if (st.rw <= 0) return;
      tc = st.t; follow = true;
    }
    this._guW = st.rw;
    const Wr = sm01(st.rw), Wh = on ? st.hw : sm01(st.hw);
    const B = this.bones, R = this.rest, P = this._guPose || (this._guPose = new PoseBlend()), H = this.hipRestY;
    P.reset(); P.add(G, tc, 1); P.finish();
    const th = follow ? s.yaw : st.yaw, ff = _x.set(Math.cos(th), 0, Math.sin(th)), rr = _z.set(-ff.z, 0, ff.x);
    const yawQ = this._yawQuat(th, new THREE.Quaternion());
    // откат на спину — поворот всего тела вокруг таза: назад вокруг поперечной оси и набок вокруг продольной
    // (руки набок не заваливаются: на боку нижняя рука уходила под корпус и проворачивалась, 91° за кадр)
    const Eb = new THREE.Quaternion().setFromAxisAngle(rr, e), E = Eb.clone().multiply(_q.setFromAxisAngle(ff, rollE));
    const hp = follow ? new THREE.Vector3(s.px, P.hips.y * H, s.pz) // симуляция уже стоит в тазе клипа
      : new THREE.Vector3(st.x, P.hips.y * H, st.z).addScaledVector(rr, -P.hips.x * H).addScaledVector(ff, P.hips.z * H);
    // процедурная поза — до правки: смешиваются мировые повороты
    const cur = this._guCur || (this._guCur = CLIP_ORDER.map(() => new THREE.Quaternion()));
    CLIP_ORDER.forEach((name, i) => B[name].getWorldQuaternion(cur[i]));
    const hip0 = B.Hips.getWorldPosition(new THREE.Vector3());
    CLIP_ORDER.forEach((name, i) => {
      const q = _q2.copy(/Arm|Hand/.test(name) ? Eb : E).multiply(yawQ).multiply(P.get(name)).multiply(R[name].q);
      setWorldQuat(B[name], Wr < 1 ? cur[i].slerp(q, Wr) : q);
      if (name === 'Hips') B.Hips.position.copy(B.Hips.parent.worldToLocal(hip0.lerp(hp, Wh)));
    });
    // кисть — не ниже покрытия (+3 см): рука целиком поворачивается в плече в вертикальной плоскости, где лежит кисть,
    // форма руки сохраняется — при быстром падении кисть отъезжает по покрытию от плеча. Поворот вокруг заданной оси
    // (продольной, линии плечо — кисть для локтя) двузначен: у нижней точки окружности решение перескакивало, и предплечье
    // проворачивалось на 90–300° за кадр. Здесь ось горизонтальна и поперёк направления на кисть — она вырождается только
    // для кисти точно под плечом, а там кисть до покрытия не достаёт
    ['Left', 'Right'].forEach((side) => {
      const arm = B[side + 'Arm'], S = arm.getWorldPosition(_v1), J = B[side + 'Hand'].getWorldPosition(_v2);
      if (J.y >= 0.03) return;
      const d0 = _v3.subVectors(J, S), len = d0.length(), hz = Math.hypot(d0.x, d0.z);
      if (hz < 1e-3) return;
      const yT = Math.max(-len * 0.98, Math.min(len * 0.98, 0.03 - S.y)), k = Math.sqrt(Math.max(0, len * len - yT * yT)) / hz;
      _q4.setFromUnitVectors(d0.normalize(), _v4.set(d0.x * k, yT / len, d0.z * k).normalize());
      setWorldQuat(arm, _q4.multiply(arm.getWorldQuaternion(new THREE.Quaternion())));
    });
  }

  // Предел голеностопа относительно голени: подъём стопы (от положения покоя; > 0 — носок оттянут) в [lo, hi], скрут
  // носка из плоскости сгиба колена — не больше tw (рад). Стопа доворачивается кратчайшим поворотом носка, с весом w.
  _ankleLimit(L, q, knee, A, axis, lo, hi, tw, w) {
    const s = _v1.subVectors(A, knee).normalize(), n = _v2.crossVectors(s, axis).normalize();
    const t = _v3.copy(L.toeRest).applyQuaternion(_q4.copy(q).multiply(L.footRestInv));
    const tAx = clamp(t.dot(axis), -1, 1), twist = Math.asin(tAx);
    // угол стопы — по кругу: исходная стопа (ровно к полю у перевёрнутого тела) может смотреть назад, и простой предел
    // перебрасывал её через ±180° с «носок оттянут» на «носок на себя» (скачок 67° за кадр). Вне хода стопа держится
    // у той границы, через которую вышла, пока не вернётся в ход
    const PI2 = Math.PI * 2, span = hi - lo;
    let th = Math.atan2(t.dot(s), t.dot(n)) - L.ankle0, dd = (((th - lo) % PI2) + PI2) % PI2, th2;
    if (dd <= span) { th = th2 = lo + dd; L.ankSide = dd > span / 2 ? 1 : -1; }
    else { th = lo + dd; th2 = (L.ankSide || (dd - span < PI2 - dd ? 1 : -1)) > 0 ? hi : lo; }
    const tw2 = clamp(twist, -tw, tw);
    if (th2 === th && tw2 === twist) return q;
    const c = Math.cos(tw2), a = th2 + L.ankle0;
    const t2 = _v4.copy(n).multiplyScalar(c * Math.cos(a)).addScaledVector(s, c * Math.sin(a)).addScaledVector(axis, Math.sin(tw2));
    _q4.setFromUnitVectors(t, t2.normalize());
    if (w < 1) _q4.slerp(_qI, 1 - w);
    return q.premultiply(_q4);
  }

  // Положение голеностопа при наклоне стопы: pitch > 0 — вокруг подушечки (пятка вверх),
  // pitch < 0 — вокруг пятки (носок на себя). Точка контакта с покрытием остаётся на месте.
  _ankle(L, ft, pitch, out) {
    const fx = Math.cos(ft.yaw), fz = Math.sin(ft.yaw);
    let along, y;
    if (pitch >= 0) {
      const back = L.toeFwd, up = L.ankleH - L.toeH, c = Math.cos(pitch), sn = Math.sin(pitch);
      along = (L.toeFwd - this.ankleFwd) - back * c + up * sn;
      y = ft.h + L.toeH + back * sn + up * c;
    } else {
      const q = -pitch, a = this.heelBack - this.ankleFwd, c = Math.cos(q), sn = Math.sin(q);
      along = -this.heelBack + a * c - L.ankleH * sn;
      y = ft.h + a * sn + L.ankleH * c;
    }
    return out.set(ft.x + fx * along, y, ft.z + fz * along);
  }

  // Диагностика опоры по костям после IK: подушечка стопы должна оставаться на покрытии
  measureFeet(out = [{}, {}]) {
    if (!this.ready) return out;
    const v = new THREE.Vector3();
    this.legs.forEach((L, i) => {
      L.toe.getWorldPosition(v);
      out[i].soleErr = v.y - L.toeH; out[i].x = v.x; out[i].z = v.z; out[i].pitch = this.diag.pitch[i];
    });
    return out;
  }
}
