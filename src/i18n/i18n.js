// Локализация интерфейса: русский и английский. Ключи плоские («раздел.имя»), подстановки — {имя}.
// Только клиент: симуляция, бот и сервер не импортируют этот модуль (их тексты — служебные, для лаборатории и скриптов).
// Язык: настройка 'auto' | 'ru' | 'en'; 'auto' — по языку браузера (русский для ru/uk/be/kk, иначе английский).
// Смена языка — без перезагрузки: подписчики onLang() перерисовывают то, что собрали заранее.

const RU = {
  // общее
  'common.on': 'вкл', 'common.off': 'выкл', 'common.you': 'Вы', 'common.bot': 'Бот', 'common.player': 'Игрок', 'common.guest': 'Гость',
  'common.loading': 'Загрузка модели…', 'common.loadFail': 'Не удалось загрузить модель: {msg}',
  'lang.name': 'Язык / Language', 'lang.auto': 'Авто ({lang})', 'lang.ru': 'Русский', 'lang.en': 'English',
  // главное меню и настройки
  'menu.note': 'Enter / A — выбрать, ↑↓ — пункт. Версия {v}.',
  'menu.sandbox': 'Песочница', 'menu.bot': 'Матч с ботом', 'menu.create': 'Игра по сети: создать комнату', 'menu.join': 'Игра по сети: войти по коду',
  'menu.shorts': 'Шортс-сцены (dev)', 'menu.quit': 'Выход из игры', 'menu.sfx': 'Громкость эффектов', 'menu.music': 'Громкость музыки',
  'menu.noMusic': ' (музыки пока нет)', 'menu.vibration': 'Вибрация геймпада', 'menu.shake': 'Тряска камеры', 'menu.resetKeys': 'Сбросить раскладку по умолчанию',
  'menu.keysReset': 'Раскладка сброшена', 'menu.quitTitle': 'Игра завершена', 'menu.quitNote': 'Вкладку можно закрыть.', 'menu.backToMain': 'Вернуться в главное меню',
  'menu.toMain': 'Выйти в главное меню', 'menu.resume': 'Продолжить', 'menu.restart': 'Начать заново', 'menu.rematch': 'Реванш', 'menu.difficulty': 'Сложность',
  'menu.onlineTitle': 'Меню матча', 'menu.onlineNote': 'Матч продолжается. Esc — вернуться в игру.', 'menu.leaveMatch': 'матч будет покинут',
  'menu.pause': 'Пауза', 'menu.botPauseNote': 'Матч с ботом · очки {a} : {b}. Esc — продолжить.',
  'menu.sandboxNote': 'Enter / A — выбрать, ↑↓ — пункт, ←→ — значение, Esc — продолжить.',
  'menu.returnBall': 'Вернуть мяч', 'menu.serve': 'Тренировочная подача', 'menu.wall': 'Щит вместо правых ворот', 'menu.resetSandbox': 'Сбросить песочницу',
  'menu.blur': 'Окно потеряло фокус. Enter / A — продолжить.', 'menu.hidden': 'Окно было скрыто. Enter / A — продолжить.',
  'menu.padLost': 'Геймпад отключён. Enter — продолжить на клавиатуре.',
  'bot.easy': 'Лёгкий', 'bot.medium': 'Средний', 'bot.hard': 'Сложный', 'bot.legend': 'Легенда',
  'bot.start': 'Матч с ботом · {lvl} · {min} {minWord}, побеждают очки', 'bot.title': 'Матч с ботом · {lvl}',
  'bot.overNote': 'Очки {a} : {b} · голы {ga} : {gb} · бот: {lvl}',
  'result.draw': 'Ничья', 'result.win': 'Победа!', 'result.loss': 'Поражение',
  'min.one': 'минута', 'min.few': 'минуты', 'min.many': 'минут',
  'goal.one': 'гола', 'goal.many': 'голов',
  // управление (таблица в меню)
  'ctl.run': 'Бег; с мячом в окне удара — направление мяча', 'ctl.arrows': 'стрелки', 'ctl.leftStick': 'левый стик, крестовина',
  'ctl.kick': 'Удар: заряд, удар при отпускании (с мячом и без)', 'ctl.sprint': 'Ускорение',
  'ctl.lob': 'С мячом: навес-подсечка через соперника — заряд задаёт дальность; с места точнее, с хода разброс', 'ctl.super': 'С мячом: суперудар при полной шкале',
  'ctl.juggle': 'С мячом: чеканка; в чеканке — подбить выше', 'ctl.inJuggle': 'В чеканке: удар с лёта; прокинуть себе вверх-вперёд; суперудар',
  'ctl.afterToss': 'После прокидывания: удар в прыжке или сбоку в полёте', 'ctl.high': 'Удары по высокому мячу (сбоку в полёте, через себя, в прыжке)',
  'ctl.tackle': 'Без мяча: подкат (по направлению или к мячу)', 'ctl.jump': 'Без мяча: прыжок (мяч на голову — удар головой в ворота); с подкатом — подкат в прыжке',
  'ctl.guard': 'Без мяча: защитная стойка и приём — телом и ближайшей ногой', 'ctl.lunge': 'Рывок в стойке',
  'ctl.receive': 'Точный приём; удержание — близкий контроль', 'ctl.face': 'Разворот к воротам и контроль',
  'ctl.sandbox': 'Вернуть мяч; подача; щит вместо ворот (песочница)', 'ctl.hold': 'держать', 'ctl.holdDown': 'удерживать',
  'ctl.dir': 'направление', 'ctl.stick': 'стик', 'ctl.foot': 'нога', 'ctl.pauseMenu': 'меню паузы',
  'key.space': 'Пробел',
  // HUD
  'hud.charge': 'Сила удара', 'hud.super': 'Суперудар', 'hud.ready': 'готов', 'hud.scored': 'Забито', 'hud.conceded': 'Пропущено',
  'hud.sandbox': 'Песочница', 'hud.net': 'Сеть', 'hud.ping': 'пинг {ms} мс', 'hud.pingHigh': ' (высокий)', 'hud.replay': 'ПОВТОР',
  'mode.rise': 'Встаёт', 'mode.land': 'Приземление', 'mode.down': 'Упал', 'mode.slide': 'Подкат', 'mode.reach': 'Тянется за мячом',
  'mode.juggle': 'Чеканка', 'mode.lunge': 'Рывок', 'mode.guard': 'Защитная стойка', 'mode.sprint': 'Спринт', 'mode.control': 'Близкий контроль', 'mode.run': 'Бег',
  'phase.control': 'мяч под контролем', 'phase.free': 'без мяча', 'phase.plan': 'выход на мяч — удар в касание',
  'phase.charge': 'заряд — направления управляют прицелом', 'phase.ready': 'подход к мячу', 'phase.curl': 'ПОДКРУТКА', 'phase.strike': 'удар',
  'hint.withBall': 'С мячом:', 'hint.noBall': 'Без мяча:', 'hint.arrows': 'стрелки', 'hint.stick': 'левый стик',
  'hint.runDir': 'бег и направление', 'hint.run': 'бег', 'hint.kick': 'удар', 'hint.lob': 'навес', 'hint.super': 'суперудар', 'hint.juggle': 'чеканка',
  'hint.sprint': 'ускорение', 'hint.tackle': 'подкат', 'hint.guard': 'стойка и приём', 'hint.jump': 'прыжок', 'hint.pause': 'пауза',
  'hint.ball': 'мяч', 'hint.serve': 'подача', 'hint.wall': 'щит',
  // заметки и стикеры
  'note.ballBack': 'Мяч возвращён', 'note.wallOn': 'Щит вместо ворот: мяч возвращается', 'note.wallOff': 'Ворота открыты',
  'note.toss': 'Прокинул себе: удар + прыжок', 'note.juggleStart': 'Чеканка: удар — с лёта, пробел — подбить выше',
  'note.superEmpty': 'Суперудар не готов: {p}%', 'note.yourBall': 'Твой мяч', 'note.theirBall': 'Мяч у соперника',
  'note.kickCancel': 'Удар сорвался: мяч не достать', 'note.kickMiss': 'Мимо мяча', 'note.kickEmpty': 'Мяч далеко', 'note.controlLost': 'Потеря контроля',
  'note.replay': 'Повтор записи', 'note.replayDone': 'Повтор завершён', 'note.sandboxLab': 'Песочница · F1 — лаборатория',
  'stk.juggle': 'ЧЕКАНКА ×{n}', 'stk.airTackle': 'ПОДКАТ В ПРЫЖКЕ!', 'stk.tackle': 'ПОДКАТ!', 'stk.super': 'СУПЕРУДАР!', 'stk.bike': 'ЧЕРЕЗ СЕБЯ!',
  'stk.fly': 'В ПОЛЁТЕ!', 'stk.jump': 'В ПРЫЖКЕ!', 'stk.volley': 'С ЛЁТА!', 'stk.firstTime': 'В КАСАНИЕ!', 'stk.lob': 'НАВЕС',
  'stk.foeSuper': 'СУПЕРУДАР', 'stk.foeBike': 'ЧЕРЕЗ СЕБЯ', 'stk.foeFly': 'В ПОЛЁТЕ',
  'stk.head': 'ГОЛОВОЙ', 'stk.chest': 'НА ГРУДЬ', 'stk.thigh': 'НА БЕДРО', 'stk.reach': 'ДОТЯНУЛСЯ!', 'stk.clean': 'ТОЧНЫЙ ПРИЁМ', 'stk.header': 'ГОЛОВОЙ!',
  'stk.post': 'ШТАНГА!', 'stk.bar': 'ПЕРЕКЛАДИНА!',
  'stk.goal': 'ГОЛ!', 'stk.conceded': 'ПРОПУЩЕН', 'stk.golden': 'ЗОЛОТОЙ ГОЛ!', 'stk.goldenSub': 'первые очки — победа',
  // очки дуэли
  'pts.goal': 'ГОЛ!', 'pts.corner': 'В ДЕВЯТКУ!', 'pts.foeCorner': 'ДЕВЯТКА СОПЕРНИКА', 'pts.foeGoal': 'ГОЛ СОПЕРНИКА', 'pts.more': '+ ещё {n}', 'pts.legend': 'ЛЕГЕНДАРНО',
  'pts.penalty': '▼ ШТРАФ −{n}/с', 'pts.holdMe': '⚠ ДЕРЖИШЬ МЯЧ {s} с', 'pts.holdThem': '⚠ ДЕРЖИТ МЯЧ {s} с', 'pts.golden': 'ЗОЛОТОЙ ГОЛ',
  'pts.draw': 'НИЧЬЯ', 'pts.win': 'ПОБЕДА', 'pts.loss': 'ПОРАЖЕНИЕ',
  'bonus.goal': 'Гол', 'bonus.corner': 'В девятку', 'bonus.own': 'Автогол', 'bonus.post': 'От штанги', 'bonus.bar': 'От перекладины', 'bonus.volley': 'С лёта', 'bonus.jump': 'В прыжке',
  'bonus.fly': 'Сбоку в полёте', 'bonus.bike': 'Через себя', 'bonus.juggle': 'С чеканки', 'bonus.firstTime': 'В касание', 'bonus.lob': 'Парашют',
  'bonus.long': 'Издалека', 'bonus.power': 'Пушка', 'bonus.wall': 'От борта', 'bonus.super': 'Суперудар', 'bonus.defl': 'Рикошет',
  // песочница: подачи
  'scn.free': 'Мяч в ногах', 'scn.motor': 'Мотор без мяча', 'scn.low': 'Низкая подача', 'scn.thigh': 'Подача на бедро', 'scn.chest': 'Подача на грудь',
  'scn.high': 'Высокая подача', 'scn.wall': 'Рикошет от борта',
  // LED-борта (пиксельный шрифт: только заглавные)
  'led.goal': ['ГОЛ!', 'GOAL!'], 'led.corner': ['В ДЕВЯТКУ!'], 'led.post': 'ШТАНГА!', 'led.bar': 'ПЕРЕКЛАДИНА!', 'led.foeGoal': 'ГОЛ', 'led.golden': 'ЗОЛОТОЙ ГОЛ', 'led.draw': 'НИЧЬЯ', 'led.win': 'ПОБЕДА!', 'led.over': 'МАТЧ ОКОНЧЕН',
  'slogan.nyuk': 'KICK FIRST. ASK LATER.', 'slogan.cola': 'ПЕЙ ДО СВИСТКА', 'slogan.zilla': 'СТОМП!', 'slogan.keepr': 'НИЧЕГО НЕ ПРОЙДЁТ',
  'slogan.burger': 'ЕШЬ КАК ЧЕМПИОН', 'slogan.socks': 'БЫСТРЕЕ ВЕТРА', 'slogan.cup': 'ARENA DUEL · 1 НА 1',
  // сетевая игра
  'net.err.no_room': 'Комната не найдена. Проверьте код — или матч уже завершён.', 'net.err.room_full': 'В комнате уже двое игроков.',
  'net.err.version': 'Версия игры устарела. Обновите страницу (Ctrl+F5).', 'net.err.server_full': 'Сервер переполнен. Попробуйте позже.',
  'net.err.other': 'Ошибка: {code}',
  'net.closed.opponent_left': 'Соперник вышел из матча.', 'net.closed.opponent_timeout': 'Соперник не вернулся в игру.',
  'net.closed.server_restart': 'Сервер перезапускается. Создайте комнату заново через минуту.', 'net.closed.other': 'Комната закрыта.',
  'net.joinFail': 'Не удалось войти', 'net.aborted': 'Матч прерван', 'net.down': 'Сервер недоступен', 'net.noConn': 'Нет соединения с {url}',
  'net.lost': 'Связь потеряна', 'net.reconnecting': 'Переподключение… Матч на паузе, место за вами сохраняется.', 'net.connecting': 'Подключение…',
  'net.sideLeft': 'Вы слева, в синем: атакуете правые ворота.', 'net.sideRight': 'Вы справа, в красном: атакуете левые ворота.',
  'net.waiting': 'Ждём соперника. Отправьте ему код или ссылку.', 'net.loading': 'Соперник в комнате. Загрузка…',
  'net.oppGone': 'Соперник отключился', 'net.pausedWait': 'Матч на паузе. Ждём возвращения: {s} с.',
  'net.oppLeft': 'Соперник вышел.', 'net.waitRematch': 'Ждём согласия соперника…', 'net.oppRematch': 'Соперник хочет реванш.', 'net.goals': ' · голы {a} : {b}',
  'net.createTitle': 'Создать комнату', 'net.joinTitle': 'Войти в комнату', 'net.createNote': 'Вы получите код комнаты и ссылку для соперника.',
  'net.joinNote': 'Введите код, который прислал соперник.', 'net.namePh': 'Ваше имя', 'net.codePh': 'КОД', 'net.name': 'Имя', 'net.code': 'Код комнаты',
  'net.create': 'Создать', 'net.join': 'Войти', 'net.back': 'Назад', 'net.room': 'Комната', 'net.youTag': ' (вы)', 'net.free': 'свободно',
  'net.ready': 'готов', 'net.loadingShort': 'загрузка', 'net.copied': 'Ссылка скопирована', 'net.copy': 'Скопировать ссылку', 'net.leave': 'Выйти',
  'net.rulePoints': 'Матч {min} {minWord}: побеждает тот, кто наберёт больше очков.', 'net.ruleGoals': 'Матч до {n} {goalWord}.',
  'net.rematch': 'Реванш', 'net.retry': 'Повторить', 'net.toMenu': 'Выйти в меню',
};

const EN = {
  'common.on': 'on', 'common.off': 'off', 'common.you': 'You', 'common.bot': 'Bot', 'common.player': 'Player', 'common.guest': 'Guest',
  'common.loading': 'Loading model…', 'common.loadFail': 'Failed to load the model: {msg}',
  'lang.name': 'Язык / Language', 'lang.auto': 'Auto ({lang})', 'lang.ru': 'Русский', 'lang.en': 'English',
  'menu.note': 'Enter / A — select, ↑↓ — move. Version {v}.',
  'menu.sandbox': 'Sandbox', 'menu.bot': 'Match vs bot', 'menu.create': 'Online: create a room', 'menu.join': 'Online: join with a code',
  'menu.shorts': 'Shorts scenes (dev)', 'menu.quit': 'Quit game', 'menu.sfx': 'Sound effects volume', 'menu.music': 'Music volume',
  'menu.noMusic': ' (no music yet)', 'menu.vibration': 'Gamepad vibration', 'menu.shake': 'Camera shake', 'menu.resetKeys': 'Reset controls to default',
  'menu.keysReset': 'Controls reset', 'menu.quitTitle': 'Game closed', 'menu.quitNote': 'You can close this tab.', 'menu.backToMain': 'Back to main menu',
  'menu.toMain': 'Exit to main menu', 'menu.resume': 'Resume', 'menu.restart': 'Restart', 'menu.rematch': 'Rematch', 'menu.difficulty': 'Difficulty',
  'menu.onlineTitle': 'Match menu', 'menu.onlineNote': 'The match keeps going. Esc — back to the game.', 'menu.leaveMatch': 'you will leave the match',
  'menu.pause': 'Paused', 'menu.botPauseNote': 'Match vs bot · points {a} : {b}. Esc — resume.',
  'menu.sandboxNote': 'Enter / A — select, ↑↓ — move, ←→ — change, Esc — resume.',
  'menu.returnBall': 'Return the ball', 'menu.serve': 'Training serve', 'menu.wall': 'Wall instead of the right goal', 'menu.resetSandbox': 'Reset sandbox',
  'menu.blur': 'The window lost focus. Enter / A — resume.', 'menu.hidden': 'The window was hidden. Enter / A — resume.',
  'menu.padLost': 'Gamepad disconnected. Enter — continue on the keyboard.',
  'bot.easy': 'Easy', 'bot.medium': 'Medium', 'bot.hard': 'Hard', 'bot.legend': 'Legend',
  'bot.start': 'Match vs bot · {lvl} · {min} {minWord}, most points wins', 'bot.title': 'Match vs bot · {lvl}',
  'bot.overNote': 'Points {a} : {b} · goals {ga} : {gb} · bot: {lvl}',
  'result.draw': 'Draw', 'result.win': 'Victory!', 'result.loss': 'Defeat',
  'min.one': 'minute', 'min.few': 'minutes', 'min.many': 'minutes',
  'goal.one': 'goal', 'goal.many': 'goals',
  'ctl.run': 'Run / aim the shot', 'ctl.arrows': 'arrows', 'ctl.leftStick': 'left stick, D-pad',
  'ctl.kick': 'Kick: charge, strike on release (with or without the ball)', 'ctl.sprint': 'Sprint',
  'ctl.lob': 'With the ball: chip over the opponent — charge sets the distance; accurate when standing, scattered on the run', 'ctl.super': 'With the ball: super shot when the bar is full',
  'ctl.juggle': 'With the ball: juggle; while juggling — pop it higher', 'ctl.inJuggle': 'While juggling: volley; flick it up and forward; super shot',
  'ctl.afterToss': 'After a flick: leaping shot or flying volley', 'ctl.high': 'High-ball shots (flying volley, bicycle kick, leaping shot)',
  'ctl.tackle': 'Without the ball: slide tackle (in your direction or at the ball)', 'ctl.jump': 'Without the ball: jump (ball at head height — header at goal); with a tackle — flying tackle',
  'ctl.guard': 'Without the ball: guard stance and receive — body and nearest foot', 'ctl.lunge': 'Lunge from the stance',
  'ctl.receive': 'Clean first touch; hold — close control', 'ctl.face': 'Turn to goal and control',
  'ctl.sandbox': 'Return ball; serve; wall instead of goal (sandbox)', 'ctl.hold': 'hold', 'ctl.holdDown': 'hold',
  'ctl.dir': 'direction', 'ctl.stick': 'stick', 'ctl.foot': 'foot', 'ctl.pauseMenu': 'pause menu',
  'key.space': 'Space',
  'hud.charge': 'Shot power', 'hud.super': 'Super shot', 'hud.ready': 'ready', 'hud.scored': 'Scored', 'hud.conceded': 'Conceded',
  'hud.sandbox': 'Sandbox', 'hud.net': 'Online', 'hud.ping': 'ping {ms} ms', 'hud.pingHigh': ' (high)', 'hud.replay': 'REPLAY',
  'mode.rise': 'Getting up', 'mode.land': 'Landing', 'mode.down': 'Down', 'mode.slide': 'Slide tackle', 'mode.reach': 'Stretching for the ball',
  'mode.juggle': 'Juggling', 'mode.lunge': 'Lunge', 'mode.guard': 'Guard stance', 'mode.sprint': 'Sprint', 'mode.control': 'Close control', 'mode.run': 'Run',
  'phase.control': 'ball under control', 'phase.free': 'no ball', 'phase.plan': 'meeting the ball — first-time shot',
  'phase.charge': 'charging — directions aim', 'phase.ready': 'approaching the ball', 'phase.curl': 'CURL', 'phase.strike': 'strike',
  'hint.withBall': 'With ball:', 'hint.noBall': 'No ball:', 'hint.arrows': 'arrows', 'hint.stick': 'left stick',
  'hint.runDir': 'run and aim', 'hint.run': 'run', 'hint.kick': 'kick', 'hint.lob': 'lob', 'hint.super': 'super', 'hint.juggle': 'juggle',
  'hint.sprint': 'sprint', 'hint.tackle': 'tackle', 'hint.guard': 'guard & receive', 'hint.jump': 'jump', 'hint.pause': 'pause',
  'hint.ball': 'ball', 'hint.serve': 'serve', 'hint.wall': 'wall',
  'note.ballBack': 'Ball returned', 'note.wallOn': 'Wall instead of goal: the ball comes back', 'note.wallOff': 'Goal open',
  'note.toss': 'Flicked it up: kick + jump', 'note.juggleStart': 'Juggling: kick — volley, space — pop it higher',
  'note.superEmpty': 'Super shot not ready: {p}%', 'note.yourBall': 'Your ball', 'note.theirBall': 'Their ball',
  'note.kickCancel': 'Shot cancelled: ball out of reach', 'note.kickMiss': 'Missed the ball', 'note.kickEmpty': 'Ball too far', 'note.controlLost': 'Lost control',
  'note.replay': 'Replaying the recording', 'note.replayDone': 'Replay finished', 'note.sandboxLab': 'Sandbox · F1 — lab',
  'stk.juggle': 'JUGGLES ×{n}', 'stk.airTackle': 'FLYING TACKLE!', 'stk.tackle': 'TACKLE!', 'stk.super': 'SUPER SHOT!', 'stk.bike': 'BICYCLE KICK!',
  'stk.fly': 'FLYING VOLLEY!', 'stk.jump': 'LEAPING SHOT!', 'stk.volley': 'VOLLEY!', 'stk.firstTime': 'ONE-TOUCH!', 'stk.lob': 'LOB',
  'stk.foeSuper': 'SUPER SHOT', 'stk.foeBike': 'BICYCLE KICK', 'stk.foeFly': 'FLYING VOLLEY',
  'stk.head': 'HEADER', 'stk.chest': 'CHEST TRAP', 'stk.thigh': 'THIGH TRAP', 'stk.reach': 'GREAT REACH!', 'stk.clean': 'CLEAN TOUCH', 'stk.header': 'HEADER!',
  'stk.post': 'OFF THE POST!', 'stk.bar': 'CROSSBAR!',
  'stk.goal': 'GOAL!', 'stk.conceded': 'CONCEDED', 'stk.golden': 'GOLDEN GOAL!', 'stk.goldenSub': 'next score wins',
  'pts.goal': 'GOAL!', 'pts.corner': 'TOP CORNER!', 'pts.foeCorner': 'OPPONENT: TOP CORNER', 'pts.foeGoal': 'OPPONENT SCORES', 'pts.more': '+ {n} more', 'pts.legend': 'LEGENDARY',
  'pts.penalty': '▼ BALL HOG −{n}/s', 'pts.holdMe': '⚠ HOLDING {s}s', 'pts.holdThem': '⚠ HOLDING {s}s', 'pts.golden': 'GOLDEN GOAL',
  'pts.draw': 'DRAW', 'pts.win': 'VICTORY', 'pts.loss': 'DEFEAT',
  'bonus.goal': 'Goal', 'bonus.corner': 'Top corner', 'bonus.own': 'Own goal', 'bonus.post': 'Off the post', 'bonus.bar': 'Off the bar', 'bonus.volley': 'Volley', 'bonus.jump': 'Leaping shot',
  'bonus.fly': 'Flying volley', 'bonus.bike': 'Bicycle kick', 'bonus.juggle': 'Off juggles', 'bonus.firstTime': 'One-touch', 'bonus.lob': 'Lob',
  'bonus.long': 'Long range', 'bonus.power': 'Rocket', 'bonus.wall': 'Off the wall', 'bonus.super': 'Super shot', 'bonus.defl': 'Deflection',
  'scn.free': 'Ball at feet', 'scn.motor': 'Movement, no ball', 'scn.low': 'Low serve', 'scn.thigh': 'Serve to the thigh', 'scn.chest': 'Serve to the chest',
  'scn.high': 'High serve', 'scn.wall': 'Rebound off the wall',
  'led.goal': ['GOAL!'], 'led.corner': ['TOP CORNER!'], 'led.post': 'POST!', 'led.bar': 'CROSSBAR!', 'led.foeGoal': 'GOAL', 'led.golden': 'GOLDEN GOAL', 'led.draw': 'DRAW', 'led.win': 'VICTORY!', 'led.over': 'FULL TIME',
  'slogan.nyuk': 'KICK FIRST. ASK LATER.', 'slogan.cola': 'DRINK TILL THE WHISTLE', 'slogan.zilla': 'STOMP!', 'slogan.keepr': 'NOTHING GETS PAST',
  'slogan.burger': 'EAT LIKE A CHAMPION', 'slogan.socks': 'FASTER THAN WIND', 'slogan.cup': 'ARENA DUEL · 1 VS 1',
  'net.err.no_room': 'Room not found. Check the code — or the match is already over.', 'net.err.room_full': 'The room already has two players.',
  'net.err.version': 'Your game version is out of date. Reload the page (Ctrl+F5).', 'net.err.server_full': 'The server is full. Try again later.',
  'net.err.other': 'Error: {code}',
  'net.closed.opponent_left': 'Your opponent left the match.', 'net.closed.opponent_timeout': 'Your opponent did not come back.',
  'net.closed.server_restart': 'The server is restarting. Create a new room in a minute.', 'net.closed.other': 'The room is closed.',
  'net.joinFail': 'Could not join', 'net.aborted': 'Match interrupted', 'net.down': 'Server unavailable', 'net.noConn': 'No connection to {url}',
  'net.lost': 'Connection lost', 'net.reconnecting': 'Reconnecting… The match is paused, your place is kept.', 'net.connecting': 'Connecting…',
  'net.sideLeft': 'You are on the left, in blue: attack the right goal.', 'net.sideRight': 'You are on the right, in red: attack the left goal.',
  'net.waiting': 'Waiting for an opponent. Send them the code or the link.', 'net.loading': 'Opponent is in the room. Loading…',
  'net.oppGone': 'Opponent disconnected', 'net.pausedWait': 'Match paused. Waiting for them to return: {s} s.',
  'net.oppLeft': 'Your opponent left.', 'net.waitRematch': 'Waiting for your opponent to accept…', 'net.oppRematch': 'Your opponent wants a rematch.', 'net.goals': ' · goals {a} : {b}',
  'net.createTitle': 'Create a room', 'net.joinTitle': 'Join a room', 'net.createNote': 'You will get a room code and a link for your opponent.',
  'net.joinNote': 'Enter the code your opponent sent you.', 'net.namePh': 'Your name', 'net.codePh': 'CODE', 'net.name': 'Name', 'net.code': 'Room code',
  'net.create': 'Create', 'net.join': 'Join', 'net.back': 'Back', 'net.room': 'Room', 'net.youTag': ' (you)', 'net.free': 'open',
  'net.ready': 'ready', 'net.loadingShort': 'loading', 'net.copied': 'Link copied', 'net.copy': 'Copy link', 'net.leave': 'Leave',
  'net.rulePoints': '{min}-minute match: the most points wins.', 'net.ruleGoals': 'First to {n} {goalWord}.',
  'net.rematch': 'Rematch', 'net.retry': 'Retry', 'net.toMenu': 'Back to menu',
};

export const DICTS = { ru: RU, en: EN };
export const LANGS = ['auto', 'ru', 'en'];

function detect() {
  try {
    const list = (typeof navigator !== 'undefined' && (navigator.languages?.length ? navigator.languages : [navigator.language])) || [];
    for (const l of list) { const c = String(l || '').toLowerCase().slice(0, 2); if (['ru', 'uk', 'be', 'kk'].includes(c)) return 'ru'; if (c) return 'en'; }
  } catch { /* нет navigator — Node */ }
  return 'en';
}

let pref = 'auto', lang = detect();
const subs = new Set();

export const getLang = () => lang;
export const getLangPref = () => pref;
export const autoLang = () => detect();

// pref: 'auto' | 'ru' | 'en'. Подписчики вызываются, только если язык на самом деле сменился
export function setLang(p) {
  pref = LANGS.includes(p) ? p : 'auto';
  const next = pref === 'auto' ? detect() : pref;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  if (next === lang) return;
  lang = next;
  for (const f of subs) f(lang);
}

export function onLang(fn) { subs.add(fn); return () => subs.delete(fn); }

// перевод по ключу; vars — подстановки {имя}. Нет ключа в языке — берётся русский, нет и там — сам ключ
const warned = new Set();
export function t(key, vars) {
  let s = DICTS[lang][key];
  if (s === undefined) {
    // нет перевода: в разработке — предупреждение (раз на ключ), игроку — русский текст или сам ключ
    if (import.meta.env?.DEV && !warned.has(lang + key)) { warned.add(lang + key); console.warn(`[i18n] нет ключа «${key}» для ${lang}`); }
    s = RU[key] ?? key;
  }
  if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return s;
}

// склонение после числа: русский — один/несколько/много (1 минута, 3 минуты, 5 минут); английский — 1 / иначе
export function plural(n, base) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (lang !== 'ru') return t(base + (n === 1 ? '.one' : '.many'));
  if (a > 10 && a < 20) return t(base + '.many');
  if (b === 1) return t(base + '.one');
  if (b >= 2 && b <= 4) return t(base + (RU[base + '.few'] ? '.few' : '.many'));
  return t(base + '.many');
}
