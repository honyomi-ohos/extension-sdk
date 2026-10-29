import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';
import { assertWorkPage, createFixtureFetch, loadExtension } from '@honyomi/plugin-tools/test';

const root = path.join(import.meta.dirname, '..');
const fixtures = path.join(import.meta.dirname, 'fixtures');

function load() {
  return loadExtension({
    pluginDir: root,
    fetchImpl: createFixtureFetch(fixtures),
  });
}

test('getPopularWorks parses the list and the next link', async () => {
  const loaded = load();
  const page = await loaded.ext.getPopularWorks(1);
  const works = assertWorkPage(page, 2);
  assert.equal(works[0]?.title, 'Alpha');
  assert.equal(works[1]?.key, '/work/2');
  assert.equal(page.hasNextPage, true);
  assert.ok(loaded.calls[0]?.url.includes('/list?page=1'));
});

test('getSearchWorks sends the query', async () => {
  const loaded = load();
  const page = await loaded.ext.getSearchWorks(1, 'alpha');
  assertWorkPage(page, 2);
  assert.ok(loaded.calls[0]?.url.includes('q=alpha'));
});
