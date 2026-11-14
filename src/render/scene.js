// Сцена: площадка, ворота, мяч, свет, стабильная приподнятая камера.
import * as THREE from 'three';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function gridTexture(color, line = 3, cell = 32) {
  const t = canvasTexture(cell, cell, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.strokeStyle = color; g.lineWidth = line;
    g.strokeRect(0, 0, w, h);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class GameScene {
  constructor(canvas, profile) {
    this.P = profile;
    const F = profile.field;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1420);
    this.scene.fog = new THREE.Fog(0x0d1420, 40, 90);

    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.5, 200);
    this.view = 'game';
    this.shake = 0; this.shakeEnabled = true;
    this._camTarget = new THREE.Vector3(0, 0.4, -0.9);

    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x25402c, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
    sun.position.set(-7, 16, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -13; sc.right = 13; sc.top = 9; sc.bottom = -9; sc.near = 2; sc.far = 40;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    this.scene.add(sun);

    this._buildField(F);
    this._buildBall(profile.ball.radius);
    this._buildMarkers();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _buildField(F) {
    const L = F.length, W = F.width, gw = F.goalWidth, gh = F.goalHeight;
    const s = this.scene;
    // окружение
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), new THREE.MeshStandardMaterial({ color: 0x18202c, roughness: 1 }));
    apron.rotation.x = -Math.PI / 2; apron.position.y = -0.01; apron.receiveShadow = true; s.add(apron);
    // покрытие с полосами и разметкой
    const px = 64; // пикселей на метр
    const turf = canvasTexture(L * px, W * px, (g, w, h) => {
      for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#2f8f4e' : '#2a8347'; g.fillRect((i * w) / 12, 0, w / 12 + 1, h); }
      // своя половина слегка теплее: граница для тела читается, для мяча стены нет
      g.fillStyle = 'rgba(255,214,120,0.07)'; g.fillRect(0, 0, w / 2, h);
      g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 5;
      g.strokeRect(4, 4, w - 8, h - 8);
      g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
      g.beginPath(); g.arc(w / 2, h / 2, 1.5 * px, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, 7, 0, Math.PI * 2); g.fill();
      const ins = F.goalInset * px;
      for (const left of [true, false]) {
        // пол внутри ворот — в цвет стороны; линия ворот между стойками; площадь ворот от линии
        g.fillStyle = left ? 'rgba(36,64,107,0.85)' : 'rgba(107,48,36,0.85)';
        g.fillRect(left ? 0 : w - ins, h / 2 - (gw / 2) * px, ins, gw * px);
        const lx = left ? ins : w - ins, d = 2.2 * px, hw = (gw / 2 + 1) * px;
        g.beginPath(); g.moveTo(lx, h / 2 - (gw / 2) * px); g.lineTo(lx, h / 2 + (gw / 2) * px); g.stroke();
        g.strokeRect(left ? lx : lx - d, h / 2 - hw, d, hw * 2);
      }
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshStandardMaterial({ map: turf, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s.add(ground);

    // борта: сплошные до boardHeight; ближний к камере — полупрозрачный, чтобы не закрывать край поля
    const boardMatL = new THREE.MeshStandardMaterial({ color: 0x2c4a7a, roughness: 0.7 });
    const boardMatR = new THREE.MeshStandardMaterial({ color: 0x7a3a2c, roughness: 0.7 });
    const nearMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, transparent: true, opacity: 0.3, depthWrite: false });
    const cap = new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.5 });
    const bh = F.boardHeight, th = 0.12;
    const addBoard = (x, z, sx, sz, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, bh, sz), mat);
      m.position.set(x, bh / 2, z); m.castShadow = !mat.transparent; m.receiveShadow = !mat.transparent; s.add(m);
      const c = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.02, 0.05, sz + 0.02), cap); c.position.set(x, bh + 0.025, z); s.add(c);
    };
    addBoard(-L / 4, -(W / 2 + th / 2), L / 2, th, boardMatL);
    addBoard(L / 4, -(W / 2 + th / 2), L / 2, th, boardMatR);
    addBoard(-L / 4, W / 2 + th / 2, L / 2, th, nearMat(0x2c4a7a));
    addBoard(L / 4, W / 2 + th / 2, L / 2, th, nearMat(0x7a3a2c));
    for (const sx of [-1, 1]) addBoard(sx * (L / 2 + th / 2), 0, th, W, sx < 0 ? boardMatL : boardMatR); // торец сплошной: ворота стоят перед ним

    // коробка выше бортов — прозрачные панели (физическая высота fenceHeight): мяч виден с любой стороны
    const fenceH = F.fenceHeight - bh;
    const glass = (w, opacity) => new THREE.Mesh(new THREE.PlaneGeometry(w, fenceH),
      new THREE.MeshBasicMaterial({ color: 0xa9cbff, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
    const far = glass(L, 0.075); far.position.set(0, bh + fenceH / 2, -W / 2); s.add(far);
    const near = glass(L, 0.02); near.position.set(0, bh + fenceH / 2, W / 2); s.add(near);
    for (const sx of [-1, 1]) { const e = glass(W, 0.055); e.rotation.y = Math.PI / 2; e.position.set(sx * L / 2, bh + fenceH / 2, 0); s.add(e); }
    // каркас коробки: показывает её границы и высоту возврата высоких мячей
    const railMat = new THREE.MeshStandardMaterial({ color: 0xbfc8d6, roughness: 0.4, metalness: 0.4 });
    const thinMat = new THREE.MeshBasicMaterial({ color: 0xbfc8d6, transparent: true, opacity: 0.35 });
    const rail = (ax, len, x, y, z, rad = 0.03, mat = railMat) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 8), mat);
      if (ax === 'x') m.rotation.z = Math.PI / 2; else if (ax === 'z') m.rotation.x = Math.PI / 2;
      m.position.set(x, y, z); s.add(m);
    };
    rail('x', L, 0, F.fenceHeight, -W / 2); rail('x', L, 0, F.fenceHeight, W / 2); rail('z', W, -L / 2, F.fenceHeight, 0); rail('z', W, L / 2, F.fenceHeight, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rail('y', F.fenceHeight, sx * L / 2, F.fenceHeight / 2, sz * W / 2, 0.04);
    for (let x = -L / 2 + 3; x < L / 2 - 0.1; x += 3) rail('y', fenceH, x, bh + fenceH / 2, -W / 2, 0.015, thinMat); // стойки остекления дальней стены
    for (const sx of [-1, 1]) rail('y', fenceH, sx * L / 2, bh + fenceH / 2, 0, 0.015, thinMat);

    // ворота: круглая рама стоит в поле на линии ворот, сетка тянется от рамы до торцевого борта и прогибается от мяча
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1 });
    const stayMat = new THREE.MeshStandardMaterial({ color: 0xcfd6e0, roughness: 0.5 });
    const netTex = gridTexture('rgba(255,255,255,0.95)', 2, 32);
    const pr = F.postRadius, gi = F.goalInset;
    this.nets = [];
    for (const sx of [-1, 1]) {
      const x = sx * (L / 2 - gi), xb = sx * (L / 2 - F.netGap); // линия ворот и задняя сетка перед бортом
      for (const sz of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, gh, 20), postMat);
        p.position.set(x, gh / 2, sz * gw / 2); p.castShadow = true; s.add(p);
        const joint = new THREE.Mesh(new THREE.SphereGeometry(pr, 16, 12), postMat); joint.position.set(x, gh, sz * gw / 2); s.add(joint);
        // задняя стойка и верхняя растяжка держат сетку
        const stay = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, gi - F.netGap, 8), stayMat);
        stay.rotation.z = Math.PI / 2; stay.position.set((x + xb) / 2, gh, sz * gw / 2); s.add(stay);
        const back = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, gh, 8), stayMat); back.position.set(xb, gh / 2, sz * gw / 2); s.add(back);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, gw, 20), postMat);
      bar.rotation.x = Math.PI / 2; bar.position.set(x, gh, 0); bar.castShadow = true; s.add(bar);
      const V = (a, b, c) => new THREE.Vector3(a, b, c);
      // origin, оси u и v (единичные), размеры, нормаль наружу из ворот
      this._addNet(netTex, sx, 'back', V(xb, 0, -gw / 2), V(0, 0, 1), V(0, 1, 0), gw, gh, V(sx, 0, 0));
      const depth = gi - F.netGap;
      this._addNet(netTex, sx, 'far', V(x, 0, -gw / 2), V(sx, 0, 0), V(0, 1, 0), depth, gh, V(0, 0, -1));
      this._addNet(netTex, sx, 'near', V(x, 0, gw / 2), V(sx, 0, 0), V(0, 1, 0), depth, gh, V(0, 0, 1));
      this._addNet(netTex, sx, 'top', V(x, gh, -gw / 2), V(sx, 0, 0), V(0, 0, 1), depth, gw, V(0, 1, 0));
    }
  }

  // Полотно сетки: сетка вершин, которую можно прогибать вдоль нормали
  _addNet(tex, side, part, origin, u, v, w, h, normal) {
    const cell = 0.16, nu = Math.max(2, Math.round(w / cell)), nv = Math.max(2, Math.round(h / cell));
    const geo = new THREE.PlaneGeometry(w, h, nu, nv);
    const pos = geo.attributes.position, base = new Float32Array(pos.count * 3), ab = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const a = pos.getX(i) + w / 2, b = pos.getY(i) + h / 2;
      const x = origin.x + u.x * a + v.x * b, y = origin.y + u.y * a + v.y * b, z = origin.z + u.z * a + v.z * b;
      pos.setXYZ(i, x, y, z); base.set([x, y, z], i * 3); ab.set([a, b], i * 2);
    }
    pos.needsUpdate = true; geo.computeBoundingSphere();
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set(w / cell, h / cell);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const maxOut = part === 'back' ? this.P.field.netGap - 0.03 : 0.45; // задняя сетка не уходит сквозь борт
    this.nets.push({ side, part, origin, u, v, w, h, normal, mesh, base, ab, ca: w / 2, cb: h / 2, amp: 0, vel: 0, rest: 0, dirty: false, maxOut });
  }

  // Мяч ударил в сетку (событие симуляции): толчок полотну в точке удара, наружу или внутрь — по стороне, где мяч
  netHit(side, part, x, y, z, speed) {
    const n = this.nets.find((q) => q.side === side && q.part === part);
    if (!n) return;
    const rx = x - n.origin.x, ry = y - n.origin.y, rz = z - n.origin.z;
    n.ca = rx * n.u.x + ry * n.u.y + rz * n.u.z; n.cb = rx * n.v.x + ry * n.v.y + rz * n.v.z;
    const d = rx * n.normal.x + ry * n.normal.y + rz * n.normal.z;
    n.vel += (d < 0 ? 1 : -1) * Math.min(4.5, 0.6 + speed * 0.22);
  }

  // Прогиб сеток: пружина с затуханием после удара и постоянный прогиб там, где мяч лежит на полотне
  updateNets(bx, by, bz, dt) {
    const r = this.P.ball.radius;
    for (const n of this.nets) {
      const rx = bx - n.origin.x, ry = by - n.origin.y, rz = bz - n.origin.z;
      const a = rx * n.u.x + ry * n.u.y + rz * n.u.z, b = rx * n.v.x + ry * n.v.y + rz * n.v.z;
      const d = rx * n.normal.x + ry * n.normal.y + rz * n.normal.z;
      let rest = 0;
      if (a > -0.05 && a < n.w + 0.05 && b > -0.05 && b < n.h + 0.05 && Math.abs(d) < r + 0.07) {
        rest = d < 0 ? r + 0.07 + d : -(r + 0.07 - d); // мяч вплотную: полотно облегает его
        n.ca += (a - n.ca) * Math.min(1, dt * 20); n.cb += (b - n.cb) * Math.min(1, dt * 20);
      }
      n.rest += (rest - n.rest) * Math.min(1, dt * 18);
      if (dt > 0) {
        const steps = Math.max(1, Math.ceil(dt / 0.008)), h = dt / steps;
        for (let i = 0; i < steps; i++) { n.vel += (-330 * n.amp - 11 * n.vel) * h; n.amp += n.vel * h; }
        n.amp = Math.max(-0.45, Math.min(n.maxOut, n.amp));
      }
      const total = Math.min(n.maxOut, n.amp + n.rest);
      if (Math.abs(total) < 0.002 && !n.dirty) continue;
      n.dirty = Math.abs(total) >= 0.002;
      const pos = n.mesh.geometry.attributes.position, base = n.base, ab = n.ab;
      for (let i = 0; i < pos.count; i++) {
        const pa = ab[i * 2], pb = ab[i * 2 + 1];
        // края полотна закреплены на раме, борту и покрытии
        const edge = Math.min(1, Math.min(pa, n.w - pa, pb, n.h - pb) / 0.3);
        const dd = (pa - n.ca) * (pa - n.ca) + (pb - n.cb) * (pb - n.cb);
        const k = total * edge * Math.exp(-dd / 0.32);
        pos.setXYZ(i, base[i * 3] + n.normal.x * k, base[i * 3 + 1] + n.normal.y * k, base[i * 3 + 2] + n.normal.z * k);
      }
      pos.needsUpdate = true;
    }
  }

  setReboundWall(on) {
    if (!this.reboundPanel) {
      const F = this.P.field;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, F.goalHeight, F.goalWidth), new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.6 }));
      m.position.set(F.length / 2 - F.goalInset + 0.05, F.goalHeight / 2, 0); m.castShadow = true;
      this.reboundPanel = m; this.scene.add(m);
    }
    this.reboundPanel.visible = on;
  }

  _buildBall(r) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }));
    body.castShadow = true; g.add(body);
    // тёмные панели в вершинах икосаэдра: вращение читается на любой скорости
    const patchMat = new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.5 });
    const t = (1 + Math.sqrt(5)) / 2;
    const verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    for (const v of verts) {
      const n = new THREE.Vector3(...v).normalize();
      const p = new THREE.Mesh(new THREE.CircleGeometry(r * 0.36, 5), patchMat);
      p.position.copy(n).multiplyScalar(r * 1.004);
      p.lookAt(n.clone().multiplyScalar(2));
      g.add(p);
    }
    this.ball = g; this.scene.add(g);
    // мягкое пятно под мячом помогает оценить высоту (не заменяет настоящую тень)
    const blobTex = canvasTexture(64, 64, (c, w) => {
      const gr = c.createRadialGradient(w / 2, w / 2, 2, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr; c.fillRect(0, 0, w, w);
    });
    this.ballBlob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    this.ballBlob.rotation.x = -Math.PI / 2; this.scene.add(this.ballBlob);
  }

  _buildMarkers() {
    // маркер намерения удара на плоскости ворот (показывает цель, а не обещает точку попадания)
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.27, 32), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }));
    ring.rotation.y = Math.PI / 2; ring.visible = false; ring.renderOrder = 10;
    this.aimMarker = ring; this.scene.add(ring);
    // вспышка контакта
    const flash = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.16, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false }));
    flash.rotation.x = -Math.PI / 2; flash.renderOrder = 9;
    this.flash = flash; this.flashT = 1; this.scene.add(flash);
  }

  contactFlash(x, y, z, strength) {
    this.flash.position.set(x, Math.max(0.02, y), z);
    this.flashT = 0; this.flashS = 0.6 + strength;
  }

  setView(view) { this.view = view; this.resize(); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this._fitCamera();
  }

  // Стабильная камера: подбираем дистанцию так, чтобы поле и обе линии ворот были в кадре.
  _fitCamera() {
    const F = this.P.field, cam = this.camera;
    if (this.view !== 'game') return;
    const dir = new THREE.Vector3(0, 0.58, 0.81).normalize(); // ниже прежнего: мяч и игроки видны сбоку, высота читается лучше
    const target = this._camTarget;
    const pts = [];
    // в кадре обязаны быть: всё покрытие, борта и обе рамы ворот с сеткой
    const hx = F.length / 2 + 0.25, hz = F.width / 2 + 0.25;
    for (const x of [-hx, hx]) for (const z of [-hz, hz]) for (const y of [0, F.boardHeight]) pts.push(new THREE.Vector3(x, y, z));
    for (const x of [-1, 1]) for (const z of [-1, 1]) pts.push(new THREE.Vector3(x * (F.length / 2 - F.goalInset), F.goalHeight + 0.2, z * F.goalWidth / 2));
    let lo = 8, hi = 80;
    const v = new THREE.Vector3();
    for (let i = 0; i < 24; i++) {
      const d = (lo + hi) / 2;
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      let ok = true;
      for (const p of pts) { v.copy(p).project(cam); if (Math.abs(v.x) > 0.97 || v.y > 0.8 || v.y < -0.86) { ok = false; break; } }
      if (ok) hi = d; else lo = d;
    }
    cam.position.copy(target).addScaledVector(dir, hi);
    cam.lookAt(target); cam.updateProjectionMatrix();
    this._camBase = cam.position.clone();
  }

  // лабораторные ракурсы следуют за игроком; игровой ракурс неподвижен
  updateCamera(px, pz, yaw, dt) {
    const cam = this.camera;
    if (this.view === 'game') {
      cam.position.copy(this._camBase);
      if (this.shake > 0.001 && this.shakeEnabled) {
        cam.position.x += (Math.random() - 0.5) * this.shake; cam.position.y += (Math.random() - 0.5) * this.shake;
        this.shake *= Math.exp(-14 * dt);
      }
      return;
    }
    const fx = Math.cos(yaw), fz = Math.sin(yaw);
    const t = new THREE.Vector3(px, 0.95, pz);
    if (this.view === 'front') cam.position.set(px + fx * 4.2, 1.3, pz + fz * 4.2);
    else if (this.view === 'side') cam.position.set(px - fz * 4.2, 1.3, pz + fx * 4.2);
    else cam.position.set(px - 3.2, 2.2, pz + 3.6); // close
    cam.lookAt(t);
  }

  updateBall(x, y, z, qx, qy, qz, qw) {
    this.ball.position.set(x, y, z);
    this.ball.quaternion.set(qx, qy, qz, qw);
    const k = 1 + y * 0.5;
    this.ballBlob.position.set(x, 0.006, z);
    this.ballBlob.scale.setScalar(0.34 * k);
    this.ballBlob.material.opacity = Math.max(0.12, 0.8 - y * 0.25);
  }

  updateAim(kick, P) {
    const m = this.aimMarker;
    if (!kick || kick.phase === 'curl') { m.visible = false; return; }
    const F = P.field;
    m.visible = true;
    const y = 0.25 + ((kick.aimHigh + 1) / 2) * (F.goalHeight - 0.45);
    m.position.set(kick.gx, y, kick.aimLat * (F.goalWidth / 2) * P.kick.aimWidth);
    const s = 1.15 - 0.35 * kick.charge;
    m.scale.setScalar(s);
  }

  render(dt) {
    if (this.flashT < 1) {
      this.flashT += dt / 0.18;
      const u = Math.min(1, this.flashT);
      this.flash.scale.setScalar(this.flashS * (0.6 + u * 1.6));
      this.flash.material.opacity = (1 - u) * 0.8;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
