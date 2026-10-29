import test from 'node:test';
import assert from 'node:assert/strict';
import type { DollarDsl } from '../src/types.ts';
import { createPrefs } from '../src/prefs.ts';

// 宿主 $.prefs 的最小桩（真源 plugin_runtime_jsvm.js）。
// 安全契约建模：每个引擎实例只有一个闭包私有扁平存储（k→v），
// raw __prefs_* 全局不进插件可见面，$.prefs 是唯一访问口。
const store: Record<string, string> = {};
globalThis.$ = {
  prefs: {
    get: (key: string): string | undefined => {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : undefined;
    },
    set: (key: string, value: string): void => {
      store[key] = value;
    },
    remove: (key: string): void => {
      delete store[key];
    },
    clear: (): void => {
      for (const k of Object.keys(store)) {
        delete store[k];
      }
    },
    all: (): Record<string, string> => {
      return { ...store };
    },
    dump: (): Record<string, string> => {
      return store;
    },
  },
} as unknown as DollarDsl;

test('prefs get/set/has/remove/clear', () => {
  const prefs = createPrefs();
  assert.equal(prefs.get('missing', 'fallback'), 'fallback');
  assert.equal(prefs.get('missing'), '');
  prefs.set('baseUrl', 'http://a/');
  assert.equal(prefs.get('baseUrl'), 'http://a/');
  assert.equal(prefs.has('baseUrl'), true);
  assert.equal(prefs.has('missing'), false);
  prefs.remove('baseUrl');
  assert.equal(prefs.has('baseUrl'), false);
  prefs.set('userId', 'u1');
  prefs.clear();
  assert.equal(prefs.has('userId'), false);
});

test('prefs isTrue / num / all', () => {
  const prefs = createPrefs();
  assert.equal(prefs.isTrue('flag'), false);
  assert.equal(prefs.isTrue('flag', true), true);
  prefs.set('flag', 'true');
  assert.equal(prefs.isTrue('flag'), true);
  prefs.set('flag', '1');
  assert.equal(prefs.isTrue('flag'), true);
  prefs.set('flag', '0');
  assert.equal(prefs.isTrue('flag'), false);

  assert.equal(prefs.num('n'), 0);
  assert.equal(prefs.num('n', 7), 7);
  prefs.set('n', '42');
  assert.equal(prefs.num('n'), 42);
  prefs.set('n', 'not-a-number');
  assert.equal(prefs.num('n', 9), 9);

  prefs.set('a', '1');
  prefs.set('b', '2');
  const all = prefs.all();
  assert.equal(all['a'], '1');
  assert.equal(all['b'], '2');
  assert.equal(all['flag'], '0');
  assert.equal(all['n'], 'not-a-number');
});
