import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENES } from '../src/shorts/scenes.js';
import { checkShort, estimateSeconds } from '../src/shorts/check.js';

// Шортс-сцены детерминированы: правка физики или бота, которая ломает заснятый эпизод, видна здесь
for (const s of SCENES) {
  test(`шортс «${s.title}»: эпизод получается и длится 20–30 с`, () => {
    const { bad } = checkShort(s);
    assert.deepEqual(bad, []);
    const sec = estimateSeconds(s);
    assert.ok(sec >= 20 && sec <= 30, `длительность ${sec.toFixed(1)} с`);
  });
}
