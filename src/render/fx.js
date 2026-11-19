// Эффекты очков на поле: взрыв частиц и кольца у ворот при голе, кольцо-таймер под игроком, который держит мяч.
// Только изображение: симуляцию не трогает (она авторитетна, в сети её нельзя останавливать ради «замирания»).
import * as THREE from 'three';

const MAXP = 512; // два крупных взрыва подряд не вытесняют друг друга
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class PointsFx {
  constructor(scene) {
    this.scene = scene;
    // частицы: один буфер на все взрывы. Затухание — потемнением цвета: при сложении цветов чёрное невидимо
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAXP * 3); this.col = new Float32Array(MAXP * 3);
    this.vel = new Float32Array(MAXP * 3); this.life = new Float32Array(MAXP); this.max = new Float32Array(MAXP); this.base = new Float32Array(MAXP * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.17, sizeAttenuation: true, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false; this.points.renderOrder = 10;
    scene.add(this.points);
    this.next = 0;
    // кольца на покрытии
    this.rings = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 9;
      scene.add(m); this.rings.push({ m, t: 1, delay: 0 });
    }
    // кольцо-таймер удержания: дуга — доля времени до штрафа
    this.hold = [0, 1].map(() => {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.62, 48), mat);
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 9;
      scene.add(m);
      return { m, q: -1, t: 0 };
    });
  }

  // взрыв у точки x,y,z; dir — куда в основном летят частицы по x (обратно в поле из ворот); kit — цвет команды
  // delay — через сколько секунд кадрового времени (замедление шортсов и повторы его учитывают)
  burst(x, y, z, dir, kit, count, delay = 0) {
    if (reduced) return;
    if (delay > 0) { (this.later || (this.later = [])).push({ t: delay, a: [x, y, z, dir, kit, count] }); return; }
    const gold = new THREE.Color(0xffd34d), team = new THREE.Color(kit);
    for (let n = 0; n < count; n++) {
      const i = this.next; this.next = (this.next + 1) % MAXP;
      const a = Math.random() * Math.PI * 2, u = Math.random(), sp = 3 + Math.random() * 4;
      // полусфера, раскрытая в поле
      const vx = dir * (0.3 + u) , vy = 0.6 + Math.random() * 0.9, vz = Math.sin(a) * (1 - u * 0.5);
      const l = Math.hypot(vx, vy, vz);
      this.vel[i * 3] = vx / l * sp; this.vel[i * 3 + 1] = vy / l * sp; this.vel[i * 3 + 2] = vz / l * sp;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      const c = Math.random() < 0.7 ? gold : team;
      this.base[i * 3] = c.r; this.base[i * 3 + 1] = c.g; this.base[i * 3 + 2] = c.b;
      this.max[i] = this.life[i] = 0.6 + Math.random() * 0.5;
    }
  }

  ring(x, z, kit, delay = 0) {
    if (reduced) return;
    const r = this.rings.find((q) => q.t >= 1) || this.rings[0];
    r.m.position.set(x, 0.025, z); r.m.material.color.set(kit); r.t = 0; r.delay = delay; r.m.visible = false;
  }

  // кольцо под игроком i: frac — доля времени до штрафа (0..1), over — штраф уже идёт; on=false — спрятать
  holdRing(i, on, x, z, frac, over) {
    const h = this.hold[i];
    if (!on) { h.m.visible = false; h.q = -1; return; }
    const q = over ? 48 : Math.max(1, Math.round(frac * 48));
    if (q !== h.q) { h.m.geometry.dispose(); h.m.geometry = new THREE.RingGeometry(0.55, 0.62, 48, 1, Math.PI / 2, (q / 48) * Math.PI * 2); h.q = q; }
    h.m.visible = true; h.m.position.set(x, 0.03, z);
    h.over = over; h.frac = frac;
  }

  update(dt) {
    if (this.later?.length) {
      for (const q of this.later) q.t -= dt;
      const due = this.later.filter((q) => q.t <= 0);
      this.later = this.later.filter((q) => q.t > 0);
      for (const q of due) this.burst(...q.a);
    }
    let live = 0;
    for (let i = 0; i < MAXP; i++) {
      if (this.life[i] <= 0) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      live++;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 9 * dt;
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      if (this.pos[i * 3 + 1] < 0.03) { this.pos[i * 3 + 1] = 0.03; this.vel[i * 3 + 1] *= -0.3; }
      const f = Math.max(0, this.life[i] / this.max[i]);
      for (let k = 0; k < 3; k++) this.col[i * 3 + k] = this.base[i * 3 + k] * f;
    }
    if (live || this._live) { this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true; }
    this._live = live;
    for (const r of this.rings) {
      if (r.t >= 1) { r.m.visible = false; continue; }
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.t = Math.min(1, r.t + dt / 0.6);
      const e = 1 - (1 - r.t) * (1 - r.t);
      r.m.visible = true; r.m.scale.setScalar(0.3 + 3.7 * e); r.m.material.opacity = 0.8 * (1 - r.t);
    }
    for (const h of this.hold) {
      if (!h.m.visible) continue;
      h.t += dt;
      // пульс чаще по мере приближения штрафа: от 2 до 6 Гц
      const hz = h.over ? 6 : 2 + 4 * (1 - h.frac);
      h.m.material.opacity = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(h.t * hz * Math.PI * 2));
    }
  }
}
