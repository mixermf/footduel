// Локализация: словари русского и английского совпадают по ключам и подстановкам; надписи LED-бортов
// на обоих языках набираются пиксельным шрифтом (иначе неизвестная буква тихо превратилась бы в пробел).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DICTS, setLang, t, plural } from '../src/i18n/i18n.js';
import { pixFits, BRANDS } from '../src/render/ledBoards.js';

const vars = (s) => (Array.isArray(s) ? s.join('|') : s).match(/\{\w+\}/g)?.sort().join(',') || '';

test('ru и en: одинаковые ключи и подстановки', () => {
  const { ru, en } = DICTS;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  for (const k of Object.keys(ru)) {
    assert.equal(typeof en[k], typeof ru[k], k);
    // английскому можно не использовать {minWord}: «3-minute match» без склонения
    const need = vars(ru[k]).split(',').filter((v) => v && v !== '{minWord}' && v !== '{goalWord}').join(',');
    const has = vars(en[k]).split(',').filter((v) => v && v !== '{minWord}' && v !== '{goalWord}').join(',');
    assert.equal(has, need, k);
  }
});

test('надписи LED-бортов набираются пиксельным шрифтом на обоих языках', () => {
  for (const lang of ['ru', 'en']) {
    setLang(lang);
    const texts = [...t('led.goal'), ...t('led.corner'), t('led.post'), t('led.bar'), t('led.foeGoal'), t('led.golden'), t('led.draw'), t('led.win'), t('led.over'), '+430', '+1250',
      ...BRANDS.map((b) => b.name), ...BRANDS.map((b) => t('slogan.' + b.id))];
    for (const s of texts) assert.ok(pixFits(s), `${lang}: «${s}»`);
  }
  setLang('auto');
});

test('склонение после числа', () => {
  setLang('ru');
  assert.deepEqual([1, 2, 5, 11, 21, 3].map((n) => plural(n, 'min')), ['минута', 'минуты', 'минут', 'минут', 'минута', 'минуты']);
  assert.equal(t('bot.start', { lvl: 'Средний', min: 3, minWord: plural(3, 'min') }), 'Матч с ботом · Средний · 3 минуты, побеждают очки');
  setLang('en');
  assert.deepEqual([1, 3].map((n) => plural(n, 'min')), ['minute', 'minutes']);
  assert.equal(t('net.rulePoints', { min: 3, minWord: plural(3, 'min') }), '3-minute match: the most points wins.');
  setLang('auto');
});
