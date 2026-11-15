// Единый профиль настройки. Все числа — стартовые гипотезы из TASK.md, а не константы PES 6.
export const PROFILE_VERSION = 'sandbox-0.1.0';

export function createProfile() {
  return {
    version: PROFILE_VERSION,
    simHz: 120,
    field: {
      length: 18, width: 10,
      goalWidth: 3, goalHeight: 2.2, postRadius: 0.06,
      goalBack: 0.9, // ворота уходят за торцевой борт на эту глубину: в борту проём, сетка продолжается за коробкой
      goalInset: 0.8, // рама ворот стоит в поле на этом расстоянии от торцевого борта; сетка тянется от рамы до борта
      reboundWall: false, // песочница: щит вместо правых ворот — мяч всегда возвращается в игру
      boardHeight: 1.0, // сплошной борт
      fenceHeight: 5.0, // сетка-ограждение и сетчатый потолок: физическая высота возврата высоких мячей
    },
    ball: {
      radius: 0.11, gravity: 9.81,
      airDrag: 0.013, magnus: 0.0065,
      rollDecel: 2.2, rollDrag: 0.25,
      groundRestitution: 0.6, groundTangent: 0.93, restSpeed: 0.8,
      wallRestitution: 0.68, wallTangent: 0.92,
      postRestitution: 0.62, netRestitution: 0.12, netOuterRestitution: 0.22,
      spinDecayAir: 0.4, spinDecayGround: 3.0,
    },
    player: {
      height: 1.85, radius: 0.2,
      runSpeed: 3.5, sprintSpeed: 4.6, controlSpeed: 1.9,
      accel: 15, brake: 13, reverseBrake: 24, ballAccelFactor: 0.85,
      turnRate: 16, turnSpring: 20, // предел угловой скорости, рад/с, и жёсткость разворота корпуса
      jumpSpeed: 3.7, airControl: 3,
      footSpread: 0.115, footRadius: 0.09, legReach: 0.78,
      touchReach: 0.66, // дальность обычного касания стопой от корпуса: дальше игрок не тянется в шпагат, а делает шаг
    },
    dribble: {
      pushRun: 0.8, pushSprint: 1.7, pushControl: 0.55, // прибавка скорости мяча к скорости режима
      needMargin: 0.35, lateralTolerance: 0.6,
      possessionRange: 1.5, possessionRelSpeed: 4.5,
      flickUp: 4.6,
    },
    kick: {
      chargeTime: 0.45, autoRelease: 0.35, approachTimeout: 0.8, approachSpeed: 3.2,
      // заход на удар с места сбоку: разворот корпуса к бьющей ноге, рад; положение позади мяча и в сторону опорной ноги, м
      approachAngle: 0.42, approachBack: 0.33, approachSide: 0.22,
      // последний шаг: опорная стопа встаёт сбоку от мяча (plantSide) и чуть позади него (plantBack), не дальше plantReach от корпуса, м
      plantBack: 0.06, plantSide: 0.21, plantReach: 0.42,
      // выход из удара: скорость корпуса вперёд по линии удара, м/с; сколько длится проход, с; за сколько бьющая нога опускается, с
      followSpeed: 1.3, followTime: 0.4, followLand: 0.32,
      minSpeed: 10, maxSpeed: 22,
      pitchLow: 3, pitchMid: 12, pitchHigh: 30, // градусы
      aimWidth: 0.85, // доля полуширины ворот при полном отклонении: цель остаётся внутри створа
      curlWindow: 0.1, maxSpin: 45,
      // удар по летящему мячу в касание
      strikeHorizon: 0.8, strikeSpeed: 4.4, // глубина прогноза, с; скорость подстройки под мяч, м/с
      standReach: 0.8, jumpReach: 1.1, strikeSwing: 0.09, strikeWindup: 0.21, // время проноса стопы к мячу и замаха, с
      legMin: 0.5, legMax: 0.84, legIdeal: 0.74, // допустимое расстояние таз — голеностоп для бьющей ноги, м
      strikeJumpMax: 4.3, // досягаемость стопы стоя, запас прыжка, предел толчка
      // удар через себя: игрок спиной к воротам, мяч в воздухе рядом
      bikeMin: 0.95, bikeReach: 1.45, bikeHop: 0.18, bikeBonus: 1.08, errBike: 1.2,
      volleyBonus: 0.3, volleyMinCharge: 0.3, volleyOverMax: 4, // вклад встречной скорости мяча, минимальный заряд, запас сверх maxSpeed
      errVolley: 0.8, errIncoming: 0.06,
      aimRateDigital: 4.5, aimRateAnalog: 14,
      errBase: 0.5, errSpeed: 0.5, errTurn: 2.5, errCharge: 1.0, errOffset: 6,
    },
    // защитная стойка: игрок без мяча стоит лицом к мячу, двигается приставным шагом и принимает мяч телом
    guard: {
      speed: 2.7, accel: 26, brake: 30, // приставной шаг: медленнее бега, но резче старт и остановка
      backSpeed: 2.0, // отход спиной от мяча: ещё медленнее — короткие частые шаги
      spread: 1.7, // стопы шире обычной стойки
      reach: 0.09, lungeReach: 0.16, // прибавка к радиусу тела при приёме: шире стойка, вынесенная нога в выпаде, м
      quality: 0.72, lungeQuality: 0.6, // качество приёма без точного нажатия (1 — идеальный приём по таймингу)
      lungeSpeed: 6.4, lungeTime: 0.17, lungeRecover: 0.2, lungeCooldown: 0.4, // рывок: скорость, длительность, выход, пауза
      lungeAccel: 70,
    },
    receive: {
      window: 0.18, idealFrom: 0.03, idealTo: 0.12, passiveRestitution: 0.45,
      // низовой мяч, попавший в стопы игрока, который к нему повёрнут: до autoStop м/с — остановка, быстрее — подставленная щёчка
      autoStop: 9, cushionBase: 1.0, cushionGain: 0.25, cushionMax: 4.5,
    },
    // чеканка: после подброса повторный прыжок включает серию касаний; мяч подбивается к точке перед игроком
    juggle: {
      height: 0.32, lead: 0.14, reach: 0.26, // высота касания над опорой, м; за сколько секунд нога идёт к мячу; допуск по горизонтали, м
      pop: 2.7, highPop: 5.5, // вертикальная скорость обычного и высокого подбива, м/с
      front: 0.36, side: 0.09, speed: 1.3, maxDist: 1.6,
    },
    input: { buffer: 0.1, deadzone: 0.15 },
    match: { goalPause: 1.3, goalsToWin: 7, idleRestart: 6 }, // idleRestart: дуэль — мяч, замерший без владения, вводится заново, с
  };
}
