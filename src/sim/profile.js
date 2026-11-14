// Единый профиль настройки. Все числа — стартовые гипотезы из TASK.md, а не константы PES 6.
export const PROFILE_VERSION = 'sandbox-0.1.0';

export function createProfile() {
  return {
    version: PROFILE_VERSION,
    simHz: 120,
    field: {
      length: 18, width: 10,
      goalWidth: 3, goalHeight: 2.2, goalDepth: 1.1, postRadius: 0.06,
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
      postRestitution: 0.6, netRestitution: 0.12,
      spinDecayAir: 0.4, spinDecayGround: 3.0,
    },
    player: {
      height: 1.85, radius: 0.2,
      runSpeed: 3.5, sprintSpeed: 4.6, controlSpeed: 1.9,
      accel: 15, brake: 13, reverseBrake: 24, ballAccelFactor: 0.85,
      turnRate: 16, turnSpring: 20, // предел угловой скорости, рад/с, и жёсткость разворота корпуса
      jumpSpeed: 3.7, airControl: 3,
      footSpread: 0.115, footRadius: 0.09, legReach: 0.78,
    },
    dribble: {
      pushRun: 0.8, pushSprint: 1.7, pushControl: 0.55, // прибавка скорости мяча к скорости режима
      needMargin: 0.35, lateralTolerance: 0.6,
      possessionRange: 1.5, possessionRelSpeed: 4.5,
      flickUp: 4.6,
    },
    kick: {
      chargeTime: 0.45, autoRelease: 0.35, approachTimeout: 0.8, approachSpeed: 3.2,
      minSpeed: 10, maxSpeed: 22,
      pitchLow: 3, pitchMid: 12, pitchHigh: 30, // градусы
      aimWidth: 0.85, // доля полуширины ворот при полном отклонении: цель остаётся внутри створа
      curlWindow: 0.1, maxSpin: 45,
      // удар по летящему мячу в касание
      strikeHorizon: 0.8, strikeSpeed: 4.4, // глубина прогноза, с; скорость подстройки под мяч, м/с
      standReach: 0.8, jumpReach: 1.1, strikeSwing: 0.09, strikeWindup: 0.21, // время проноса стопы к мячу и замаха, с
      legMin: 0.5, legMax: 0.84, legIdeal: 0.74, // допустимое расстояние таз — голеностоп для бьющей ноги, м
      strikeJumpMax: 4.3, // досягаемость стопы стоя, запас прыжка, предел толчка
      volleyBonus: 0.3, volleyMinCharge: 0.3, volleyOverMax: 4, // вклад встречной скорости мяча, минимальный заряд, запас сверх maxSpeed
      errVolley: 0.8, errIncoming: 0.06,
      aimRateDigital: 4.5, aimRateAnalog: 14,
      errBase: 0.5, errSpeed: 0.5, errTurn: 2.5, errCharge: 1.0, errOffset: 6,
    },
    receive: { window: 0.18, idealFrom: 0.03, idealTo: 0.12, passiveRestitution: 0.45 },
    input: { buffer: 0.1, deadzone: 0.15 },
    match: { goalPause: 1.3, goalsToWin: 7, idleRestart: 6 }, // idleRestart: дуэль — мяч, замерший без владения, вводится заново, с
  };
}
