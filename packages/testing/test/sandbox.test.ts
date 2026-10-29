import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { assertDetail, assertPrefs, assertWorkPage, createFixtureFetch, loadExtension } from '../src/index.ts';

const toyDir = path.join(import.meta.dirname, 'toy');

test('sandbox runs real shim + toy plugin over fixtures', async () => {
  const plugin = loadExtension({
    pluginDir: toyDir,
    prefs: { tag: 'seeded' },
    fetchImpl: createFixtureFetch(path.join(toyDir, 'fixtures')),
  });

  const page = plugin.ext.getPopularWorks(1);
  const works = assertWorkPage(await page, 2);
  assert.equal(works[0].key, '/m/1');
  assert.equal(works[0].title, '第一本');
  assert.equal(works[0].coverUrl, 'https://toy.test/m/1');

  const detailFn = plugin.ext.getWorkDetail;
  assert.ok(typeof detailFn === 'function', 'getWorkDetail 应存在');
  const detail = assertDetail(await detailFn('/m/1'));
  assert.equal(detail.title, '第一本');
  assert.equal(detail.description, '这是简介文本 & 含实体');

  // 种子偏好可见，setPreference 经 $.prefs.set 写入
  assertPrefs(plugin.prefs(), { tag: 'seeded' });
  // setPreference 返回对象来自 vm realm（原型不同），deepStrictEqual 会因原型不等失败 → 比较字段
  const r = await plugin.ext.setPreference?.('token', 'abc');
  assert.equal((r as { ok?: boolean }).ok, true);
  assert.equal(plugin.prefs().token, 'abc');

  // fetch 调用被记录（含 header/body）
  assert.equal(plugin.calls.length, 2);
  assert.equal(plugin.calls[0].url, 'https://toy.test/list?page=1');
  assert.equal(plugin.calls[0].method, 'GET');
  assert.equal(plugin.calls[1].url, 'https://toy.test/m/1');
});

test('sandbox handles search + regex fixture rules + hasNextPage', async () => {
  const plugin = loadExtension({
    pluginDir: toyDir,
    fetchImpl: createFixtureFetch(path.join(toyDir, 'fixtures')),
  });
  const page = await plugin.ext.getSearchWorks(1, '关键词');
  const works = assertWorkPage(page, 2);
  assert.equal(works[1].key, '/m/2');
  assert.equal(page.hasNextPage, false);
  assert.ok(plugin.calls[0].url.startsWith('https://toy.test/search?q='));
});

test('unmatched request fails loudly', () => {
  const plugin = loadExtension({
    pluginDir: toyDir,
    fetchImpl: (url) => {
      throw new Error(`fixture 未匹配请求：${url}`);
    },
  });
  assert.throws(() => plugin.ext.getPopularWorks(3), /未匹配/);
});

test('sandbox host-call mock: 内存 cookie jar + PNG 像素往返', () => {
  const plugin = loadExtension({ pluginDir: toyDir });
  const toyExtra = plugin.ext as unknown as {
    cookieSet(url: string, name: string, value: string): void;
    cookieGet(url: string, name: string): string;
    cookieHeader(url: string): string;
    imageDecode(bytes: Uint8Array): { width: number; height: number; pixels: Uint8Array };
    imageEncodePng(width: number, height: number, pixels: Uint8Array): Uint8Array;
  };

  // cookie 存取（内存 jar，域后缀匹配与宿主 CookieJar 语义一致）
  toyExtra.cookieSet('https://a.example/', 's', 'v1');
  assert.equal(toyExtra.cookieGet('https://a.example/', 's'), 'v1');
  assert.equal(toyExtra.cookieGet('https://sub.a.example/', 's'), 'v1');
  assert.equal(toyExtra.cookieHeader('https://sub.a.example/'), 's=v1');
  assert.equal(toyExtra.cookieGet('https://a.example/', 'missing'), '');
  assert.equal(plugin.hostCalls.length, 5);
  assert.equal(plugin.hostCalls[0].kind, 'cookieSet');
  assert.deepEqual(JSON.parse(plugin.hostCalls[0].payload),
    { url: 'https://a.example/', name: 's', value: 'v1' });

  // 图像像素往返：RGBA → PNG → RGBA（沙箱纯 JS PNG 编解码器）
  const rgba = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const png = toyExtra.imageEncodePng(2, 1, rgba);
  assert.equal(png[0], 0x89);
  assert.equal(png[1], 0x50);
  assert.equal(png[2], 0x4e);
  const img = toyExtra.imageDecode(png);
  assert.equal(img.width, 2);
  assert.equal(img.height, 1);
  assert.deepEqual(Array.from(img.pixels), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(plugin.hostCalls[5].kind, 'imageEncodePng');
  assert.equal(plugin.hostCalls[6].kind, 'imageDecode');
});
