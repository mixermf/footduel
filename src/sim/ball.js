// Мяч: самостоятельное физическое тело. Свободный полёт, качение, борта, ворота, стойки.
// Защита от проскока — деление шага на подшаги не длиннее 4 см пути.

export function createBall(P) {
  return {
    x: 0, y: P.ball.radius, z: 0,
    vx: 0, vy: 0, vz: 0,
    wx: 0, wy: 0, wz: 0, // угловая скорость, рад/с
    qx: 0, qy: 0, qz: 0, qw: 1, // ориентация для графики
    rolling: true, inGoal: false,
  };
}

export function ballSpeed(b) { return Math.hypot(b.vx, b.vy, b.vz); }

// Прогноз положения катящегося мяча через t секунд (без бортов).
export function predictRoll(b, t, P, out) {
  const s = Math.hypot(b.vx, b.vz);
  if (s < 1e-6) { out.x = b.x; out.z = b.z; return out; }
  const a = P.ball.rollDecel + P.ball.rollDrag * s;
  const tt = Math.min(t, s / a);
  const d = s * tt - 0.5 * a * tt * tt;
  out.x = b.x + (b.vx / s) * d;
  out.z = b.z + (b.vz / s) * d;
  return out;
}

function reflectCylinder2(b, ax, ay, bx, by, minDist, e, setA, setB) {
  // общая процедура для стойки (плоскость xz) и перекладины (плоскость xy)
  let dx = ax - bx, dy = ay - by;
  const d = Math.hypot(dx, dy);
  if (d >= minDist) return 0;
  if (d < 1e-9) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
  setA(bx + dx * minDist, by + dy * minDist);
  return setB(dx, dy, e);
}

export function stepBall(b, dt, P, events, bodyHook) {
  const B = P.ball, F = P.field, r = B.radius;
  const halfL = F.length / 2, halfW = F.width / 2, gHalf = F.goalWidth / 2;
  const speed = ballSpeed(b);
  const n = Math.max(1, Math.min(10, Math.ceil((speed * dt) / 0.04)));
  const h = dt / n;

  for (let i = 0; i < n; i++) {
    const airborne = b.y > r + 1e-4 || b.vy > 1e-3;
    if (airborne) {
      b.rolling = false;
      const s = ballSpeed(b);
      const k = B.airDrag * s;
      // Магнус: a = kM * (w × v) — перпендикулярно скорости, энергии не добавляет
      const mx = b.wy * b.vz - b.wz * b.vy;
      const my = b.wz * b.vx - b.wx * b.vz;
      const mz = b.wx * b.vy - b.wy * b.vx;
      b.vx += (-k * b.vx + B.magnus * mx) * h;
      b.vy += (-B.gravity - k * b.vy + B.magnus * my) * h;
      b.vz += (-k * b.vz + B.magnus * mz) * h;
      const dec = Math.exp(-B.spinDecayAir * h);
      b.wx *= dec; b.wy *= dec; b.wz *= dec;
    } else {
      b.rolling = true;
      b.y = r; b.vy = 0;
      const s = Math.hypot(b.vx, b.vz);
      if (s > 1e-6) {
        // боковое вращение слегка искривляет и качение; поворот скорости без изменения модуля
        const ang = B.magnus * 0.5 * b.wy * h;
        const c = Math.cos(ang), sn = Math.sin(ang);
        const vx = b.vx * c + b.vz * sn, vz = -b.vx * sn + b.vz * c;
        const ns = Math.max(0, s - (B.rollDecel + B.rollDrag * s) * h);
        b.vx = (vx / s) * ns; b.vz = (vz / s) * ns;
      } else { b.vx = 0; b.vz = 0; }
      b.wx = b.vz / r; b.wz = -b.vx / r; // качение без проскальзывания: w = up × v / r
      b.wy *= Math.exp(-B.spinDecayGround * h);
    }

    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;

    // покрытие
    if (b.y < r) {
      b.y = r;
      if (b.vy < -B.restSpeed) {
        const impact = -b.vy;
        b.vy = impact * B.groundRestitution;
        b.vx *= B.groundTangent; b.vz *= B.groundTangent;
        if (impact > 1.5) events.push({ type: 'bounce', speed: impact });
      } else if (b.vy < 0) b.vy = 0;
    }
    // сетчатый потолок ограждения
    if (b.y > F.fenceHeight - r && b.vy > 0) {
      b.y = F.fenceHeight - r; b.vy = -b.vy * 0.3;
      events.push({ type: 'wall', surface: 'net', speed: Math.abs(b.vy) });
    }
    // боковые борта
    for (let sz = -1; sz <= 1; sz += 2) {
      if (b.z * sz > halfW - r) {
        b.z = sz * (halfW - r);
        if (b.vz * sz > 0) {
          const impact = b.vz * sz;
          b.vz = -b.vz * B.wallRestitution;
          b.vx *= B.wallTangent; b.vy *= B.wallTangent; b.wy *= 0.6;
          if (impact > 0.6) events.push({ type: 'wall', surface: b.y < F.boardHeight ? 'board' : 'fence', speed: impact });
        }
      }
    }
    // торцы, ворота, стойки
    for (let sx = -1; sx <= 1; sx += 2) {
      const bx = b.x * sx;
      if (bx < halfL - 1.2) continue;
      const lineX = sx * halfL;
      // стойки (вертикальные цилиндры)
      const walled = F.reboundWall && sx > 0;
      if (!walled && b.y < F.goalHeight + F.postRadius) {
        for (let sz = -1; sz <= 1; sz += 2) {
          const pz = sz * gHalf;
          const hit = reflectCylinder2(b, b.x, b.z, lineX, pz, r + F.postRadius, B.postRestitution,
            (x, z) => { b.x = x; b.z = z; },
            (nx, nz, e) => {
              const vn = b.vx * nx + b.vz * nz;
              if (vn >= 0) return 0;
              b.vx -= (1 + e) * vn * nx; b.vz -= (1 + e) * vn * nz;
              return -vn;
            });
          if (hit > 0.3) events.push({ type: 'post', speed: hit });
        }
      }
      // перекладина (горизонтальный цилиндр вдоль z)
      if (!walled && Math.abs(b.z) < gHalf + F.postRadius) {
        const hit = reflectCylinder2(b, b.x, b.y, lineX, F.goalHeight, r + F.postRadius, B.postRestitution,
          (x, y) => { b.x = x; b.y = y; },
          (nx, ny, e) => {
            const vn = b.vx * nx + b.vy * ny;
            if (vn >= 0) return 0;
            b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
            return -vn;
          });
        if (hit > 0.3) events.push({ type: 'post', speed: hit });
      }
      const bx2 = b.x * sx;
      const inMouth = !walled && Math.abs(b.z) < gHalf && b.y < F.goalHeight;
      if (bx2 <= halfL) {
        b.inGoal = false;
        if (bx2 > halfL - r && !inMouth) {
          b.x = sx * (halfL - r);
          if (b.vx * sx > 0) {
            const impact = b.vx * sx;
            b.vx = -b.vx * B.wallRestitution;
            b.vz *= B.wallTangent; b.vy *= B.wallTangent; b.wy *= 0.6;
            if (impact > 0.6) events.push({ type: 'wall', surface: b.y < F.boardHeight ? 'board' : 'fence', speed: impact });
          }
        }
      } else {
        // внутри ворот: сетка гасит мяч
        const e = B.netRestitution;
        if (Math.abs(b.z) > gHalf - r) { b.z = Math.sign(b.z) * (gHalf - r); if (b.vz * b.z > 0) b.vz = -b.vz * e; b.vx *= 0.6; }
        if (b.y > F.goalHeight - r) { b.y = F.goalHeight - r; if (b.vy > 0) b.vy = -b.vy * e; }
        if (bx2 > halfL + F.goalDepth - r) { b.x = sx * (halfL + F.goalDepth - r); if (b.vx * sx > 0) { b.vx = -b.vx * e; b.vz *= 0.5; } }
        if (bx2 - r > halfL && !b.inGoal) { b.inGoal = true; events.push({ type: 'goal_line', side: sx }); }
      }
    }

    if (bodyHook) bodyHook(b, h);

    // ориентация графики: q' = 0.5 * w * q
    const hx = b.wx * h * 0.5, hy = b.wy * h * 0.5, hz = b.wz * h * 0.5;
    const qx = b.qx + hx * b.qw + hy * b.qz - hz * b.qy;
    const qy = b.qy + hy * b.qw + hz * b.qx - hx * b.qz;
    const qz = b.qz + hz * b.qw + hx * b.qy - hy * b.qx;
    const qw = b.qw - hx * b.qx - hy * b.qy - hz * b.qz;
    const ql = Math.hypot(qx, qy, qz, qw) || 1;
    b.qx = qx / ql; b.qy = qy / ql; b.qz = qz / ql; b.qw = qw / ql;
  }
}
