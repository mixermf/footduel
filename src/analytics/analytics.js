// Google Analytics (Firebase) — отправка событий. Firebase грузится отдельным куском после запуска игры и не мешает загрузке;
// пока он не готов, события копятся в очереди. Любой сбой (блокировщик рекламы, нет сети) глушится: на игру не влияет.
// Включено в обычной сборке. В разработке и сборке с лабораторией выключено, чтобы прогоны и пробы не портили данные:
// ?analytics=1 включает (события помечаются debug_mode и видны в DebugView), ?analytics=0 выключает где угодно.

const firebaseConfig = {
  apiKey: 'AIzaSyCpFJJbQVahjYZzMmEfzrkQe1HWJda5lrU',
  authDomain: 'forbiddenisland-8f0ba.firebaseapp.com',
  projectId: 'forbiddenisland-8f0ba',
  storageBucket: 'forbiddenisland-8f0ba.firebasestorage.app',
  messagingSenderId: '158417589849',
  appId: '1:158417589849:web:508cbb6484c97b71274348',
  measurementId: 'G-C2RTZHZC6W',
};

const LAB = import.meta.env.DEV || import.meta.env.MODE === 'lab';
const flag = new URLSearchParams(location.search).get('analytics');
const ENABLED = flag === '1' || (flag !== '0' && !LAB);

let queue = [], log = null;

export function initAnalytics() {
  if (!ENABLED) return;
  Promise.all([import('firebase/app'), import('firebase/analytics')])
    .then(async ([fb, an]) => {
      if (!(await an.isSupported())) { queue = null; return; }
      const a = an.getAnalytics(fb.initializeApp(firebaseConfig));
      log = (name, params) => an.logEvent(a, name, params);
      for (const [name, params] of queue) log(name, params);
      queue = null;
    })
    .catch((err) => { queue = null; if (LAB) console.warn('[analytics] не запустилась', err); });
}

export function track(name, params = {}) {
  if (LAB) console.info('[analytics]', name, params);
  if (!ENABLED) return;
  const p = LAB ? { ...params, debug_mode: true } : params;
  try {
    if (log) log(name, p);
    else if (queue && queue.length < 64) queue.push([name, p]);
  } catch { /* аналитика не мешает игре */ }
}
