import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterOf, genreOf, pageOf, videoOf, workOf, workPage } from '../src/models.ts';

test('workOf builds RawWork with extras', () => {
  const m = workOf('k1', 'Title', { author: 'A', genre: ['g1', 'g2'] });
  assert.equal(m.key, 'k1');
  assert.equal(m.title, 'Title');
  assert.equal(m.author, 'A');
  assert.deepEqual(m.genre, ['g1', 'g2']);
});

test('genreOf joins arrays', () => {
  assert.equal(genreOf(['a', 'b']), 'a, b');
  assert.equal(genreOf('a'), 'a');
  assert.equal(genreOf(undefined), '');
});

test('workPage wraps list', () => {
  const p = workPage([workOf('k', 't')], true);
  assert.equal(p.works.length, 1);
  assert.equal(p.hasNextPage, true);
});

test('chapterOf / pageOf / videoOf defaults', () => {
  const c = chapterOf('ck', '第 1 话', {
    chapterNumber: 1,
    dateUpload: 123,
    pages: 0,
    sortOrder: 0
  });
  assert.equal(c.name, '第 1 话');
  assert.equal(c.chapterNumber, 1);

  const p = pageOf(0, 'https://img/0.jpg', 'https://page/0');
  assert.equal(p.index, 0);
  assert.equal(p.imageUrl, 'https://img/0.jpg');
  assert.equal(p.pageUrl, 'https://page/0');
  const p2 = pageOf(1, 'https://img/1.jpg');
  assert.equal(p2.pageUrl, undefined);

  const v = videoOf('https://v/master.m3u8', 'HLS 在线', {});
  assert.equal(v.quality, 'HLS 在线');
  assert.deepEqual(v.headers, {});
});
