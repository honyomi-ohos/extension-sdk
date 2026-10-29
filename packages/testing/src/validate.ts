// 插件返回值结构断言：宿主 Raw* 宽松形态的推荐命名校验。
import assert from 'node:assert/strict';
import type { RawChapter, RawFilter, RawPage, RawVideo, RawWork, WorkPage } from '@honyomi/plugin-sdk';

function nonEmptyString(v: unknown, what: string): void {
  assert.equal(typeof v, 'string', `${what} 应为 string`);
  assert.ok((v as string).length > 0, `${what} 不能为空`);
}

export function assertWorkPage(page: WorkPage, min = 1): RawWork[] {
  assert.ok(page !== null && typeof page === 'object', 'work page 应为对象');
  assert.ok(Array.isArray(page.works), 'works 应为数组');
  assert.ok(page.works.length >= min, `应至少返回 ${min} 部作品，实际 ${page.works.length}`);
  for (const m of page.works) {
    nonEmptyString(m.key, 'work.key');
    nonEmptyString(m.title, 'work.title');
  }
  assert.equal(typeof page.hasNextPage, 'boolean', 'hasNextPage 应为 boolean');
  return page.works;
}

export function assertDetail(work: RawWork): RawWork {
  assert.ok(work !== null && typeof work === 'object', 'detail 应为对象');
  nonEmptyString(work.key, 'detail.key');
  nonEmptyString(work.title, 'detail.title');
  return work;
}

export function assertChapterList(chapters: RawChapter[], min = 1): RawChapter[] {
  assert.ok(Array.isArray(chapters), '章节列表应为数组');
  assert.ok(chapters.length >= min, `应至少返回 ${min} 个章节，实际 ${chapters.length}`);
  for (const c of chapters) {
    nonEmptyString(c.key, 'chapter.key');
    nonEmptyString(c.name, 'chapter.name');
  }
  return chapters;
}

export function assertPageList(pages: RawPage[], min = 1): RawPage[] {
  assert.ok(Array.isArray(pages), '页面列表应为数组');
  assert.ok(pages.length >= min, `应至少返回 ${min} 页，实际 ${pages.length}`);
  for (const p of pages) {
    assert.equal(typeof p.index, 'number', 'page.index 应为 number');
    nonEmptyString(p.imageUrl, 'page.imageUrl');
  }
  return pages;
}

export function assertVideoList(videos: RawVideo[], min = 1): RawVideo[] {
  assert.ok(Array.isArray(videos), '视频列表应为数组');
  assert.ok(videos.length >= min, `应至少返回 ${min} 条视频，实际 ${videos.length}`);
  for (const v of videos) {
    nonEmptyString(v.url, 'video.url');
  }
  return videos;
}

export function assertFilterList(filters: RawFilter[]): RawFilter[] {
  assert.ok(Array.isArray(filters), '过滤器列表应为数组');
  assert.ok(filters.length > 0, '过滤器列表不能为空');
  for (const f of filters) {
    nonEmptyString(f.type, 'filter.type');
    nonEmptyString(f.name, 'filter.name');
  }
  return filters;
}

export function assertPrefs(prefs: Record<string, string>, expected: Record<string, string>): void {
  for (const key of Object.keys(expected)) {
    assert.equal(prefs[key], expected[key], `prefs[${key}]`);
  }
}
