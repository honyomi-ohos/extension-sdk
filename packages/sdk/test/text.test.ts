import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, parseDate, stripTags } from '../src/text.ts';

test('decodeEntities handles named / decimal / hex', () => {
  assert.equal(decodeEntities('a&amp;b'), 'a&b');
  assert.equal(decodeEntities('&lt;tag&gt;'), '<tag>');
  assert.equal(decodeEntities('&quot;q&quot;'), '"q"');
  assert.equal(decodeEntities('&#39;'), "'");
  assert.equal(decodeEntities('&#x41;'), 'A');
  assert.equal(decodeEntities('&#66;'), 'B');
  assert.equal(decodeEntities('&nbsp;x'), ' x');
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
  assert.equal(decodeEntities('&#x110000;'), '&#x110000;');
});

test('stripTags removes tags and decodes entities', () => {
  assert.equal(stripTags('<p>Hello <b>world</b></p>'), 'Hello world');
  assert.equal(stripTags('a&amp;b'), 'a&b');
  assert.equal(stripTags(''), '');
});

test('parseDate returns ms or 0', () => {
  assert.equal(parseDate('2026-01-02T03:04:05Z'), Date.parse('2026-01-02T03:04:05Z'));
  assert.equal(parseDate('not a date'), 0);
  assert.equal(parseDate(''), 0);
});
