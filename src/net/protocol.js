// Общие для клиента и сервера константы сетевой игры.
// Схема: сервер авторитетен и считает симуляцию; клиент шлёт ввод по шагам, предсказывает своего игрока
// и доигрывает неподтверждённый ввод поверх каждого полученного состояния.
export const NET_VERSION = 5;
export const SNAP_EVERY = 4; // состояние рассылается раз в 4 шага симуляции (30 раз/с при 120 Гц)
export const MAX_BUF = 6; // очередь ввода на сервере длиннее этого сжимается: задержка не накапливается
export const STARVE_TICKS = 30; // столько шагов без ввода — и сервер считает ввод отпущенным
export const INPUT_MASK = 0x3ff | 8192; // биты действий игрока (8192 — защитная стойка); команды песочницы по сети не передаются
export const EDGE_BITS = 4 | 8 | 16 | 256 | 512; // события нажатия: при повторе ввода не дублируются

export const REMOTE_DELAY = 8; // соперник показывается с отставанием на столько шагов (67 мс) от последнего состояния сервера
export const COUNTDOWN_MS = 3000;
export const RESUME_MS = 2000;
export const REJOIN_MS = 30000;

// События симуляции, которые сервер пересылает клиентам (звук, HUD, эффекты)
export const WIRE_EVENTS = new Set(['touch', 'kick', 'receive', 'header', 'body', 'wall', 'post', 'bounce', 'goal',
  'net', 'kick_cancel', 'kick_miss', 'kick_empty', 'control_lost', 'kickoff', 'match_over', 'juggle_start']);
// События мяча клиент берёт из собственного предсказания (без сетевой задержки), а не с сервера
export const BALL_EVENTS = new Set(['wall', 'post', 'bounce', 'net']);

export function sanitizeFrame(f) {
  if (!Array.isArray(f) || f.length !== 3) return null;
  const mx = Math.round(Number(f[0])), mz = Math.round(Number(f[1])), fl = Number(f[2]) | 0;
  if (!Number.isFinite(mx) || !Number.isFinite(mz)) return null;
  return [Math.max(-1000, Math.min(1000, mx)), Math.max(-1000, Math.min(1000, mz)), fl & INPUT_MASK];
}
