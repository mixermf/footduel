// LED-борта коробки: дальний длинный борт и четыре торцевые панели — экраны с бегущей рекламой вымышленных брендов.
// При голе на всех экранах (кроме прозрачного ближнего борта) — «ГОЛ!» в стиле старых приставок: вспышка, волна
// квадратиков от забитых ворот, мигание сменой палитры (≤2,5 Гц), счёт, распад квадратиками обратно в рекламу.
// Только изображение: симуляцию не трогает. Экран — маленький холст с пикселем = светодиод (NearestFilter),
// поверх — сетка светодиодов (aoMap). Материал неосвещённый и без тонмаппинга, чтобы жёлтый не выгорал в ACES.
import * as THREE from 'three';
import { t } from '../i18n/i18n.js';

const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROWS = 24; // строк светодиодов по высоте экрана
const PITCH = 0.84 / ROWS; // шаг светодиода, м
const BG = '#07090c';
const YEL = '#ffd400';
// яркость экрана в игре и на голе. Материал без тонмаппинга: множитель линейный, 0,32 ≈ 60% в sRGB —
// в игре борт приглушён и не спорит с белым мячом, на голе — полная яркость
const PLAY_LEVEL = 0.32, GOAL_LEVEL = 1.0;
const HOLD = 7.5, FPS = 30;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const FONT = (px) => `italic 900 ${px}px Impact, "Arial Black", "Segoe UI Black", sans-serif`;

// Маска букв → кадр: ядро цвета core, обводка 1 LED цветом rim и ещё 1 LED цветом edge (по 8 соседям)
function paintMask(m, w, h, core, rim, edge) {
  const grow = (a) => { const b = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (a[y * w + x]) { b[y * w + x] = 1; continue; } for (let dy = -1; dy <= 1 && !b[y * w + x]; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && a[Y * w + X]) { b[y * w + x] = 1; break; } } } return b; };
  const r1 = grow(m), r2 = grow(r1);
  const c = canvas(w, h), g = c.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, col = m[i] ? core : r1[i] ? rim : r2[i] ? edge : null;
    if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
  }
  return c;
}

// Надпись шрифтом системы в «светодиодный» вид: бинарная маска по альфе, затем обводки
function ledText(text, px, core, rim = '#ffffff', edge = '#000000', italic = true) {
  const g0 = canvas(8, 8).getContext('2d'); g0.font = italic ? FONT(px) : FONT(px).replace('italic ', '');
  const w = Math.ceil(g0.measureText(text).width) + 8, h = ROWS;
  const c = canvas(w, h), g = c.getContext('2d');
  // центр по реальным границам букв, а не по em-боксу: иначе заглавные с обводкой срезаются сверху или снизу
  g.font = g0.font; g.textBaseline = 'alphabetic'; g.textAlign = 'center'; g.fillStyle = '#fff';
  const tm = g.measureText(text);
  g.fillText(text, w / 2, Math.round(h / 2 + (tm.actualBoundingBoxAscent - tm.actualBoundingBoxDescent) / 2));
  const src = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = src[i * 4 + 3] > 120 ? 1 : 0;
  return paintMask(m, w, h, core, rim, edge);
}

// Пиксельный шрифт 5×7, как на старых приставках: им пишутся «ГОЛ!», очки и надписи финала (системный шрифт
// на 15 светодиодах теряет детали — G становится O). Строки сверху вниз, '#' — горящий светодиод.
const GLYPHS = {
  G: '.###.|#....|#....|#.###|#...#|#...#|.###.', O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.', A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####', 'Г': '#####|#....|#....|#....|#....|#....|#....', 'О': '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  'Л': '..###|.#..#|.#..#|.#..#|.#..#|#...#|#...#', 'П': '#####|#...#|#...#|#...#|#...#|#...#|#...#', 'Б': '#####|#....|#....|####.|#...#|#...#|####.',
  'Е': '#####|#....|#....|####.|#....|#....|#####', 'Д': '.###.|.#.#.|.#.#.|.#.#.|.#.#.|#####|#...#', 'А': '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  'Н': '#...#|#...#|#...#|#####|#...#|#...#|#...#', 'И': '#...#|#...#|#..##|#.#.#|##..#|#...#|#...#', 'Ч': '#...#|#...#|#...#|.####|....#|....#|....#',
  'Ь': '#....|#....|#....|####.|#...#|#...#|####.', 'Я': '.####|#...#|#...#|.####|..#.#|.#..#|#...#', 'М': '#...#|##.##|#.#.#|#...#|#...#|#...#|#...#',
  'Т': '#####|..#..|..#..|..#..|..#..|..#..|..#..', 'К': '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', 'З': '####.|....#|....#|.###.|....#|....#|####.',
  'Й': '.#.#.|#...#|#..##|#.#.#|##..#|#...#|#...#', '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..', '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.', '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '####.|....#|....#|.###.|....#|....#|####.', '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '.###.|#....|#....|####.|#...#|#...#|.###.', '7': '#####|....#|...#.|..#..|.#...|.#...|.#...', '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|....#|.###.',
};
export const pixFits = (text) => [...text].every((ch) => ch === ' ' || GLYPHS[ch]);

// надпись пиксельным шрифтом ×2 (14 строк) с обводками; лёгкий наклон: верхние строки сдвинуты вправо, как курсив
function pixText(text, core, rim, edge, k = 2) {
  const chars = [...text], gw = 5 * k, gap = k + 1, space = 3 * k, slant = k > 1 ? 3 : 1;
  const w = chars.reduce((s, ch) => s + (ch === ' ' ? space : gw + gap), 0) - gap + 4 + slant, h = ROWS;
  const m = new Uint8Array(w * h), top = Math.round((h - 7 * k) / 2);
  let x0 = 2;
  for (const ch of chars) {
    if (ch === ' ') { x0 += space; continue; }
    if (!GLYPHS[ch]) { x0 += space; continue; } // неизвестный знак — пробелом, а не падением
    const rows = GLYPHS[ch].split('|');
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (rows[r][c] !== '#') continue;
      for (let yy = 0; yy < k; yy++) {
        const y = top + r * k + yy, sh = Math.round(((7 * k - 1 - (r * k + yy)) / (7 * k - 1)) * slant);
        for (let xx = 0; xx < k; xx++) m[y * w + x0 + c * k + xx + sh] = 1;
      }
    }
    x0 += gw + gap;
  }
  return paintMask(m, w, h, core, rim, edge);
}
const bigText = (text, core, rim, edge) => (pixFits(text) ? pixText(text, core, rim, edge) : ledText(text, 19, core, rim, edge));

// недостающие буквы для рекламы: латиница брендов и кириллица слоганов (тот же формат 5×7)
Object.assign(GLYPHS, {
  B: '####.|#...#|#...#|####.|#...#|#...#|####.', C: '.###.|#...#|#....|#....|#....|#...#|.###.', D: '###..|#..#.|#...#|#...#|#...#|#..#.|###..',
  E: '#####|#....|#....|####.|#....|#....|#####', F: '#####|#....|#....|####.|#....|#....|#....', I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', N: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#', P: '####.|#...#|#...#|####.|#....|#....|#....',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#', S: '.####|#....|#....|.###.|....#|....#|####.', T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.', Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#', J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..', M: '#...#|##.##|#.#.#|#...#|#...#|#...#|#...#',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..', W: '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  '.': '.....|.....|.....|.....|.....|.##..|.##..', '·': '.....|.....|.....|.##..|.##..|.....|.....',
  'С': '.###.|#...#|#....|#....|#....|#...#|.###.', 'В': '####.|#...#|#...#|####.|#...#|#...#|####.', 'Р': '####.|#...#|#...#|####.|#....|#....|#....',
  'Ы': '#...#|#...#|#...#|###.#|#.#.#|#.#.#|###.#', 'Ш': '#...#|#...#|#.#.#|#.#.#|#.#.#|#.#.#|#####', 'Ё': '.#.#.|#####|#....|####.|#....|#....|#####', 'У': '#...#|#...#|#...#|.####|....#|....#|.###.',
});

// ---------- вымышленные бренды: оригинальные значки из светодиодных «пикселей» ----------
// Каждый значок рисуется в квадрате ROWS×ROWS. Никаких реальных товарных знаков: только своё.
// Белых круглых «мячей» в значках нет: на дальнем борту они были бы ложной целью рядом с настоящим мячом.
const ICONS = {
  // NYUK: пиксельная комета — оранжевое ядро с тремя линиями хвоста
  nyuk(g) {
    g.fillStyle = '#ff6a00'; for (let k = 0; k < 3; k++) g.fillRect(1 + k * 2, 7 + k * 4, 11 - k * 2, 2);
    g.fillStyle = '#ffb000'; g.beginPath(); g.arc(16, 12, 6.5, 0, 7); g.fill();
    g.fillStyle = '#ff6a00'; g.fillRect(14, 10, 4, 4); g.fillRect(12, 6, 2, 2); g.fillRect(19, 15, 2, 2);
  },
  // GOLAZO COLA: крышка от бутылки
  cola(g) {
    g.fillStyle = '#e8202a'; for (let a = 0; a < 16; a++) { const t = (a / 16) * Math.PI * 2; g.fillRect(12 + Math.cos(t) * 10 - 1, 12 + Math.sin(t) * 10 - 1, 3, 3); }
    g.beginPath(); g.arc(12, 12, 9, 0, 7); g.fill();
    g.fillStyle = '#ffc8c8'; g.fillRect(10, 8, 4, 4); g.fillRect(6, 13, 3, 3); g.fillRect(15, 13, 3, 3); g.fillRect(10, 16, 4, 2);
  },
  // BOOTZILLA: след динозавра с шипами бутсы
  zilla(g) {
    g.fillStyle = '#7cff2e'; g.beginPath(); g.ellipse(12, 15, 6, 7, 0, 0, 7); g.fill();
    for (const [x, y] of [[4, 4], [11, 1], [18, 4]]) { g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x + 2, y); g.lineTo(x + 4, y + 6); g.fill(); }
    g.fillStyle = BG; for (const [x, y] of [[9, 12], [13, 12], [9, 17], [13, 17]]) g.fillRect(x, y, 2, 2);
  },
  // KEEPR: перчатка вратаря
  keepr(g) {
    g.fillStyle = '#22d3ee'; g.fillRect(6, 10, 12, 11); for (let k = 0; k < 4; k++) g.fillRect(6 + k * 3, 3 + (k === 0 || k === 3 ? 3 : 0), 2, 9);
    g.fillRect(2, 12, 5, 3); g.fillStyle = '#0e7f92'; g.fillRect(6, 18, 12, 2);
  },
  // BALLBURGER: бургер с кунжутом
  burger(g) {
    g.fillStyle = '#ffc21a'; g.beginPath(); g.ellipse(12, 9, 10, 6, 0, Math.PI, 0); g.fill(); g.fillRect(2, 9, 20, 2);
    g.fillStyle = '#fff2b0'; g.fillRect(10, 5, 2, 1); g.fillRect(5, 7, 2, 1); g.fillRect(16, 7, 2, 1);
    g.fillStyle = '#7cff2e'; g.fillRect(2, 12, 20, 1); g.fillStyle = '#d7261e'; g.fillRect(2, 13, 20, 3);
    g.fillStyle = '#ffc21a'; g.fillRect(3, 17, 18, 3);
  },
  // ROCKET SOCKS: гетра с пламенем
  socks(g) {
    g.fillStyle = '#ffd400'; g.fillRect(4, 19, 3, 3); g.fillRect(2, 15, 4, 3); g.fillStyle = '#ff6a00'; g.fillRect(5, 17, 3, 4);
    g.fillStyle = '#ff2ec4'; g.fillRect(10, 2, 7, 13); g.fillRect(8, 13, 9, 6); g.fillStyle = '#ffd400'; g.fillRect(10, 5, 7, 2); g.fillRect(10, 9, 7, 2);
  },
  // домашний значок турнира: кубок
  cup(g) {
    g.fillStyle = '#ffd400'; g.fillRect(6, 3, 12, 9); g.fillRect(8, 12, 8, 2); g.fillRect(10, 14, 4, 4); g.fillRect(7, 18, 10, 3);
    g.fillRect(3, 4, 3, 2); g.fillRect(3, 4, 2, 5); g.fillRect(18, 4, 3, 2); g.fillRect(19, 4, 2, 5);
    g.fillStyle = '#b88a00'; g.fillRect(9, 5, 2, 5);
  },
};

// цвет имени — фирменный (не белый: белое на дальнем борту спорит с мячом); слоганы — приглушённо-серые,
// текст слогана — по языку игрока (slogan.<id> в src/i18n/i18n.js)
export const BRANDS = [
  { id: 'nyuk', name: 'NYUK', color: '#ff6a00' },
  { id: 'cola', name: 'GOLAZO COLA', color: '#ff3b44' },
  { id: 'zilla', name: 'BOOTZILLA', color: '#7cff2e' },
  { id: 'keepr', name: 'KEEPR', color: '#22d3ee' },
  { id: 'burger', name: 'BALLBURGER', color: '#ffc21a' },
  { id: 'socks', name: 'ROCKET SOCKS', color: '#ff2ec4' },
  { id: 'cup', name: 'STREET CUP', color: '#ffd400' },
];
const SLOGAN = '#aeb8c6';

function icon(id) { const c = canvas(ROWS, ROWS), g = c.getContext('2d'); ICONS[id](g); return c; }

// Кадр рекламы для экрана шириной w. Дальний борт: плитки «значок + имя» или «значок | слоган», повторённые,
// как на настоящих бортах. Узкий торец: значок и имя мелким шрифтом, а если не влезает — один значок по центру.
function adFrame(w, brand, alt) {
  const c = canvas(w, ROWS), g = c.getContext('2d');
  g.fillStyle = BG; g.fillRect(0, 0, w, ROWS);
  const ic = icon(brand.id);
  const label = pixText(brand.name, brand.color, null, null, 2);
  const slogan = pixText(t('slogan.' + brand.id), SLOGAN, null, null, 2);
  const tileW = alt ? slogan.width + ROWS + 10 : ic.width + label.width + 4;
  if (w < tileW + 8) {
    const small = pixText(brand.name, brand.color, null, null, 1);
    if (small.width + ROWS + 2 <= w) { const x = Math.round((w - small.width - ROWS - 2) / 2); g.drawImage(ic, x, 0); g.drawImage(small, x + ROWS + 2, 0); }
    else g.drawImage(ic, Math.round((w - ROWS) / 2), 0);
    return c;
  }
  const n = Math.max(1, Math.floor(w / (tileW + 30))), gap = (w - n * tileW) / n;
  for (let k = 0; k < n; k++) {
    const x = Math.round(gap / 2 + k * (tileW + gap));
    g.drawImage(ic, x, 0);
    if (alt) { g.fillStyle = brand.color; g.fillRect(x + ROWS + 3, 6, 2, ROWS - 12); g.drawImage(slogan, x + ROWS + 8, 0); }
    else g.drawImage(label, x + ROWS + 4, 0);
  }
  return c;
}

// Кадр гола: повторяющиеся «ГОЛ!» и «GOAL!» со звёздочками между ними; палитра a или b (для мигания)
function goalFrame(w, words, bg, pal) {
  const c = canvas(w, ROWS), g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, ROWS);
  const tiles = words.map((t) => bigText(t, pal.core, pal.rim, '#000000'));
  const star = canvas(9, ROWS), sg = star.getContext('2d'); sg.fillStyle = pal.core;
  for (const [x, y, ww, hh] of [[4, 6, 1, 13], [1, 12, 7, 1], [2, 9, 5, 7], [3, 8, 3, 9]]) sg.fillRect(x, y, ww, hh);
  let x = 0, i = 0;
  const seq = [];
  // собрать ряд нужной длины и отцентровать
  while (true) {
    const t = tiles[i % tiles.length];
    if (x + t.width > w && seq.length) break;
    seq.push(t); x += t.width + 16; i++;
    if (x > w) break;
  }
  let total = seq.reduce((s, t) => s + t.width, 0) + (seq.length - 1) * 16;
  if (total > w && seq.length > 1) { seq.pop(); total = seq.reduce((s, t) => s + t.width, 0) + (seq.length - 1) * 16; }
  x = Math.round((w - total) / 2);
  seq.forEach((t, k) => {
    const dw = Math.min(t.width, w); g.drawImage(t, x, 0, dw, ROWS);
    if (k < seq.length - 1) g.drawImage(star, x + t.width + 4, 0);
    x += t.width + 16;
  });
  return c;
}

// надпись на все экраны; на узком торце — мелким шрифтом, если крупный не влезает
function textFrame(w, text, color, bg = BG) {
  const c = canvas(w, ROWS), g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, ROWS);
  let t = bigText(text, color, '#ffffff', '#000000');
  if (t.width > w && pixFits(text)) t = pixText(text, color, '#ffffff', '#000000', 1);
  const n = Math.max(1, Math.floor(w / (t.width + 40)));
  for (let k = 0; k < n; k++) { const dw = Math.min(t.width, w); g.drawImage(t, Math.round((k + 0.5) * (w / n) - dw / 2), 0, dw, ROWS); }
  return c;
}

// сетка светодиодов: светлая точка с тёмным зазором; мипмапы сглаживают её издалека, чтобы не было муара
function ledGrid() {
  const c = canvas(8, 8), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 8, 8);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(4, 4, 3.3, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

class Screen {
  constructor(w) {
    this.w = w; this.c = canvas(w, ROWS); this.g = this.c.getContext('2d');
    this.g.imageSmoothingEnabled = false;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = THREE.NearestFilter; this.tex.minFilter = THREE.LinearFilter; this.tex.generateMipmaps = false;
    this.grid = ledGrid(); this.grid.repeat.set(w, ROWS);
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, aoMap: this.grid, aoMapIntensity: 0.5, toneMapped: false });
    this.mat.color.setScalar(PLAY_LEVEL);
  }
  show(frame) { this.g.drawImage(frame, 0, 0); this.tex.needsUpdate = true; }
}


export class LedBoards {
  constructor(scene, F) {
    const L = F.length, W = F.width, gw = F.goalWidth, endLen = (W - gw) / 2;
    const y0 = F.boardHeight - 0.08 - (ROWS * PITCH) / 2; // экран под командной полосой по верху борта
    this.F = F;
    this.far = new Screen(Math.round(L / PITCH));
    this.end = new Screen(Math.round(endLen / PITCH));
    const plane = (screen, w, x, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, ROWS * PITCH), screen.mat);
      m.position.set(x, y0, z); m.rotation.y = ry; m.renderOrder = 1; scene.add(m);
      return m;
    };
    plane(this.far, L, 0, -W / 2 + 0.006, 0);
    // торцы: лицом в поле; поворот -sx·π/2 — текст читается слева направо с обеих сторон
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) plane(this.end, endLen, sx * (L / 2 - 0.006), sz * (gw / 2 + endLen / 2), -sx * Math.PI / 2);
    this.screens = [this.far, this.end];
    this._goalPal = [{ core: YEL, rim: '#ffffff' }, { core: '#ffffff', rim: YEL }];
    this._yellow = this.screens.map((s) => { const c = canvas(s.w, ROWS), g = c.getContext('2d'); g.fillStyle = YEL; g.fillRect(0, 0, s.w, ROWS); return c; });
    this._build();
    this.slide = 0; this.alt = 0; this.holdT = HOLD * 0.6;
    this.trans = null; // переход между кадрами
    this.show = null; // постановка (гол, финал)
    this.level = PLAY_LEVEL; this._acc = 0; this._rnd = rng(77);
    this.bulbs = null; // лампочки гирлянды (задаёт сцена) — бегущий огонь на голе
    for (const s of this.screens) s.show(this._adFrame(s));
  }

  // кадры, зависящие от языка: реклама (слоганы) и надписи гола. Кадры гола готовим заранее —
  // построение маски на лету дало бы рывок в первый же гол
  _build() {
    this.ads = BRANDS.map((b) => ({ far: [adFrame(this.far.w, b, false), adFrame(this.far.w, b, true)], end: adFrame(this.end.w, b, false) }));
    this._goalCache = new Map();
    this.words = t('led.goal'); this.cornerWords = t('led.corner');
    for (let i = 0; i < 2; i++) { this._goalFrames('w' + i, this.words, BG, this._goalPal[i]); this._goalFrames('c' + i, this.cornerWords, BG, this._goalPal[i]); }
  }

  // смена языка: пересобрать кадры; если сейчас реклама — сразу показать её на новом языке
  relocalize() {
    this._build();
    if (!this.show && !this.trans) for (const s of this.screens) s.show(this._adFrame(s));
  }

  _adFrame(s, slide = this.slide, alt = this.alt) { const a = this.ads[slide]; return s === this.far ? a.far[alt] : a.end; }
  _adsNow() { return this.screens.map((s) => this._adFrame(s)); }

  _goalFrames(key, words, bg, pal) {
    if (!this._goalCache.has(key)) {
      if (this._goalCache.size > 24) for (const k of [...this._goalCache.keys()]) if (!/^[wc]\d$/.test(k)) this._goalCache.delete(k); // очки за гол каждый раз свои
      this._goalCache.set(key, this.screens.map((s) => goalFrame(s.w, words, bg, pal)));
    }
    return this._goalCache.get(key);
  }

  // переход к кадрам next (по одному на экран). kind: wipe | blocks | roll | cut; from — сторона, откуда идёт волна (-1 слева)
  _go(next, kind, dur, from = -1, edge = '#ffffff') {
    if (reduced) kind = 'cut';
    if (kind === 'cut') { this.screens.forEach((s, i) => s.show(next[i])); this.trans = null; return; }
    // снимок текущих кадров — в постоянные холсты, без новых на каждый переход
    this._prev = this._prev || this.screens.map((s) => canvas(s.w, ROWS));
    const prev = this._prev.map((c, i) => { const g = c.getContext('2d'); g.clearRect(0, 0, c.width, ROWS); g.drawImage(this.screens[i].c, 0, 0); return c; });
    // порядок квадратиков 4×4: по расстоянию от стороны from со случайным разбросом — волна, а не шум
    const order = this.screens.map((s) => {
      const cells = [];
      for (let x = 0; x < s.w; x += 4) for (let y = 0; y < ROWS; y += 4) {
        const u = from < 0 ? x / s.w : 1 - x / s.w;
        cells.push({ x, y, k: from === 0 ? this._rnd() : u * 0.75 + this._rnd() * 0.25 });
      }
      return cells.sort((a, b) => a.k - b.k);
    });
    this.trans = { prev, next, kind, dur, t: 0, from, order, done: [0, 0], edge };
  }

  _drawTrans() {
    const T = this.trans, u = Math.min(1, T.t / T.dur);
    this.screens.forEach((s, i) => {
      const g = s.g, a = T.prev[i], b = T.next[i], w = s.w;
      if (T.kind === 'wipe') {
        const x = Math.round(u * w), left = T.from >= 0;
        g.drawImage(a, 0, 0);
        if (left) g.drawImage(b, 0, 0, x, ROWS, 0, 0, x, ROWS); else g.drawImage(b, w - x, 0, x, ROWS, w - x, 0, x, ROWS);
        if (u < 1) { g.fillStyle = T.edge; g.fillRect(left ? x : w - x - 2, 0, 2, ROWS); }
      } else if (T.kind === 'roll') {
        const dy = Math.round(u * ROWS);
        g.drawImage(a, 0, -dy); g.drawImage(b, 0, ROWS - dy);
      } else {
        // квадратики: дорисовываем только новые; свежие на мгновение горят белым — «переворот» ячеек
        const cells = T.order[i], n = Math.floor(u * cells.length), from = Math.max(0, T.done[i] - 10);
        for (let k = from; k < n; k++) { const c = cells[k]; g.drawImage(b, c.x, c.y, 4, 4, c.x, c.y, 4, 4); }
        g.fillStyle = T.edge;
        for (let k = n; k < Math.min(cells.length, n + 10); k++) { const c = cells[k]; g.fillRect(c.x, c.y, 4, 4); }
        T.done[i] = n;
      }
      s.tex.needsUpdate = true;
    });
    if (u >= 1) { this.screens.forEach((s, i) => s.show(T.next[i])); this.trans = null; }
  }

  _setLevel(v) { this.level = v; for (const s of this.screens) s.mat.color.setScalar(v); }

  // Гол. mine — гол «наш» (золотая постановка), иначе — в цвете команды забившего, без вспышки и мигания.
  // side — ворота, в которые забили (-1 левые, 1 правые): волна идёт от них. pts — очки за гол («+pts» в конце)
  // corner — гол в девятку: вместо «ГОЛ!» на экранах «В ДЕВЯТКУ!»
  goal({ mine = true, kit = YEL, side = 1, pts = 0, corner = false } = {}) {
    const ptsFrames = mine && pts ? [this._goalFrames(`+${pts}`, [`+${pts}`], pts >= 200 ? '#1a1400' : BG, this._goalPal[0])] : null;
    this.show = { kind: 'goal', t: 0, mine, kit, side, pts, step: -1, ptsFrames, wk: corner ? 'c' : 'w', words: corner ? this.cornerWords : this.words };
    if (this.bulbs) this.bulbChase = { t: 0, color: new THREE.Color(mine ? YEL : kit) };
  }

  // надпись на всех экранах: финал матча (держится), золотой гол (короткая и тусклее — игра уже идёт)
  finish(text, color = YEL, { hold = 3.2, level = 0.9, enter = 'blocks', exit = 'roll' } = {}) {
    const f = this.screens.map((s) => textFrame(s.w, text, color));
    this.show = { kind: 'finish', t: 0, step: -1, f, hold, level, enter, exit };
  }

  // короткая вспышка надписи посреди игры (штанга, перекладина): только если экраны свободны, без мигания, тусклее гола
  flash(text, color = '#dfe8f4') {
    if (this.show) return;
    this.finish(text, color, { hold: 0.6, level: 0.55, enter: 'wipe', exit: 'blocks' });
  }

  // розыгрыш с центра: всё праздничное сворачивается, борта возвращаются к рекламе в игровой яркости
  calm() {
    const S = this.show;
    if (!S || S.kind !== 'goal' || S.step === 9) return;
    S.step = 9; S.t = Math.max(S.t, 1.15);
    this._go(this._adsNow(), 'blocks', 0.25, 0);
  }

  _endShow() { this.show = null; this._setLevel(PLAY_LEVEL); this.holdT = HOLD; }

  // Сценарий гола укладывается в паузу перед розыгрышем (1,3 с):
  // свой — 0 вспышка, 70 волна квадратиков, 300–900 мигание «ГОЛ!/GOAL!» 200/200 мс, 900–1150 «+очки», 1150 распад;
  // чужой — квадратики цветом соперника и один пульс яркости, с 1000 мс распад.
  _goalStep(S, dt) {
    S.t += dt;
    const ms = S.t * 1000;
    if (reduced) {
      if (S.step < 0) { S.step = 0; this._setLevel(GOAL_LEVEL); this._go(this._goalFrames(S.wk + '0', S.words, BG, this._goalPal[0]), 'cut'); }
      if (ms > 1200) { this._go(this._adsNow(), 'cut'); this._endShow(); }
      return;
    }
    if (!S.mine) {
      if (S.step < 0) { S.step = 0; this._go(this._goalFrames('k' + S.kit, [t('led.foeGoal')], BG, { core: S.kit, rim: '#ffffff' }), 'blocks', 0.3, S.side); }
      if (S.step < 9) this._setLevel(PLAY_LEVEL + 0.3 * Math.sin(Math.min(1, ms / 1000) * Math.PI));
      if (ms > 1000 && S.step === 0) { S.step = 9; this._go(this._adsNow(), 'blocks', 0.3, 0); }
    } else {
      if (S.step < 0) { S.step = 0; this._setLevel(GOAL_LEVEL); this._go(this._yellow, 'cut'); }
      if (S.step === 0 && ms > 70) { S.step = 1; this._go(this._goalFrames(S.wk + '0', S.words, BG, this._goalPal[0]), 'blocks', 0.22, S.side); }
      if (S.step >= 1 && S.step < 9 && ms > 300 && !this.trans) {
        const ph = Math.floor((ms - 300) / 200); // 0,1,2 — мигание палитрой; 3 — очки; дальше — распад
        if (ms >= 1150) { S.step = 9; this._go(this._adsNow(), 'blocks', 0.3, 0); }
        else if (ph + 2 !== S.step) {
          S.step = ph + 2;
          const f = ph >= 3 && S.ptsFrames ? S.ptsFrames[0] : this._goalFrames(S.wk + (ph % 2), S.words, BG, this._goalPal[ph % 2]);
          this._go(f, 'cut');
        }
      }
    }
    if (S.step === 9) this._setLevel(Math.max(PLAY_LEVEL, this.level - dt * 2.4));
    if (S.step === 9 && !this.trans && this.level <= PLAY_LEVEL) this._endShow();
  }

  // ballZ, ballY — где мяч: если он у дальнего борта, смена слайда подождёт (белый мяч не теряется на переходе)
  update(dt, ballZ = 0, ballY = 0) {
    this._acc += dt;
    this._bulbs(dt);
    const S = this.show;
    if (S) {
      if (S.kind === 'goal') this._goalStep(S, dt);
      else if (S.kind === 'finish') {
        S.t += dt;
        if (S.step < 0) { S.step = 0; this._setLevel(S.level); this._go(S.f, S.enter, S.enter === 'wipe' ? 0.18 : 0.35, 0); }
        if (S.t > S.hold && S.step === 0) { S.step = 1; this._go(this._adsNow(), S.exit, 0.25, 0); }
        if (S.step === 1 && !this.trans) this._endShow();
      }
    } else {
      this.holdT -= dt;
      const nearFar = ballZ < -this.F.width / 2 + 2 && ballY < 1.5;
      if (this.holdT <= 0 && !this.trans && !nearFar) {
        // каждый бренд: имя, потом слоган; затем следующий бренд
        if (this.alt === 0) this.alt = 1; else { this.alt = 0; this.slide = (this.slide + 1) % this.ads.length; }
        this.holdT = this.alt ? HOLD * 0.55 : HOLD;
        const kinds = ['wipe', 'blocks', 'roll'], kind = this.alt ? 'roll' : kinds[this.slide % kinds.length];
        this._go(this._adsNow(), kind, kind === 'roll' ? 0.25 : kind === 'wipe' ? 0.32 : 0.42, this.slide % 2 ? 1 : -1, BRANDS[this.slide].color);
      }
    }
    if (this.trans) {
      this.trans.t += dt;
      // переходы рисуем не чаще FPS; последний кадр — всегда
      if (this._acc >= 1 / FPS || this.trans.t >= this.trans.dur) { this._acc = 0; this._drawTrans(); }
    }
  }

  // гирлянда: бегущий огонь цветом гола ~2 секунды (30 лампочек/с — мягче 3 Гц), затем обычный тёплый свет
  _bulbs(dt) {
    const B = this.bulbs, C = this.bulbChase;
    if (!B || !C) return;
    C.t += dt;
    const warm = this._warm || (this._warm = new THREE.Color(0xfff2c8));
    if (C.t > 2.0 || reduced) { for (const b of B) b.material.color.copy(warm); this.bulbChase = null; return; }
    const head = C.t * 30;
    B.forEach((b, i) => { const d = (head - i) % 12; b.material.color.copy(d >= 0 && d < 4 ? C.color : warm); });
  }
}
