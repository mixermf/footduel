// Мяч: самостоятельное физическое тело. Свободный полёт, качение, борта, рама и сетка ворот.
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
        const sx = r * b.wz, sz = -r * b.wx, sl = Math.hypot(sx, sz); // backspin: contact point slips forward, friction brakes the ball
        if (sl > 0.3 && sx * b.vx + sz * b.vz > 0) {
          const dv = Math.min(sl, B.spinGrip * (1 + B.groundRestitution) * impact, Math.hypot(b.vx, b.vz));
          b.vx -= (sx / sl) * dv; b.vz -= (sz / sl) * dv; b.wx *= 0.3; b.wz *= 0.3;
        }
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
    // торцы и ворота. Рама стоит в поле перед торцевым бортом; сетка — мягкая преграда с обеих сторон:
    // изнутри гасит забитый мяч, снаружи не пускает его в ворота сбоку и сверху.
    for (let sx = -1; sx <= 1; sx += 2) {
      if (b.x * sx < halfL - F.goalInset - 1.2) continue;
      const gx = halfL - F.goalInset, lineX = sx * gx; // линия ворот
      const walled = F.reboundWall && sx > 0;
      const pzPrev = b.z - b.vz * h, pyPrev = b.y - b.vy * h, pxPrev = (b.x - b.vx * h) * sx;
      if (!walled) {
        // стойки — вертикальные цилиндры, перекладина — горизонтальный: отскок по нормали к круглой поверхности
        if (b.y < F.goalHeight + F.postRadius) {
          for (let sz = -1; sz <= 1; sz += 2) {
            const hit = reflectCylinder2(b, b.x, b.z, lineX, sz * gHalf, r + F.postRadius, B.postRestitution,
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
        if (Math.abs(b.z) < gHalf + F.postRadius) {
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
      } else if (Math.abs(b.z) < gHalf && b.y < F.goalHeight && pxPrev <= gx - r + 1e-9 && b.x * sx > gx - r) {
        // щит песочницы закрывает створ
        b.x = sx * (gx - r);
        if (b.vx * sx > 0) {
          const impact = b.vx * sx;
          b.vx = -b.vx * B.wallRestitution; b.vz *= B.wallTangent; b.vy *= B.wallTangent; b.wy *= 0.6;
          if (impact > 0.6) events.push({ type: 'wall', surface: 'board', speed: impact });
        }
      }
      const behind = b.x * sx > gx; // центр мяча за линией ворот
      if (behind) {
        // боковые сетки: мяч остаётся с той стороны, с которой подошёл
        for (let sz = -1; sz <= 1; sz += 2) {
          const d = b.z * sz - gHalf;
          if (Math.abs(d) < r && b.y < F.goalHeight + r * 0.5) {
            const out = pzPrev * sz - gHalf >= 0 ? 1 : -1;
            b.z = sz * (gHalf + out * r);
            if (b.vz * sz * out < 0) {
              const impact = Math.abs(b.vz);
              b.vz = -b.vz * (out > 0 ? B.netOuterRestitution : B.netRestitution); b.vx *= 0.6;
              if (impact > 0.8) events.push({ type: 'net', part: sz < 0 ? 'far' : 'near', side: sx, speed: impact });
            }
          }
        }
        // верхняя сетка: изнутри — на высоте перекладины, снаружи мяч лежит чуть выше, вровень с верхом перекладины
        if (Math.abs(b.z) < gHalf) {
          const out = pyPrev >= F.goalHeight;
          const lim = out ? F.goalHeight + F.postRadius + r + 0.003 : F.goalHeight - r;
          if (out ? b.y < lim : b.y > lim) {
            const impact = Math.abs(b.vy);
            b.y = lim;
            if (out ? b.vy < 0 : b.vy > 0) {
              b.vy = -b.vy * (out ? B.netOuterRestitution : B.netRestitution);
              if (impact > 0.8) events.push({ type: 'net', part: 'top', side: sx, speed: impact });
            }
            // сетка сверху натянута с уклоном к полю: мяч на ней не остаётся, а скатывается через перекладину
            if (out) b.vx -= sx * 5 * h;
          }
        }
      }
      const inBox = behind && Math.abs(b.z) < gHalf && b.y < F.goalHeight;
      // торцевой борт с проёмом по раме ворот: внутри ворот мяч идёт дальше, до задней сетки за коробкой
      const endX = (inBox ? halfL + F.goalBack : halfL) - r;
      if (b.x * sx > endX) {
        b.x = sx * endX;
        if (b.vx * sx > 0) {
          const impact = b.vx * sx;
          if (inBox) {
            b.vx = -sx * Math.min(impact * B.netRestitution, 0.35); b.vz *= 0.5; b.vy *= 0.6; // сетка вбирает удар: мяч остаётся в воротах
            if (impact > 0.8) events.push({ type: 'net', part: 'back', side: sx, speed: impact });
          } else {
            b.vx = -b.vx * B.wallRestitution;
            b.vz *= B.wallTangent; b.vy *= B.wallTangent; b.wy *= 0.6;
            if (impact > 0.6) events.push({ type: 'wall', surface: b.y < F.boardHeight ? 'board' : 'fence', speed: impact });
          }
        }
      }
      // гол: весь мяч за линией внутри рамы
      if (!behind || walled) b.inGoal = false;
      else if (inBox && b.x * sx - r > gx && !b.inGoal) { b.inGoal = true; events.push({ type: 'goal_line', side: sx }); }
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
