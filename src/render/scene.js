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

// псевдослучайные числа с зерном: двор и роспись одинаковы от запуска к запуску
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

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
    // дневное небо: от синего в зените к светлой дымке у горизонта
    this.scene.background = canvasTexture(4, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2f7fdc'); gr.addColorStop(0.6, '#8cc4f4'); gr.addColorStop(1, '#dff0ff'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    this.scene.fog = new THREE.Fog(0xcfe4f7, 70, 170);

    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.5, 200);
    this.view = 'game';
    this.shake = 0; this.shakeEnabled = true;
    this._camTarget = new THREE.Vector3(0, 0.4, -0.9);

    const hemi = new THREE.HemisphereLight(0xdcefff, 0x6f7a62, 1.25);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.7);
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
    this._buildTurf(F);
    this._buildCage(F);
    this._buildGoals(F);
    this._buildStreet(F);
  }

  // Покрытие: яркий стилизованный газон с контрастными полосами и чёткой белой разметкой; вокруг — асфальт двора
  _buildTurf(F) {
    const L = F.length, W = F.width, gw = F.goalWidth, s = this.scene;
    const asphalt = canvasTexture(512, 512, (g, w, h) => {
      g.fillStyle = '#2f3237'; g.fillRect(0, 0, w, h);
      const r = rng(11);
      for (let i = 0; i < 9000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.06)'; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
      for (let i = 0; i < 7; i++) { g.fillStyle = r() < 0.5 ? 'rgba(20,21,24,0.14)' : 'rgba(90,92,96,0.08)'; g.beginPath(); g.ellipse(r() * w, r() * h, 30 + r() * 70, 18 + r() * 40, r() * 3, 0, 7); g.fill(); }
      g.strokeStyle = 'rgba(15,16,19,0.35)'; g.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) { let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 70; y += (r() - 0.5) * 70; g.lineTo(x, y); } g.stroke(); }
    });
    asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping; asphalt.repeat.set(14, 11);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(110, 86), new THREE.MeshStandardMaterial({ map: asphalt, roughness: 1 }));
    apron.rotation.x = -Math.PI / 2; apron.position.y = -0.01; apron.receiveShadow = true; s.add(apron);
    const px = 64; // пикселей на метр
    const turf = canvasTexture(L * px, W * px, (g, w, h) => {
      for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#3fc45c' : '#2fa84b'; g.fillRect((i * w) / 12, 0, w / 12 + 1, h); }
      // светлее в центре, глубже к бортам: поле читается объёмно даже при ровном свете
      const gr = g.createRadialGradient(w / 2, h / 2, h * 0.1, w / 2, h / 2, w * 0.6);
      gr.addColorStop(0, 'rgba(225,255,150,0.2)'); gr.addColorStop(1, 'rgba(0,45,40,0.26)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      const r = rng(7);
      for (let i = 0; i < 7000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,50,20,0.06)'; g.fillRect(r() * w, r() * h, 2, 4 + r() * 7); }
      // своя половина слегка теплее: граница для тела читается, для мяча стены нет
      g.fillStyle = 'rgba(255,224,120,0.06)'; g.fillRect(0, 0, w / 2, h);
      const ins = F.goalInset * px, cy = h / 2, hw = (gw / 2) * px;
      for (const left of [true, false]) {
        // пол внутри ворот — в цвет стороны
        g.fillStyle = left ? 'rgba(40,110,235,0.5)' : 'rgba(240,84,60,0.5)';
        g.fillRect(left ? 0 : w - ins, cy - hw, ins, gw * px);
      }
      g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.lineJoin = 'round';
      g.strokeRect(5, 5, w - 10, h - 10);
      g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
      g.beginPath(); g.arc(w / 2, cy, 1.5 * px, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, cy, 8, 0, Math.PI * 2); g.fill();
      for (const left of [true, false]) {
        // линия ворот между стойками; площадь ворот — со скруглёнными углами, как на дворовых кортах
        const lx = left ? ins : w - ins, dir = left ? 1 : -1, R = 2.2 * px;
        g.beginPath(); g.moveTo(lx, cy - hw); g.lineTo(lx, cy + hw); g.stroke();
        g.beginPath();
        if (left) { g.arc(lx, cy - hw, R, -Math.PI / 2, 0, false); g.lineTo(lx + R, cy + hw); g.arc(lx, cy + hw, R, 0, Math.PI / 2, false); }
        else { g.arc(lx, cy - hw, R, -Math.PI / 2, -Math.PI, true); g.lineTo(lx - R, cy + hw); g.arc(lx, cy + hw, R, Math.PI, Math.PI / 2, true); }
        g.stroke();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(lx + dir * 3.1 * px, cy, 6, 0, Math.PI * 2); g.fill();
      }
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshStandardMaterial({ map: turf, roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s.add(ground);
  }

  // Коробка: расписанные бетонные борта, выше — сетка-рабица на тёмных стойках
  _buildCage(F) {
    const L = F.length, W = F.width, gw = F.goalWidth, gh = F.goalHeight, s = this.scene;
    const bh = F.boardHeight, th = 0.16;
    const WORDS = ['RUA 1x1', 'ARENA DUEL', 'JOGA BOLA', 'STREET CUP'];
    const wallTex = (len, team, seed) => canvasTexture(Math.round(len * 96), 128, (g, w, h) => {
      const r = rng(seed);
      g.fillStyle = '#131518'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < w; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.1)'; g.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3); }
      // редкая белая трафаретная надпись: борт остаётся тёмным фоном для поля и мяча
      g.font = '900 54px Impact, "Arial Black", sans-serif'; g.fillStyle = 'rgba(255,255,255,0.82)'; g.textBaseline = 'middle';
      for (let x = w * 0.5 - 60 + (r() - 0.5) * 40, k = 0; k < 1; k++) {
        const word = WORDS[Math.floor(r() * WORDS.length)];
        g.fillRect(x - 26, h * 0.3, 6, h * 0.5); g.fillText(word, x, h * 0.57); g.fillRect(x + g.measureText(word).width + 20, h * 0.3, 6, h * 0.5);
      }
      // полоса цвета стороны по верху борта
      g.fillStyle = team; g.fillRect(0, 0, w, 10);
    });
    const blue = '#2f7bff', red = '#ff5a44';
    const capMat = new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.6 });
    const plain = new THREE.MeshStandardMaterial({ color: 0x131518, roughness: 0.9 });
    const addBoard = (x, z, sx, sz, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, bh, sz), mat);
      const clear = !Array.isArray(mat) && mat.transparent;
      m.position.set(x, bh / 2, z); m.castShadow = !clear; m.receiveShadow = !clear; s.add(m);
      if (!clear) { const c = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.04, 0.05, sz + 0.04), capMat); c.position.set(x, bh + 0.025, z); s.add(c); }
    };
    // роспись — на стороне, обращённой в поле; остальные грани — крашеный бетон
    const painted = (len, team, seed, face) => {
      const mats = [plain, plain, plain, plain, plain, plain];
      mats[face] = new THREE.MeshStandardMaterial({ map: wallTex(len, team, seed), roughness: 0.85 });
      return mats;
    };
    const nearMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, transparent: true, opacity: 0.26, depthWrite: false });
    addBoard(-L / 4, -(W / 2 + th / 2), L / 2, th, painted(L / 2, blue, 21, 4));
    addBoard(L / 4, -(W / 2 + th / 2), L / 2, th, painted(L / 2, red, 22, 4));
    addBoard(-L / 4, W / 2 + th / 2, L / 2, th, nearMat(0x2f7bff));
    addBoard(L / 4, W / 2 + th / 2, L / 2, th, nearMat(0xff5a44));
    // торцевые борта с проёмом по ширине ворот: ворота уходят за коробку
    const endLen = (W - gw) / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      addBoard(sx * (L / 2 + th / 2), sz * (gw / 2 + endLen / 2), th, endLen, painted(endLen, sx < 0 ? blue : red, 30 + sx * 3 + sz, sx < 0 ? 0 : 1));
    }

    // рабица выше бортов до физической высоты коробки; ближняя к камере сторона почти невидима
    const chain = canvasTexture(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(214,224,236,0.95)'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w / 2, 0); g.lineTo(w, h / 2); g.lineTo(w / 2, h); g.closePath(); g.stroke();
    });
    chain.wrapS = chain.wrapT = THREE.RepeatWrapping;
    const mesh = (w, h, opacity) => {
      const t = chain.clone(); t.needsUpdate = true; t.repeat.set(w / 0.22, h / 0.22);
      return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
    };
    const fenceH = F.fenceHeight - bh;
    const far = mesh(L, fenceH, 0.2); far.position.set(0, bh + fenceH / 2, -W / 2); s.add(far);
    const near = mesh(L, fenceH, 0.035); near.position.set(0, bh + fenceH / 2, W / 2); s.add(near);
    const pane = (w, h, x, y, z) => { const e = mesh(w, h, 0.16); e.rotation.y = Math.PI / 2; e.position.set(x, y, z); s.add(e); };
    for (const sx of [-1, 1]) {
      pane(W, F.fenceHeight - gh, sx * L / 2, (F.fenceHeight + gh) / 2, 0);
      for (const sz of [-1, 1]) pane(endLen, gh - bh, sx * L / 2, (gh + bh) / 2, sz * (gw / 2 + endLen / 2));
    }
    // каркас: показывает границы коробки и высоту возврата высоких мячей
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.5, metalness: 0.5 });
    const rail = (ax, len, x, y, z, rad = 0.035) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 8), railMat);
      if (ax === 'x') m.rotation.z = Math.PI / 2; else if (ax === 'z') m.rotation.x = Math.PI / 2;
      m.position.set(x, y, z); s.add(m);
    };
    // ближней к камере верхней балки нет: она проходила бы через кадр поперёк поля
    rail('x', L, 0, F.fenceHeight, -W / 2); rail('z', W, -L / 2, F.fenceHeight, 0); rail('z', W, L / 2, F.fenceHeight, 0);
    rail('x', L, 0, bh + fenceH * 0.45, -W / 2, 0.02);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rail('y', F.fenceHeight, sx * L / 2, F.fenceHeight / 2, sz * W / 2, 0.055);
    for (let x = -L / 2 + 3; x < L / 2 - 0.1; x += 3) rail('y', fenceH, x, bh + fenceH / 2, -W / 2, 0.03);
    for (const sx of [-1, 1]) for (const z of [-gw / 2 - 0.02, gw / 2 + 0.02]) rail('y', F.fenceHeight - gh, sx * L / 2, (F.fenceHeight + gh) / 2, z, 0.025);
    // гирлянда лампочек вдоль дальней стороны
    const bulbGeo = new THREE.SphereGeometry(0.05, 8, 6), cols = [0xfff2c8, 0xfff2c8, 0xfff2c8, 0xfff2c8];
    const span = 6, y0 = 3.6;
    for (let x0 = -L / 2, n = 0; x0 < L / 2 - 0.1; x0 += span) for (let k = 1; k < 10; k++, n++) {
      const u = k / 10, b = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: cols[n & 3] }));
      b.position.set(x0 + u * span, y0 - 0.5 * Math.sin(Math.PI * u), -W / 2 + 0.06); s.add(b);
    }
  }

  // Ворота: толстая белая труба, скобы у верхних углов, рама по покрытию; сетка свисает со скоб и уходит назад с наклоном.
  // Полотна стоят там же, где их считает симуляция; низ задней сетки отнесён дальше — туда мяч не долетает, это запас полотна.
  _buildGoals(F) {
    const L = F.length, gw = F.goalWidth, gh = F.goalHeight, s = this.scene;
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.05 });
    const UPV = new THREE.Vector3(0, 1, 0), V = (a, b, c) => new THREE.Vector3(a, b, c);
    const tube = (a, b, rad, shadow = false) => {
      const d = b.clone().sub(a), len = d.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 16), postMat);
      m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UPV, d.normalize());
      m.castShadow = shadow; s.add(m);
      return m;
    };
    const knob = (p, rad) => { const m = new THREE.Mesh(new THREE.SphereGeometry(rad, 14, 10), postMat); m.position.copy(p); s.add(m); };
    const netTex = canvasTexture(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(120,130,140,0.55)'; g.lineWidth = 7; g.strokeRect(0, 0, w, h); // тень шнура: сетка читается и на светлом
      g.strokeStyle = '#ffffff'; g.lineWidth = 4.5; g.strokeRect(0, 0, w, h);
    });
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
    const pr = F.postRadius, gi = F.goalInset, depth = gi + F.goalBack, slope = 0.38, low = 0.045;
    const bump = (a, b, w, h) => Math.sin(Math.PI * a / w) * Math.sin(Math.PI * b / h);
    this.nets = [];
    for (const sx of [-1, 1]) {
      const x = sx * (L / 2 - gi), xb = sx * (L / 2 + F.goalBack), xbb = xb + sx * slope; // линия ворот, верх и низ задней сетки
      for (const sz of [-1, 1]) {
        const z = sz * gw / 2;
        tube(V(x, 0, z), V(x, gh, z), pr, true); knob(V(x, gh, z), pr);
        // рама по покрытию: от стойки назад
        tube(V(x, low, z), V(xbb, low, z), low); knob(V(xbb, low, z), low);
        // скоба у верхнего угла: вытянутая петля в плоскости боковой сетки
        const bl = 0.72, br = 0.13, rr = 0.032;
        tube(V(x, gh, z), V(x + sx * bl, gh, z), rr); tube(V(x, gh - 2 * br, z), V(x + sx * bl, gh - 2 * br, z), rr);
        const arc = new THREE.Mesh(new THREE.TorusGeometry(br, rr, 10, 18, Math.PI), postMat);
        arc.rotation.z = -sx * Math.PI / 2; arc.position.set(x + sx * bl, gh - br, z); s.add(arc);
        // растяжки: от скобы до верха задней сетки и вниз к раме
        tube(V(x + sx * bl, gh, z), V(xb, gh, z), 0.014); tube(V(xb, gh, z), V(xbb, low, z), 0.014);
      }
      tube(V(x, gh, -gw / 2), V(x, gh, gw / 2), pr, true);
      tube(V(xbb, low, -gw / 2), V(xbb, low, gw / 2), low);
      tube(V(xb, gh, -gw / 2), V(xb, gh, gw / 2), 0.014);
      // origin, оси u и v (единичные), размеры, нормаль наружу из ворот; последняя функция — форма полотна в покое
      const lean = (b) => slope * (1 - b / gh);
      this._addNet(netTex, sx, 'back', V(xb, 0, -gw / 2), V(0, 0, 1), V(0, 1, 0), gw, gh, V(sx, 0, 0), (a, b, o) => o.set(sx * (lean(b) + 0.06 * bump(a, b, gw, gh)), 0, 0));
      this._addNet(netTex, sx, 'far', V(x, 0, -gw / 2), V(sx, 0, 0), V(0, 1, 0), depth, gh, V(0, 0, -1), (a, b, o) => o.set(sx * (a / depth) * lean(b), 0, -0.05 * bump(a, b, depth, gh)));
      this._addNet(netTex, sx, 'near', V(x, 0, gw / 2), V(sx, 0, 0), V(0, 1, 0), depth, gh, V(0, 0, 1), (a, b, o) => o.set(sx * (a / depth) * lean(b), 0, 0.05 * bump(a, b, depth, gh)));
      this._addNet(netTex, sx, 'top', V(x, gh, -gw / 2), V(sx, 0, 0), V(0, 0, 1), depth, gw, V(0, 1, 0), (a, b, o) => o.set(0, -0.07 * bump(a, b, depth, gw), 0));
      // пол ворот за пределами коробки
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(F.goalBack + slope, gw), new THREE.MeshStandardMaterial({ color: sx < 0 ? 0x2c62c4 : 0xc8503c, roughness: 1 }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(sx * (L / 2 + (F.goalBack + slope) / 2), 0.003, 0); floor.receiveShadow = true; s.add(floor);
    }
  }

  // Двор: дома разной высоты вплотную к коробке с дальней стороны и с торцов. Со стороны камеры домов нет.
  _buildStreet(F) {
    const L = F.length, W = F.width, s = this.scene, r = rng(2026);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const PLASTER = ['#6f737a', '#7d7f82', '#646970', '#84807b', '#5c6168', '#77736f']; // одна приглушённая гамма: двор — фон, а не картинка
    const facade = (wM, hM, style, seed) => {
      const k = Math.min(48, 1024 / Math.max(wM, hM));
      const t = canvasTexture(Math.round(wM * k), Math.round(hM * k), (g, w, h) => {
        const q = rng(seed), qp = (a) => a[Math.floor(q() * a.length)];
        if (style === 'brick') {
          g.fillStyle = '#6a5850'; g.fillRect(0, 0, w, h);
          const bhp = Math.max(3, 0.1 * k), bwp = bhp * 2.4;
          for (let y = 0, row = 0; y < h; y += bhp, row++) for (let x = (row % 2) * -bwp / 2; x < w; x += bwp) {
            g.fillStyle = (q() < 0.5 ? 'rgba(200,180,165,' : 'rgba(30,20,15,') + (0.03 + q() * 0.08) + ')'; g.fillRect(x + 0.5, y + 0.5, bwp - 1, bhp - 1);
          }
          g.fillStyle = 'rgba(92,90,88,0.9)'; // бетонные перекрытия между этажами
          for (let y = h; y > 0; y -= 2.8 * k) g.fillRect(0, y - 0.22 * k, w, 0.22 * k);
        } else {
          g.fillStyle = style; g.fillRect(0, 0, w, h);
          for (let i = 0; i < 14; i++) { g.fillStyle = q() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(20,20,25,0.05)'; g.fillRect(q() * w, q() * h, 20 + q() * 120, 30 + q() * 160); }
          const gr = g.createLinearGradient(0, h * 0.8, 0, h); gr.addColorStop(0, 'rgba(60,45,35,0)'); gr.addColorStop(1, 'rgba(60,45,35,0.32)');
          g.fillStyle = gr; g.fillRect(0, h * 0.8, w, h * 0.2);
        }
        // окна по этажам; на первом этаже — двери
        const floors = Math.max(1, Math.floor(hM / 2.8)), cols = Math.max(1, Math.floor(wM / 2.3));
        for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
          if (q() < 0.2) continue;
          const cx = ((c + 0.5) / cols) * w, base = h - f * 2.8 * k;
          const door = f === 0 && q() < 0.35;
          const ww = (door ? 0.95 : 1.05 + q() * 0.3) * k, wh = (door ? 2.1 : 1.15) * k, top = base - (door ? 2.1 : 2.25) * k;
          g.fillStyle = 'rgba(150,153,158,0.9)'; g.fillRect(cx - ww / 2 - 2, top - 2, ww + 4, wh + (door ? 2 : 4));
          g.fillStyle = door ? qp(['#33383f', '#3d3a38', '#2f353d']) : '#252b33'; g.fillRect(cx - ww / 2, top, ww, wh);
          if (!door) {
            g.strokeStyle = 'rgba(150,153,158,0.7)'; g.lineWidth = 1.5;
            g.beginPath(); g.moveTo(cx, top); g.lineTo(cx, top + wh); g.moveTo(cx - ww / 2, top + wh * 0.45); g.lineTo(cx + ww / 2, top + wh * 0.45); g.stroke();
          }
        }
      });
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
    };
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x55585d, roughness: 1 });
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.7 });
    const rustMat = new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.9 }); let lastStyle = '';
    const house = (x, z, w, d, h, y0 = 0) => {
      let style = r() < 0.38 ? 'brick' : pick(PLASTER); if (style === lastStyle) style = style === 'brick' ? pick(PLASTER) : 'brick'; // соседние дома не сливаются в один
      lastStyle = style; const seed = Math.floor(r() * 1e6);
      const front = facade(w, h, style, seed), side = facade(d, h, style, seed + 1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, roofMat, roofMat, front, front]);
      m.position.set(x, y0 + h / 2, z); s.add(m);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.14, d + 0.3), roofMat); slab.position.set(x, y0 + h + 0.07, z); s.add(slab);
      if (r() < 0.6) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.95, 14), tankMat); t.position.set(x + (r() - 0.5) * w * 0.5, y0 + h + 0.62, z + (r() - 0.5) * d * 0.4); s.add(t); }
      if (r() < 0.5) for (let k = 0; k < 4; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9 + r() * 0.5, 0.06), rustMat); p.position.set(x + (k % 2 ? 1 : -1) * (w / 2 - 0.2), y0 + h + 0.55, z + (k < 2 ? 1 : -1) * (d / 2 - 0.2)); s.add(p); }
      if (y0 > 0) { const b = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, y0, d + 0.4), roofMat); b.position.set(x, y0 / 2, z); s.add(b); }
    };
    // дальняя сторона: три ряда, каждый следующий выше — склон
    const rows = [{ z: -W / 2 - 4.0, d: 5, h: [5.5, 8.5], y: 0 }, { z: -W / 2 - 9.6, d: 5.5, h: [6, 9.5], y: 3.2 }, { z: -W / 2 - 15.5, d: 6, h: [6, 10], y: 7 }];
    for (const row of rows) {
      let x = -L / 2 - 14 + r() * 2;
      while (x < L / 2 + 14) { const w = 4 + r() * 3; house(x + w / 2, row.z + (r() - 0.5) * 0.8, w, row.d, row.h[0] + r() * (row.h[1] - row.h[0]), row.y); x += w + (r() < 0.25 ? 0.9 : 0.05); }
    }
    // торцы: дома за воротами
    for (const sx of [-1, 1]) {
      let z = -W / 2 - 1;
      while (z < W / 2 + 3) { const d = 4 + r() * 2.5, w = 5 + r() * 2; house(sx * (L / 2 + 3.2 + w / 2), z + d / 2, w, d, 5 + r() * 4); z += d + 0.05; }
    }
    // фонари по дальним углам
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.5, metalness: 0.5 });
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 9.2, 10), poleMat); p.position.set(sx * (L / 2 + 0.5), 4.6, -W / 2 - 0.5); s.add(p);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.4), poleMat); head.position.set(sx * (L / 2 + 0.1), 9.2, -W / 2 - 0.3); s.add(head);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff3c4 })); glow.position.set(sx * (L / 2 + 0.1), 9.1, -W / 2 - 0.3); s.add(glow);
    }
  }

  // Полотно сетки: сетка вершин, которую можно прогибать вдоль нормали
  _addNet(tex, side, part, origin, u, v, w, h, normal, shape) {
    const cell = 0.13, off = new THREE.Vector3(), nu = Math.max(2, Math.round(w / cell)), nv = Math.max(2, Math.round(h / cell));
    const geo = new THREE.PlaneGeometry(w, h, nu, nv);
    const pos = geo.attributes.position, base = new Float32Array(pos.count * 3), ab = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const a = pos.getX(i) + w / 2, b = pos.getY(i) + h / 2;
      if (shape) shape(a, b, off);
      const x = origin.x + u.x * a + v.x * b + off.x, y = origin.y + u.y * a + v.y * b + off.y, z = origin.z + u.z * a + v.z * b + off.z;
      pos.setXYZ(i, x, y, z); base.set([x, y, z], i * 3); ab.set([a, b], i * 2);
    }
    pos.needsUpdate = true; geo.computeBoundingSphere();
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set(w / cell, h / cell);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const maxOut = 0.45;
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

  // точка мира → пиксели экрана (null — за камерой)
  toScreen(x, y, z) {
    const v = this._scr || (this._scr = new THREE.Vector3());
    v.set(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
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
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      pts.push(new THREE.Vector3(x * (F.length / 2 - F.goalInset), F.goalHeight + 0.2, z * F.goalWidth / 2));
      for (const y of [0, F.goalHeight + 0.1]) pts.push(new THREE.Vector3(x * (F.length / 2 + F.goalBack + 0.1), y, z * F.goalWidth / 2)); // сетка за коробкой
    }
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
    if (this.view === 'game' && this.cine) {
      // постановочная сцена: своя точка съёмки, которая по out (0..1) переходит в игровой ракурс
      const c = this.cine, k = c.out, t = this._camTarget, b = this._camBase;
      cam.position.set(c.px + (b.x - c.px) * k, c.py + (b.y - c.py) * k, c.pz + (b.z - c.pz) * k);
      cam.lookAt(c.lx + (t.x - c.lx) * k, c.ly + (t.y - c.ly) * k, c.lz + (t.z - c.lz) * k);
      this._cineOn = true;
      return;
    }
    if (this.view === 'game') {
      cam.position.copy(this._camBase);
      if (this._cineOn) { cam.lookAt(this._camTarget); this._cineOn = false; }
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
