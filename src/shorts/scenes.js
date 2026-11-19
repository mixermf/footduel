// Шортс-сцены: заскриптованные эпизоды матча для вертикальных видео 9:16 (20–30 с). Только dev-сервер.
// Каждая сцена детерминирована: расстановка + ввод обоих игроков по шагам симуляции (src/shorts/script.js), поэтому
// результат одинаков при каждом запуске, при замедлении и в повторе. Проверка: node scripts/shorts-check.mjs
//
// Поля сцены (время — секунды симуляции от начала, кроме sec — реальные секунды):
//   stage(w)        — расстановка: игроки, мяч, очки, часы
//   players         — ввод игроков [синий, красный], см. script.js
//   hook            — стоп-кадр в начале: { sec, cam } и титры с from: 0 — крючок первых секунд
//   cams            — камера по времени: { t, shot, blend } (shot — пресет из director.js или объект)
//   slow            — замедление: [from, to, scale]
//   captions        — титры: { from, to, text, at: 'top' | 'mid' | 'low', size: 'xl' | 'l' | 'm', color }
//   live            — где кончается живая часть
//   replays         — повторы после живой части: { from, to, scale, cams, label }
//   outro           — финальный стоп-кадр: { sec, text, sub }
//   expect          — что обязано случиться (для проверки): goal — кто забил и с какими бонусами
import { place, setBall } from './script.js';

const NAMES = ['ТЫ', 'ДРУГ'];

export const SCENES = [
  {
    id: 'bike',
    title: 'Через себя на последней секунде',
    seed: 2, names: NAMES,
    stage(w) {
      place(w, 0, -0.5, 0.8, Math.PI); place(w, 1, 2.5, 0.3, Math.PI); setBall(w, 2.0, 0.3);
      w.toucher = 1; w.points[0] = 400; w.points[1] = 600; w.clock = 2.25;
    },
    players: [
      [{ from: 0.5, to: 1.8, go: [-4.4, 0.1], sprint: true }, { at: 1.3, press: 'kick' }, { from: 1.3, to: 2.8, hold: 'kick' }, { at: 1.3, press: 'jump' }],
      [{ at: 0.4, press: 'lob' }, { from: 0.4, to: 0.55, hold: 'lob' }],
    ],
    hook: { sec: 2.6 },
    cams: [{ t: 0, shot: 'behindOpp' }, { t: 0.75, shot: 'chaseBack', blend: 0.5 }, { t: 2.12, shot: 'reverse' }, { t: 2.6, shot: 'celebrate', blend: 0.4 }],
    slow: [[1.55, 2.12, 0.28], [2.12, 2.5, 0.6], [2.52, 3.6, 0.55]],
    captions: [
      { from: 0, to: 0.01, text: '−200 ОЧКОВ', at: 'top', size: 'xl', color: '#ff6b6b' },
      { from: 0, to: 0.01, text: '3 секунды до конца матча', at: 'top2', size: 'm' },
      { from: 0.75, to: 1.5, text: 'Он бьёт парашютом…', at: 'low', size: 'm' },
      { from: 1.55, to: 2.12, text: 'ЧЕРЕЗ СЕБЯ?!', at: 'low', size: 'xl' },
      { from: 2.15, to: 2.5, text: 'СИРЕНА!', at: 'low', size: 'l', color: '#ffd34d' },
    ],
    live: 3.6,
    replays: [
      { from: 1.0, to: 2.6, scale: 0.4, cams: [{ t: 1.0, shot: 'sideHero' }, { t: 2.05, shot: 'reverse' }], label: 'ПОВТОР' },
      { from: 1.75, to: 2.6, scale: 0.18, cams: [{ t: 1.75, shot: 'lowHero' }, { t: 2.1, shot: 'reverse' }], label: 'ПОВТОР · ×0.2' },
    ],
    outro: { sec: 3, text: 'ЧЕРЕЗ СЕБЯ НА СИРЕНЕ', sub: 'Повторишь?' },
    expect: { goal: { by: 0, bonus: ['bike'] }, winner: 0, buzzerBeforeGoal: true },
  },
  {
    id: 'rocket',
    title: 'Ракета: две перекладины и в сетку',
    seed: 3, names: NAMES,
    stage(w) {
      place(w, 0, -6.5, 0.4, 0); place(w, 1, 7.3, -1.6, Math.PI); setBall(w, -5.95, 0.4);
      w.toucher = 0; w.points[0] = 200; w.points[1] = 300; w.clock = 74;
    },
    players: [
      [{ at: 0.3, press: 'kick' }, { from: 0.3, to: 1.1, hold: 'kick' }, { from: 0.3, to: 0.3 + 8 / 120, move: [1, 0] }],
      [{ from: 1.3, to: 1.75, go: [7.3, -0.6] }, { at: 1.8, press: 'jump' }],
    ],
    hook: { sec: 2.2 },
    cams: [{ t: 0, shot: 'longView' }, { t: 1.3, shot: 'ballChase' }, { t: 1.92, shot: 'goalSide' }, { t: 2.5, shot: 'celebrate', blend: 0.5 }],
    slow: [[1.85, 2.5, 0.22], [2.5, 3.6, 0.5]],
    captions: [
      { from: 0, to: 0.01, text: 'УДАР ЧЕРЕЗ ВСЁ ПОЛЕ', at: 'top', size: 'l' },
      { from: 0, to: 0.01, text: '15 метров до ворот', at: 'top2', size: 'm' },
      { from: 2.0, to: 2.3, text: 'ПЕРЕКЛАДИНА…', at: 'low', size: 'l' },
      { from: 2.3, to: 2.6, text: '…И ЕЩЁ РАЗ?!', at: 'low', size: 'l', color: '#ffd34d' },
    ],
    live: 3.6,
    replays: [
      { from: 0.9, to: 2.8, scale: 0.45, cams: [{ t: 0.9, shot: 'shooterLow' }, { t: 1.35, shot: 'ballChase', blend: 0.4 }], label: 'ПОВТОР' },
      { from: 1.9, to: 2.7, scale: 0.15, cams: [{ t: 1.9, shot: 'barCam' }], label: 'ПОВТОР · ×0.15' },
    ],
    outro: { sec: 3, text: 'ДВЕ ПЕРЕКЛАДИНЫ И ГОЛ', sub: '+350 за один удар' },
    expect: { goal: { by: 0, bonus: ['bar', 'long'] }, posts: 2 },
  },
  {
    id: 'lob',
    title: 'Парашют через выбежавшего',
    seed: 1, names: NAMES,
    stage(w) {
      place(w, 0, -2, 0.3, 0); place(w, 1, 6.5, 0.2, Math.PI); setBall(w, -1.45, 0.3);
      w.toucher = 0; w.points[0] = 300; w.points[1] = 300; w.clock = 41;
    },
    players: [
      [{ at: 0.6, press: 'lob' }, { from: 0.6, to: 0.6 + 20 / 120, hold: 'lob' }],
      [{ from: 0, to: 2, go: [2.2, 0.3], sprint: true }, { at: 1.3, press: 'jump' }],
    ],
    hook: { sec: 2.0 },
    cams: [{ t: 0, shot: 'behind' }, { t: 1.0, shot: 'lobArc', blend: 0.6 }, { t: 2.55, shot: 'reverse', blend: 0.3 }, { t: 3.32, shot: 'celebrate', blend: 0.5 }],
    slow: [[0.85, 1.6, 0.3], [2.6, 3.26, 0.4], [3.26, 4.3, 0.6]],
    captions: [
      { from: 0, to: 0.01, text: 'ОН ВЫБЕЖАЛ НА МЕНЯ', at: 'top', size: 'l' },
      { from: 0, to: 0.01, text: 'зря', at: 'top2', size: 'm' },
      { from: 0.85, to: 1.6, text: 'ПАРАШЮТ 🪂', at: 'low', size: 'xl' },
      { from: 2.0, to: 3.0, text: 'не достаёт…', at: 'low', size: 'm' },
    ],
    live: 4.3,
    replays: [
      { from: 0.4, to: 3.4, scale: 0.5, cams: [{ t: 0.4, shot: 'behind' }, { t: 1.0, shot: 'lobArc', blend: 0.4 }, { t: 2.4, shot: 'reverse', blend: 0.3 }], label: 'ПОВТОР' },
      { from: 2.3, to: 3.35, scale: 0.25, cams: [{ t: 2.3, shot: 'reverse' }], label: 'ПОВТОР · ×0.25' },
    ],
    outro: { sec: 3, text: 'ПАРАШЮТ ЗА ШИВОРОТ', sub: 'Не выбегай из ворот' },
    expect: { goal: { by: 0, bonus: ['lob'] } },
  },
  {
    id: 'greed',
    title: 'Жадность наказана',
    seed: 5, names: NAMES,
    stage(w) {
      place(w, 0, -4.5, -0.2, 0); place(w, 1, 2.6, -0.6, Math.PI); setBall(w, 2.05, -0.6);
      w.toucher = 1; w.points[0] = 150; w.points[1] = 250; w.clock = 96;
    },
    players: [
      [{ at: 8.45, press: 'kick' }, { from: 8.45, to: 9.25, hold: 'kick' }, { at: 8.45, press: 'jump' }],
      [{ at: 0.3, press: 'jump' }, { at: 7.5, press: 'jump' }, { at: 8.3, press: 'kick' }, { from: 8.3, to: 9.5, hold: 'kick' }, { at: 8.3, press: 'jump' }],
    ],
    hook: { sec: 1.6 },
    cams: [{ t: 0, shot: 'oppHero' }, { t: 3.3, shot: 'oppWide', blend: 1.2 }, { t: 8.82, shot: 'returnCam' }, { t: 9.0, shot: 'reverse' }, { t: 9.55, shot: 'celebrate', blend: 0.5 }],
    slow: [[0, 3.3, 1.6], [3.3, 7.4, 1.25], [8.45, 9.05, 0.3], [9.05, 9.47, 0.6], [9.47, 10.6, 0.55]],
    captions: [
      { from: 0, to: 0.01, text: 'ДРУГ РЕШИЛ ПОКРАСОВАТЬСЯ', at: 'top', size: 'l' },
      { from: 0.4, to: 3.5, text: 'чеканит на своей половине…', at: 'low', size: 'm' },
      { from: 3.5, to: 5.0, text: 'держать мяч больше 5 секунд нельзя', at: 'low', size: 'm' },
      { from: 5.0, to: 8.2, text: 'ШТРАФ −50 КАЖДУЮ СЕКУНДУ', at: 'low', size: 'l', color: '#ff6b6b' },
      { from: 8.3, to: 8.8, text: 'и ещё бьёт…', at: 'low', size: 'm' },
      { from: 8.8, to: 9.5, text: 'В КАСАНИЕ!', at: 'low', size: 'xl', color: '#ffd34d' },
    ],
    live: 10.6,
    replays: [
      { from: 8.2, to: 9.6, scale: 0.35, cams: [{ t: 8.2, shot: 'oppWide' }, { t: 8.82, shot: 'sideHero' }, { t: 9.0, shot: 'reverse' }], label: 'ПОВТОР' },
      { from: 8.8, to: 9.55, scale: 0.25, cams: [{ t: 8.8, shot: 'reverse' }], label: 'ПОВТОР · ×0.25' },
    ],
    outro: { sec: 3, text: '−200 ЗА ПОНТЫ', sub: 'и ещё +250 сопернику' },
    expect: { goal: { by: 0, bonus: ['fly'] }, penalties: { pi: 1, min: 4 } },
  },
  {
    id: 'golden',
    title: 'Золотой гол с чеканки',
    seed: 2, names: NAMES,
    stage(w) {
      place(w, 0, -2.5, 0.8, 0); place(w, 1, 4.5, -1.5, Math.PI); setBall(w, -1.95, 0.8);
      w.toucher = 0; w.points[0] = 500; w.points[1] = 500; w.clock = 0; w.overtime = true; w.otT = 21;
    },
    players: [
      [{ at: 0.3, press: 'jump' }, { at: 3.0, press: 'jump' }, { at: 3.3, press: 'kick' }, { from: 3.3, to: 4.5, hold: 'kick' }, { at: 3.3, press: 'jump' }],
      [{ from: 1.2, to: 3.2, go: [3.4, -0.6] }, { from: 3.7, to: 4.4, go: [3.0, 2.0], sprint: true }],
    ],
    hook: { sec: 2.0 },
    cams: [{ t: 0, shot: 'juggleCam' }, { t: 3.3, shot: 'sideHero', blend: 0.3 }, { t: 3.7, shot: 'reverse', blend: 0.25 }, { t: 4.2, shot: 'celebrate', blend: 0.5 }],
    slow: [[3.35, 3.7, 0.25], [3.7, 4.13, 0.55], [4.13, 5.3, 0.6]],
    captions: [
      { from: 0, to: 0.01, text: '500 : 500', at: 'top', size: 'xl' },
      { from: 0, to: 0.01, text: 'золотой гол: кто первый — тот победил', at: 'top2', size: 'm' },
      { from: 0.4, to: 3.2, text: 'без паники…', at: 'low', size: 'm' },
      { from: 3.4, to: 3.75, text: 'НОЖНИЦЫ!', at: 'low', size: 'xl', color: '#ffd34d' },
    ],
    live: 5.3,
    replays: [
      { from: 2.4, to: 4.2, scale: 0.35, cams: [{ t: 2.4, shot: 'lowHero' }, { t: 3.6, shot: 'reverse' }], label: 'ПОВТОР' },
      { from: 3.35, to: 3.75, scale: 0.12, cams: [{ t: 3.35, shot: 'sideHero' }], label: 'ПОВТОР · ×0.1' },
    ],
    outro: { sec: 3, text: 'ЗОЛОТОЙ ГОЛ', sub: 'с чеканки ударом в полёте' },
    expect: { goal: { by: 0, bonus: ['fly', 'juggle'] }, winner: 0 },
  },
  {
    id: 'fail',
    title: 'Ракета… в свои ворота',
    seed: 2, names: NAMES,
    stage(w) {
      place(w, 0, -7.2, 0.4, 0); place(w, 1, 7.4, 2.5, Math.PI); setBall(w, -6.65, 0.4);
      w.toucher = 0; w.points[0] = 300; w.points[1] = 300; w.clock = 52;
    },
    players: [
      [{ at: 0.3, press: 'kick' }, { from: 0.3, to: 1.1, hold: 'kick' }, { from: 0.3, to: 0.3 + 8 / 120, move: [1, 0] }, { from: 1.6, to: 2.4, go: [-5.2, 0.2] }],
      [],
    ],
    hook: { sec: 2.0 },
    cams: [{ t: 0, shot: 'longView' }, { t: 1.3, shot: 'ballChase' }, { t: 1.98, shot: 'goalSide' }, { t: 2.2, shot: 'longViewBack', blend: 0.7 }, { t: 3.98, shot: 'celebrateOpp', blend: 0.5 }],
    slow: [[1.9, 2.3, 0.3], [3.5, 3.91, 0.4], [3.91, 5.0, 0.6]],
    captions: [
      { from: 0, to: 0.01, text: 'СМОТРИ, КАК НАДО', at: 'top', size: 'l' },
      { from: 2.0, to: 2.4, text: 'ПЕРЕКЛАДИНА!', at: 'low', size: 'l' },
      { from: 2.5, to: 3.5, text: 'стоп… куда он летит?', at: 'low', size: 'm' },
      { from: 3.5, to: 5.0, text: '💀💀💀', at: 'low', size: 'xl' },
    ],
    live: 5.0,
    replays: [
      { from: 1.2, to: 4.1, scale: 0.5, cams: [{ t: 1.2, shot: 'longView' }, { t: 2.3, shot: 'longViewBack', blend: 0.5 }], label: 'ПОВТОР' },
      { from: 3.2, to: 4.05, scale: 0.3, cams: [{ t: 3.2, shot: 'reverseOwn' }], label: 'ПОВТОР · ×0.3' },
    ],
    outro: { sec: 3, text: 'САМЫЙ ДАЛЬНИЙ АВТОГОЛ', sub: '18 метров в свои' },
    expect: { goal: { by: 1, bonus: ['own'] }, posts: 1 },
  },
];
