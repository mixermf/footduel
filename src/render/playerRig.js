// Процедурная поза футболиста поверх скелета player.glb (клипов в модели нет).
// Симуляция задаёт положения стоп и корпуса; риг только показывает их: IK ног, наклон, руки, голова.
// Кости ставятся в мировых осях: Q = B(желаемый) * B(покой)^-1 * Q(покой) — без догадок о локальных осях Mixamo.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import modelUrl from '../../assets/player/player.glb?url';
import { CLIPS, PoseBlend, strikePhase, UPPER_BODY, clipFoot } from './mocap.js';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
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
      antLead: 0.55, antFull: 0.2, pelvisReach: 0.18, legMin: 0.9, legMax: 0.97 }; // поза удара начинает набираться за antLead с до контакта и набрана полностью за antFull с
    this._kLeg = false; this._kH = 0.11; this._kSideA = 0; this._kp = {};
    this.diag.plan = { w: 0, h: 0.11, tc: 0 }; // вес позы удара, высота контакта по плану, время до контакта
    this.diag.kick = { corr: 0, cut: 0, legK: 0, sim: 0 }; // длина поправки, срезанная часть, вес клипа в ноге, вес симуляции
  }

  // празднование гола: руки и корпус из клипа, пока игрок не начал удар
  celebrate() { this._cel = 0; }

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
        thigh: limb(n + 'UpLeg', n + 'Leg', legAxis), shin: limb(n + 'Leg', n + 'Foot', legAxis),
        up: B[n + 'UpLeg'], foot: B[n + 'Foot'], footRest: R[n + 'Foot'].q,
        l1: R[n + 'Leg'].p.distanceTo(R[n + 'UpLeg'].p), l2: R[n + 'Foot'].p.distanceTo(R[n + 'Leg'].p),
        pitch: 0, ankleH: R[n + 'Foot'].p.y, toe: B[n + 'ToeBase'], toeH: R[n + 'ToeBase'].p.y,
        toeFwd: (R[n + 'ToeBase'].p.x - R[n + 'Foot'].p.x) * F0.x + (R[n + 'ToeBase'].p.z - R[n + 'Foot'].p.z) * F0.z,
      };
    });
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
    this.ready = true;
    return this.info;
  }

  _yawQuat(theta, out) { return out.setFromAxisAngle(UP, Math.PI / 2 - theta - this.phi0); }

  // Пружина с затуханием: вторичное движение догоняет цель с небольшой инерцией
  // Цвет формы: оттенок умножается на текстуру футболки и шорт
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
    const w = 2 * Math.PI * hz, n = dt > 0.012 ? 2 : 1, h = dt / n;
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
    const loco = (clip, weight) => P.add(clip, (this._gp + strikePhase(clip)) * clip.duration, Math.max(0, weight));
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
      this._kc = -(kick.windDur - kick.t + (kick.dyn ? 0.09 : 0.075)); this._kSide = kick.footSide; this._kDyn = !!kick.dyn; this._kOn = true;
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
    const lobW = clamp(this._spring('lob', kick && kick.type === 'lob' && kicking ? 1 : 0, 7, 1, dt), 0, 1);
    // поверх клипов набора процедурные добавки рук и корпуса ослаблены: движение уже есть в самом клипе
    const kProc = this._kPack ? 0.35 : 1, gProc = this.packClips ? 0.35 : 1;
    // удар через себя: корпус заваливается назад, пока идёт удар и игрок в воздухе после него
    const bk = this._spring('bike', kick && kick.bike && kicking ? 1 : 0, 5, 0.95, dt); // защитная стойка: ниже, шире, руки в стороны

    // ----- план удара: симуляция заранее знает высоту и время контакта (kick.plan — прогноз полёта мяча до 0,8 с).
    // Поза выбирается по этой высоте из опорных поз и набирается за adapt.antLead секунд до контакта,
    // а не подгоняется по высоте стопы, когда нога уже пошла к мячу.
    const kickSide = kick ? kick.footSide : 0;
    let antT = 0, tc = 0;
    if (kick && !kick.bike) {
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
    let leanFT = clamp(0.015 * this._acc.f + 0.03 * run + 0.045 * Math.max(0, speed - 2.6), -0.26, 0.36);
    if (g && g.type === 'chest') leanFT -= 0.18 * gw;
    if (g && g.type === 'hit') leanFT -= 0.32 * gw; // непринятый мяч в корпус: игрока отбрасывает назад
    leanFT += 0.15 * gd;
    if (air && !kicking) leanFT -= 0.12; // в прыжке корпус выпрямляется, а не горбится
    const leanF = this._spring('leanF', leanFT, 3.4, 0.8, dt) - KP.back * (1 - bk) - 0.8 * bk + refLean - 0.5 * sl - 0.14 * lobW - 0.1 * rc;
    const leanS = this._spring('leanS', clamp(0.017 * this._acc.r, -0.3, 0.3), 3.4, 0.75, dt) + sideA * KP.side + this._kSide * refSide; // наклон от бьющей ноги к опорной (знак проверен пробой позы: раньше корпус клонился к мячу)
    const yawQ = this._yawQuat(th, new THREE.Quaternion());

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
      let swT = clamp(-side * dStride * 0.9, -0.45, 0.45) * Math.max(0.25 + 0.75 * run, 0.85 * wk);
      let abdT = 0.07 + 0.14 * run, flexT = 0.6 * run + Math.max(0, swT) * 0.35;
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
        if (vyEst > 0.4) { swT = 0.3; abdT = Math.max(abdT, 0.25); flexT = 0.7; }
        else { swT = 0.1; abdT = Math.max(abdT, 0.4); flexT = 0.45; }
      }
      if (sl > 0.01) { swT += (-0.35 - swT) * sl; abdT = Math.max(abdT, 0.55 * sl); flexT += (0.3 - flexT) * sl; }
      if (bk > 0.01) { swT += (0.35 - swT) * bk; abdT = Math.max(abdT, 0.6 * bk); flexT += (0.4 - flexT) * bk; } // руки в стороны для баланса
      if (gd > 0.01 && !kOn && !air) { const k = gd * gProc; swT += (0.28 - swT) * k; abdT = Math.max(abdT, 0.55 * k); flexT += (0.75 - flexT) * k; }
      const sw = this._spring('aSw' + i, swT, 5.5, 0.55, dt), abd = this._spring('aAbd' + i, abdT, 5, 0.65, dt), flex = this._spring('aFl' + i, flexT, 5.5, 0.6, dt);
      const upper = addQ.clone().multiply(_q.setFromAxisAngle(r, sw)).multiply(_q2.setFromAxisAngle(f, -side * abd));
      const fore = addQ.clone().multiply(_q.setFromAxisAngle(r, sw + flex)).multiply(_q2.setFromAxisAngle(f, -side * abd));
      return { upper, fore };
    });
    const world = (name, extra) => {
      const q = (extra ? extra.clone().multiply(yawQ) : yawQ.clone()).multiply(pose.get(name)).multiply(R[name].q);
      setWorldQuat(B[name], q);
    };

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
      // через себя: свободная нога тоже идёт вверх — «ножницы»
      if (bk > 0.01 && !(kicking && (kickSide > 0) === (i === 1))) { h += 0.5 * bk; x += f.x * 0.3 * bk; z += f.z * 0.3 * bk; }
      // в прыжке свободная нога поджимается, а не висит
      if (air && sl < 0.05 && !(kicking && (kickSide > 0) === (i === 1))) {
        const tuck = Math.min(1, s.py / 0.3);
        h += (i ? 0.1 : 0.04) * tuck; // одно колено чуть выше другого
        x += f.x * (i ? 0.05 : -0.1) * tuck; z += f.z * (i ? 0.05 : -0.1) * tuck;
      }
      return { x, z, h, yaw, planted: ft.planted && !lifted && !stopping, u: ft.u || 0, top: !!ft.top };
    });
    const sup = feetT.map((ft) => (ft.planted ? 1 : 0));

    // ----- таз: высота и покачивание из клипа, ограничение — досягаемость опорных ног
    if (this._wasAir && !air) this.sp.squash = { x: (this.sp.squash ? this.sp.squash.x : 0), v: 1.3 };
    this._wasAir = air;
    const squash = this._spring('squash', 0, 3.2, 0.55, dt);
    const crouch = 0.012 + KP.drop +Math.min(0.05, accMag * 0.0035) + (kPhase === 'windup' || kPhase === 'swing' ? 0.02 + 0.02 * kc : 0)
      + (feetT[0].top || feetT[1].top ? 0.03 : 0) + Math.max(0, squash) + 0.1 * gd + 0.5 * sl + 0.3 * rc;
    const swayX = pose.hips.x * this.hipRestY;
    const hipBack = refW > 0.01 ? profile(KICK_REF.hipBack, this._kc) * refW : 0;
    const cx = s.px + r.x * -swayX + f.x * (leanF * 0.15 - hipBack), cz = s.pz + r.z * -swayX + f.z * (leanF * 0.15 - hipBack);
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
      allowed = Math.max(allowed, this.hipRestY - 0.16 - 0.08 * gd - 0.5 * sl - 0.22 * rc);
    }
    // ходьба: у бегового клипа таз ниже всего в середине опоры, у шага — наоборот. Высоту задаёт сама опорная нога:
    // почти прямая, таз идёт над ней дугой — выше всего над стопой, ниже всего на двойной опоре
    const walkY = Math.min(allowed, this.hipRestY) - 0.008;
    const clipY = pose.hips.y < 1 ? pose.hips.y + (1 - pose.hips.y) * KICK_REF.pelvis * refW : pose.hips.y;
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
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i], ft = feetT[i];
      const ff = new THREE.Vector3(Math.cos(ft.yaw), 0, Math.sin(ft.yaw));
      const fr = new THREE.Vector3(-ff.z, 0, ff.x);
      const isKickFoot = kicking && ((kick.footSide > 0) === (i === 1));
      const behind = fo[i] < 0;
      L.up.getWorldPosition(H);
      const dmax = (L.l1 + L.l2) * 0.999, dmin = Math.abs(L.l1 - L.l2) + 0.02;
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
      const putFoot = (q) => { if (legK > 0.01) q.slerp(clipFootQ, legK); setWorldQuat(L.foot, q); };
      v.subVectors(A, H);
      let dist = v.length();
      this.diag.reachErr[i] = Math.max(0, dist - dmax);
      if (dist > dmax) { A.copy(H).addScaledVector(v, dmax / dist); dist = dmax; }
      if (dist < dmin) dist = dmin;
      dir.subVectors(A, H).normalize();
      bend.copy(ff).multiplyScalar(0.5).addScaledVector(f, 0.5).addScaledVector(r, L.side * 0.12);
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
      if (legK > 0.01) bend.multiplyScalar(1 - 0.9 * legK).addScaledVector(cA.copy(L.restDir).applyQuaternion(_q.copy(yawQ).multiply(pose.get(L.name + 'UpLeg'))), 2 * legK);
      bend.addScaledVector(dir, -bend.dot(dir)).normalize();
      // анатомия колена: оно сгибается только вперёд-вверх относительно корпуса и не перескакивает за кадр.
      // Какой бы ни была подсказка (клип, удар, шаг), колено позади линии бедро — стопа не допускается.
      if (L.pole && dt > 0) { bend.lerpVectors(L.pole, bend, Math.min(1, this.adapt.kneeRate * dt)); bend.addScaledVector(dir, -bend.dot(dir)).normalize(); }
      hinge.copy(f).addScaledVector(UP, 0.6); hinge.addScaledVector(dir, -hinge.dot(dir));
      if (hinge.lengthSq() > 1e-6) {
        // предел — после сглаживания: он жёсткий, сглаживание не может оставить колено позади
        hinge.normalize();
        // у ноги, отведённой в сторону для удара с лёта, колено смотрит наружу — предел для неё только «не назад»
        const front = bend.dot(hinge), need = this.adapt.kneeFront * (1 - 0.9 * Math.min(1, KP.high) * kw);
        if (front < need) bend.addScaledVector(hinge, need - front).normalize();
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
    world('Spine', part(0.75, 0.1)); world('Spine1', part(0.9, 0.55)); world('Spine2', addQ);
    world('LeftShoulder', addQ); world('RightShoulder', addQ);
    world('LeftArm', armQ[0].upper); world('LeftForeArm', armQ[0].fore); world('LeftHand', armQ[0].fore);
    world('RightArm', armQ[1].upper); world('RightForeArm', armQ[1].fore); world('RightHand', armQ[1].fore);

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
    world('Neck', part(1, 0.4));
    // поворот к мячу: вокруг вертикали (в осях сцены положительный угол рыскания — по часовой сверху)
    const headExtra = new THREE.Quaternion().setFromAxisAngle(UP, -look).multiply(_q.setFromAxisAngle(r, -(lookPitch + leanF * 0.5) + (g && g.type === 'head' ? 0.35 * gw : 0))).multiply(_q2.setFromAxisAngle(f, -leanS * 0.5));
    world('Head', headExtra);
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
