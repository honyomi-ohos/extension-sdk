import test from 'node:test';
import assert from 'node:assert/strict';
import { hostOf, joinUrl, relToAbs, trimSlash } from '../src/url.ts';

test('trimSlash strips trailing slashes', () => {
  assert.equal(trimSlash('http://a.com//'), 'http://a.com');
  assert.equal(trimSlash('http://a.com/path/'), 'http://a.com/path');
  assert.equal(trimSlash('http://a.com'), 'http://a.com');
});

test('hostOf extracts host', () => {
  assert.equal(hostOf('https://www.example.com/path?q=1'), 'www.example.com');
  assert.equal(hostOf('http://example.com'), 'example.com');
  assert.equal(hostOf('/relative/path'), '');
  assert.equal(hostOf('HTTPS://EXAMPLE.COM:8080/x'), 'example.com:8080');
});

test('relToAbs resolves variants', () => {
  const base = 'https://a.com/dir/page.html?x=1';
  assert.equal(relToAbs('https://b.com/x', base), 'https://b.com/x');
  assert.equal(relToAbs('//cdn.a.com/img.png', base), 'https://cdn.a.com/img.png');
  assert.equal(relToAbs('/root/path', base), 'https://a.com/root/path');
  assert.equal(relToAbs('next.html', base), 'https://a.com/dir/next.html');
  assert.equal(relToAbs('../up.html', base), 'https://a.com/dir/../up.html');
  assert.equal(relToAbs('', base), base);
  assert.equal(relToAbs('https://b.com/x', ''), 'https://b.com/x');
  assert.equal(relToAbs('page?q=2', 'https://a.com/dir/'), 'https://a.com/dir/page?q=2');
});

test('joinUrl joins base and path', () => {
  assert.equal(joinUrl('https://a.com/', '/api/v1'), 'https://a.com/api/v1');
  assert.equal(joinUrl('https://a.com', 'api'), 'https://a.com/api');
  assert.equal(joinUrl('https://a.com/base/', 'x'), 'https://a.com/base/x');
});
