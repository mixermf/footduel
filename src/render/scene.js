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
    this._camTarget = new THREE.Vector3(0, 0.4, 0.2);

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
    const L = F.length, W = F.width, gw = F.goalWidth, gh = F.goalHeight, gd = F.goalDepth;
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
      for (const x of [0, w]) { // зона ворот
        const d = 2.2 * px, hw = (gw / 2 + 1) * px;
        g.strokeRect(x === 0 ? 4 : w - 4 - d, h / 2 - hw, d, hw * 2);
      }
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshStandardMaterial({ map: turf, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s.add(ground);

    // борта: сплошные до boardHeight, выше — сетка до fenceHeight
    const boardMatL = new THREE.MeshStandardMaterial({ color: 0x2c4a7a, roughness: 0.7 });
    const boardMatR = new THREE.MeshStandardMaterial({ color: 0x7a3a2c, roughness: 0.7 });
    const cap = new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.5 });
    const bh = F.boardHeight, th = 0.12;
    const addBoard = (x, z, sx, sz, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, bh, sz), mat);
      m.position.set(x, bh / 2, z); m.castShadow = true; m.receiveShadow = true; s.add(m);
      const c = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.02, 0.05, sz + 0.02), cap); c.position.set(x, bh + 0.025, z); s.add(c);
    };
    for (const sz of [-1, 1]) {
      addBoard(-L / 4, sz * (W / 2 + th / 2), L / 2, th, boardMatL);
      addBoard(L / 4, sz * (W / 2 + th / 2), L / 2, th, boardMatR);
    }
    const endLen = (W - gw) / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      addBoard(sx * (L / 2 + th / 2), sz * (gw / 2 + endLen / 2), th, endLen, sx < 0 ? boardMatL : boardMatR);
    }
    // сетка ограждения (физическая высота fenceHeight; ближняя к камере сторона почти прозрачна)
    const fenceH = F.fenceHeight - bh;
    const mkFence = (w, opacity) => {
      const t = gridTexture('rgba(220,230,245,0.9)', 2, 32); t.repeat.set(w / 0.35, fenceH / 0.35);
      return new THREE.Mesh(new THREE.PlaneGeometry(w, fenceH), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
    };
    const far = mkFence(L, 0.22); far.position.set(0, bh + fenceH / 2, -W / 2); s.add(far);
    const near = mkFence(L, 0.05); near.position.set(0, bh + fenceH / 2, W / 2); s.add(near);
    for (const sx of [-1, 1]) {
      const e = mkFence(W, 0.16); e.rotation.y = Math.PI / 2; e.position.set(sx * L / 2, bh + fenceH / 2, 0); s.add(e);
      // участок над воротами
      const t = gridTexture('rgba(220,230,245,0.9)', 2, 32); t.repeat.set(gw / 0.35, (bh - 0) / 0.35);
    }
    // рама верхнего края ограждения: показывает высоту возврата высоких мячей
    const railMat = new THREE.MeshStandardMaterial({ color: 0xbfc8d6, roughness: 0.4, metalness: 0.4 });
    const rail = (ax, len, x, z) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 8), railMat);
      if (ax === 'x') m.rotation.z = Math.PI / 2; else m.rotation.x = Math.PI / 2;
      m.position.set(x, F.fenceHeight, z); s.add(m);
    };
    rail('x', L, 0, -W / 2); rail('x', L, 0, W / 2); rail('z', W, -L / 2, 0); rail('z', W, L / 2, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, F.fenceHeight, 8), railMat);
      p.position.set(sx * L / 2, F.fenceHeight / 2, sz * W / 2); s.add(p);
    }

    // ворота
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    const netTex = gridTexture('rgba(255,255,255,0.95)', 2, 32);
    for (const sx of [-1, 1]) {
      const x = sx * L / 2;
      for (const sz of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(F.postRadius, F.postRadius, gh, 12), postMat);
        p.position.set(x, gh / 2, sz * gw / 2); p.castShadow = true; s.add(p);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(F.postRadius, F.postRadius, gw + F.postRadius * 2, 12), postMat);
      bar.rotation.x = Math.PI / 2; bar.position.set(x, gh, 0); bar.castShadow = true; s.add(bar);
      const net = (w, h, px2, py, pz, ry, rx = 0) => {
        const t = netTex.clone(); t.needsUpdate = true; t.repeat.set(w / 0.16, h / 0.16);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
        m.position.set(px2, py, pz); m.rotation.set(rx, ry, 0); s.add(m);
      };
      net(gw, gh, x + sx * gd, gh / 2, 0, Math.PI / 2);
      net(gd, gh, x + sx * gd / 2, gh / 2, -gw / 2, 0);
      net(gd, gh, x + sx * gd / 2, gh / 2, gw / 2, 0);
      net(gd, gw, x + sx * gd / 2, gh, 0, 0, Math.PI / 2);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(gd, gw), new THREE.MeshStandardMaterial({ color: sx < 0 ? 0x24406b : 0x6b3024, roughness: 1 }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(x + sx * gd / 2, 0.002, 0); floor.receiveShadow = true; s.add(floor);
    }
  }

  setReboundWall(on) {
    if (!this.reboundPanel) {
      const F = this.P.field;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, F.goalHeight, F.goalWidth), new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.6 }));
      m.position.set(F.length / 2 + 0.05, F.goalHeight / 2, 0); m.castShadow = true;
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
    const dir = new THREE.Vector3(0, 0.76, 0.65).normalize();
    const target = this._camTarget;
    const pts = [];
    // в кадре обязаны быть: всё покрытие, борта и обе рамы ворот с сеткой
    const hx = F.length / 2 + 0.25, hz = F.width / 2 + 0.25;
    for (const x of [-hx, hx]) for (const z of [-hz, hz]) for (const y of [0, F.boardHeight]) pts.push(new THREE.Vector3(x, y, z));
    for (const x of [-1, 1]) for (const z of [-1, 1]) for (const y of [0, F.goalHeight + 0.2]) pts.push(new THREE.Vector3(x * (F.length / 2 + F.goalDepth + 0.15), y, z * F.goalWidth / 2));
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
