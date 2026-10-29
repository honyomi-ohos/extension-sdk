// e2e 框架自测：模式解析 / 录制 fetch / record→replay 回环 / 全流程 runner / 软硬步骤。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { FetchMock } from '../src/index.ts';
import { assertE2eReport, createE2EFetch, createRecordingFetch, e2eMode, runSourceE2E, } from '../src/index.ts';

const toyE2eDir = path.join(import.meta.dirname, 'toy-e2e');

// ---- 测试站点桩：全链路响应 ----------------------------------------------

const POPULAR_HTML = `<html><body><ul>
<li class="item"><a href="/m/1">第一本</a><img src="https://img.e2e.test/1.jpg"></li>
<li class="item"><a href="/m/2">第二本</a><img src="https://img.e2e.test/2.jpg"></li>
</ul></body></html>`;

const LATEST_HTML = `<html><body><ul>
<li class="item"><a href="/m/2">第二本</a></li>
</ul></body></html>`;

const DETAIL_HTML = `<html><body><h1>第一本</h1><p class="desc">这是简介</p></body></html>`;

const CHAPTERS_HTML = `<html><body><ul>
<li class="chapter"><a href="/m/1/c/1">第 1 话</a></li>
<li class="chapter"><a href="/m/1/c/2">第 2 话</a></li>
</ul></body></html>`;

const PAGES_HTML = `<html><body>
<img class="page" src="https://img.e2e.test/m/1/c/1/001.jpg">
<img class="page" src="https://img.e2e.test/m/1/c/1/002.jpg">
</body></html>`;

const SEARCH_HTML = `<html><body><ul>
<li class="item"><a href="/m/1">第一本</a></li>
</ul></body></html>`;

function toySiteFetch(): FetchMock {
  return (url: string): { status: number; headers: Record<string, string>; body: string } => {
    if (url.startsWith('https://e2e.test/popular')) {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: POPULAR_HTML };
    }
    if (url.startsWith('https://e2e.test/latest')) {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: LATEST_HTML };
    }
    if (url.startsWith('https://e2e.test/search')) {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: SEARCH_HTML };
    }
    if (/^https:\/\/e2e\.test\/m\/1\/c\/\d+$/.test(url)) {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: PAGES_HTML };
    }
    if (/^https:\/\/e2e\.test\/m\/\d+\/chapters$/.test(url)) {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: CHAPTERS_HTML };
    }
    if (/^https:\/\/e2e\.test\/m\/\d+$/.test(url)) {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: DETAIL_HTML };
    }
    throw new Error(`未预期的请求：${url}`);
  };
}

// ---- 模式解析 --------------------------------------------------------------

function withEnv(value: string | undefined, fn: () => void): void {
  const origin = process.env.HONYOMI_E2E;
  if (value === undefined) {
    delete process.env.HONYOMI_E2E;
  } else {
    process.env.HONYOMI_E2E = value;
  }
  try {
    fn();
  } finally {
    if (origin === undefined) {
      delete process.env.HONYOMI_E2E;
    } else {
      process.env.HONYOMI_E2E = origin;
    }
  }
}

test('e2eMode 解析各环境取值', () => {
  withEnv(undefined, () => assert.equal(e2eMode(), 'off'));
  withEnv('', () => assert.equal(e2eMode(), 'off'));
  withEnv('off', () => assert.equal(e2eMode(), 'off'));
  withEnv('0', () => assert.equal(e2eMode(), 'off'));
  withEnv('false', () => assert.equal(e2eMode(), 'off'));
  withEnv('replay', () => assert.equal(e2eMode(), 'replay'));
  withEnv('record', () => assert.equal(e2eMode(), 'record'));
  withEnv('live', () => assert.equal(e2eMode(), 'live'));
  withEnv('1', () => assert.equal(e2eMode(), 'replay'));
  withEnv('true', () => assert.equal(e2eMode(), 'replay'));
  withEnv('LIVE', () => assert.equal(e2eMode(), 'live'));
});

// ---- 录制 fetch ------------------------------------------------------------

test('createRecordingFetch 落盘 fixture + index 合并 + 哈希命名稳定', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'honyomi-e2e-rec-'));
  const recorder = createRecordingFetch({ fixturesDir: dir, baseFetch: toySiteFetch() });
  recorder('https://e2e.test/popular?page=1', {});
  recorder('https://e2e.test/m/1', {});
  // 同 URL 重录覆盖同一文件
  recorder('https://e2e.test/popular?page=1', {});

  const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8')) as
    Record<string, { file: string; status: number; headers?: Record<string, string> }>;
  assert.equal(Object.keys(index).length, 2);
  const popularEntry = index['https://e2e.test/popular?page=1'];
  assert.ok(popularEntry !== undefined);
  assert.equal(popularEntry.status, 200);
  assert.equal(popularEntry.headers?.['content-type'], 'text/html');
  assert.ok(popularEntry.file.endsWith('.html'), 'html 响应应落 .html 扩展名');
  const body = readFileSync(path.join(dir, popularEntry.file), 'utf8');
  assert.ok(body.includes('第一本'));
});

test('record → replay 回环：录制产物可直接回放全流程', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'honyomi-e2e-round-'));
  // 1) 录制
  const report = await runSourceE2E({
    pluginDir: toyE2eDir,
    fetchImpl: createRecordingFetch({ fixturesDir: dir, baseFetch: toySiteFetch() }),
  });
  assertE2eReport(report);
  assert.ok(existsSync(path.join(dir, 'index.json')));
  // 2) 离线回放同一份产物
  const replayReport = await runSourceE2E({
    pluginDir: toyE2eDir,
    fetchImpl: createE2EFetch({ mode: 'replay', fixturesDir: dir }),
  });
  assertE2eReport(replayReport);
  assert.equal(replayReport.works.length, 2);
  assert.equal(replayReport.chapters.length, 2);
  assert.equal(replayReport.pages.length, 2);
  assert.equal(replayReport.searchWorks.length, 1);
});

// ---- 全流程 runner ---------------------------------------------------------

test('runSourceE2E 全链路 happy path：6 步全绿 + 汇总数据', async () => {
  const report = await runSourceE2E({
    pluginDir: toyE2eDir,
    fetchImpl: toySiteFetch(),
  });
  assert.equal(report.ok, true);
  assert.equal(report.failedStep, null);
  assert.deepEqual(report.steps.map((s) => s.name), ['popular', 'latest', 'detail', 'chapters', 'pageList', 'search']);
  assert.ok(report.steps.every((s) => s.ok));
  assert.equal(report.works.length, 2);
  assert.equal(report.works[0].key, '/m/1');
  assert.equal(report.latestWorks.length, 1);
  assert.equal(report.detail?.title, '第一本');
  assert.equal(report.chapters.length, 2);
  assert.equal(report.pages.length, 2);
  assert.equal(report.pages[0].imageUrl, 'https://img.e2e.test/m/1/c/1/001.jpg');
  assert.equal(report.searchWorks.length, 1);
  // 搜索关键词缺省取热门第一条标题
  assert.ok(report.steps[5].summary.includes('第一本'));
});

test('runSourceE2E 硬步骤失败：popular 抛错即停，报告定位失败步骤', async () => {
  const broken: FetchMock = () => {
    throw new Error('连接被重置');
  };
  const report = await runSourceE2E({ pluginDir: toyE2eDir, fetchImpl: broken });
  assert.equal(report.ok, false);
  assert.equal(report.failedStep, 'popular');
  assert.equal(report.steps.length, 1);
  assert.match(report.steps[0].error ?? '', /连接被重置/);
  assert.throws(() => assertE2eReport(report), /e2e 失败于步骤 popular: 连接被重置/);
});

test('runSourceE2E 软步骤失败不判负：latest 挂了流程继续', async () => {
  const partial: FetchMock = (url: string) => {
    if (url.startsWith('https://e2e.test/latest')) {
      throw new Error('最新页不可用');
    }
    return toySiteFetch()(url, {});
  };
  const report = await runSourceE2E({ pluginDir: toyE2eDir, fetchImpl: partial });
  assert.equal(report.ok, true, 'latest 是默认软步骤，失败不判整体失败');
  const latest = report.steps.find((s) => s.name === 'latest');
  assert.ok(latest !== undefined);
  assert.equal(latest.ok, false);
  assert.match(latest.error ?? '', /最新页不可用/);
  assert.equal(report.chapters.length, 2);
});

test('runSourceE2E 中途断链：detail 失败后不再继续 chapters', async () => {
  const partial: FetchMock = (url: string) => {
    if (/^https:\/\/e2e\.test\/m\/\d+$/.test(url)) {
      throw new Error('详情页解析失败');
    }
    return toySiteFetch()(url, {});
  };
  const report = await runSourceE2E({ pluginDir: toyE2eDir, fetchImpl: partial });
  assert.equal(report.ok, false);
  assert.equal(report.failedStep, 'detail');
  assert.deepEqual(report.steps.map((s) => s.name), ['popular', 'latest', 'detail']);
});

test('runSourceE2E skipSearch 与软化的 search', async () => {
  const noSearch: FetchMock = (url: string) => {
    if (url.startsWith('https://e2e.test/search')) {
      throw new Error('搜索服务维护中');
    }
    return toySiteFetch()(url, {});
  };
  // 硬 search：失败判负
  const hard = await runSourceE2E({ pluginDir: toyE2eDir, fetchImpl: noSearch });
  assert.equal(hard.ok, false);
  assert.equal(hard.failedStep, 'search');
  // 软化后继续通过
  const soft = await runSourceE2E({
    pluginDir: toyE2eDir,
    fetchImpl: noSearch,
    softSteps: ['latest', 'search'],
  });
  assert.equal(soft.ok, true);
  assert.equal(soft.searchWorks.length, 0);
  // 或直接跳过
  const skipped = await runSourceE2E({ pluginDir: toyE2eDir, fetchImpl: noSearch, skipSearch: true });
  assert.equal(skipped.ok, true);
  assert.ok(!skipped.steps.some((s) => s.name === 'search'));
});
