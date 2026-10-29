import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { createFixtureFetch } from '../src/fixtures.ts';

const fixturesDir = path.join(import.meta.dirname, 'toy', 'fixtures');

test('fixture file path cannot escape the fixtures directory', () => {
  const fetchImpl = createFixtureFetch(fixturesDir, {
    'https://toy.test/escape': { file: '../../package.json' },
  });
  assert.throws(() => fetchImpl('https://toy.test/escape', {}), /越界/);
});

test('invalid fixture regex fails when the index is loaded', () => {
  assert.throws(() => createFixtureFetch(fixturesDir, {
    '/(/': { file: 'index.json' },
  }), /正则无效/);
});
