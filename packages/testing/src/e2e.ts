// E2E 真站全流程测试支持。
//
// 设计：e2e = 用真实宿主 shim 加载插件构建产物，走通
//   popular → (latest) → detail → chapters → pages / chapterText / videoList → search
// 全链路。三种运行模式由环境变量 HONYOMI_E2E 控制：
//
//   unset / off / 0 / false   关闭（e2eTest / defineSourceE2eSuite 全部 skip，不触网）
//   replay（或 1 / true）     回放 test/fixtures-e2e/ 已录制响应（离线、确定性，CI 安全）
//   record                    真站全流程 + 把每个响应录制进 fixtures-e2e/（之后可 replay）
//   live                      真站全流程，不录制
//
// record/replay 与单测 fixture（createFixtureFetch）共用同一索引格式（index.json），
// e2e fixtures 固定放在 catalog/<key>/test/fixtures-e2e/，与单测 fixtures/ 分离。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type { FixtureIndex } from './fixtures.ts';
import { createFixtureFetch } from './fixtures.ts';
import type { FetchMock, FetchResponse } from './sandbox.ts';
import { liveFetch, loadExtension } from './sandbox.ts';
import { assertChapterList, assertDetail, assertPageList, assertVideoList, assertWorkPage } from './validate.ts';
import type { RawChapter, RawPage, RawVideo, RawWork } from '@honyomi/plugin-sdk';

// ---- 模式解析 ------------------------------------------------------------

export type E2eMode = 'off' | 'replay' | 'record' | 'live';

export function e2eMode(): E2eMode {
  const raw = (process.env.HONYOMI_E2E ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'off' || raw === '0' || raw === 'false') {
    return 'off';
  }
  if (raw === 'record') {
    return 'record';
  }
  if (raw === 'live') {
    return 'live';
  }
  // replay / 1 / true / 其它非空值
  return 'replay';
}

/** e2e 门控测试：HONYOMI_E2E 未开启时 skip（不触网、不占 CI 时间）。 */
export function e2eTest(name: string, fn: () => void | Promise<void>): void {
  const mode = e2eMode();
  test(name, { skip: mode === 'off' ? 'HONYOMI_E2E 未开启（replay/record/live）' : false }, fn);
}

// ---- 录制 fetch：真站响应 → fixture 文件 ----------------------------------

export interface RecordFetchOptions {
  // 录制输出目录（fixtures-e2e/），自动创建
  fixturesDir: string;

  // 被包裹的真站 fetch；缺省 liveFetch()（需系统 curl）
  baseFetch?: FetchMock;
}

function fixtureFileName(url: string, res: FetchResponse): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
  const body = res.body ?? '';
  const contentType = (res.headers?.['content-type'] ?? res.headers?.['Content-Type'] ?? '').toLowerCase();
  let ext = 'txt';
  if (contentType.includes('json') || /^\s*[[{]/.test(body)) {
    ext = 'json';
  } else if (contentType.includes('html') || /<html|<!doctype/i.test(body)) {
    ext = 'html';
  }
  return `${hash}.${ext}`;
}

/**
 * 录制模式 fetch：每次请求经 baseFetch（缺省真站 curl）取回响应后，
 * 把 body 写入 fixtures-e2e/、把精确 URL → 文件映射合并进 index.json。
 * 同 URL 重复请求覆盖同一文件（哈希命名稳定），可反复重录刷新。
 * 只记录 status 与 content-type，不落 Cookie / Set-Cookie 等敏感头。
 */
export function createRecordingFetch(options: RecordFetchOptions): FetchMock {
  const doFetch = options.baseFetch ?? liveFetch();
  mkdirSync(options.fixturesDir, { recursive: true });
  const indexPath = path.join(options.fixturesDir, 'index.json');
  let index: FixtureIndex = {};
  if (existsSync(indexPath)) {
    try {
      index = JSON.parse(readFileSync(indexPath, 'utf8')) as FixtureIndex;
    } catch {
      index = {};
    }
  }
  return (url, reqOptions): FetchResponse => {
    const res = doFetch(url, reqOptions);
    const file = fixtureFileName(url, res);
    writeFileSync(path.join(options.fixturesDir, file), res.body ?? '', 'utf8');
    const contentType = res.headers?.['content-type'] ?? res.headers?.['Content-Type'];
    const entry: { file: string; status?: number; headers?: Record<string, string> } = {
      file,
      status: res.status ?? 200,
    };
    if (contentType !== undefined && contentType !== '') {
      entry.headers = { 'content-type': contentType };
    }
    index[url] = entry;
    writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
    return res;
  };
}

export interface E2eFetchOptions {
  // 缺省 e2eMode()
  mode?: E2eMode;

  // replay / record 必需
  fixturesDir?: string;

  // record / live 的底层 fetch（测试注入桩用；缺省 liveFetch()）
  baseFetch?: FetchMock;
}

/** 按模式装配 e2e fetch：replay → fixture 回放；record → 真站录制；live → 真站直连。 */
export function createE2EFetch(options: E2eFetchOptions): FetchMock {
  const mode = options.mode ?? e2eMode();
  if (mode === 'replay') {
    if (options.fixturesDir === undefined) {
      throw new Error('replay 模式需要 fixturesDir');
    }
    return createFixtureFetch(options.fixturesDir);
  }
  if (mode === 'record') {
    if (options.fixturesDir === undefined) {
      throw new Error('record 模式需要 fixturesDir');
    }
    return createRecordingFetch({ fixturesDir: options.fixturesDir, baseFetch: options.baseFetch });
  }
  return options.baseFetch ?? liveFetch();
}

// ---- 全流程 runner ---------------------------------------------------------

export interface E2eStepResult {
  name: string;
  ok: boolean;

  // 软步骤失败只记录，不判整体失败
  soft: boolean;
  durationMs: number;
  summary: string;
  error?: string;
}

export interface E2eReport {
  ok: boolean;
  failedStep: string | null;
  steps: E2eStepResult[];
  works: RawWork[];
  latestWorks: RawWork[];
  detail: RawWork | null;
  chapters: RawChapter[];
  pages: RawPage[];
  chapterText: string;
  videos: RawVideo[];
  searchWorks: RawWork[];
}

export interface RunSourceE2eOptions {
  pluginDir: string;
  prefs?: Record<string, string>;

  // 缺省 liveFetch()；replay/record 场景传 createE2EFetch(...) 结果
  fetchImpl?: FetchMock;

  // 缺省读 manifest.contentType ?? 'manga'
  contentType?: string;

  // 搜索关键词；缺省用热门第一条标题（真站必然有结果）
  searchQuery?: string;

  // 跳过 search 步骤（搜索受损的源）
  skipSearch?: boolean;

  // 软步骤名单：失败只记录不判负。缺省 ['latest']
  softSteps?: string[];
  minWorks?: number;
  minChapters?: number;
  minPages?: number;
  minVideos?: number;
  minTextLength?: number;
  minSearchResults?: number;
  mainJs?: string;
  shimPath?: string;
}

function readManifestContentType(pluginDir: string): string {
  try {
    const manifest =
      JSON.parse(readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8')) as { contentType?: string };
    return manifest.contentType ?? 'manga';
  } catch {
    return 'manga';
  }
}

/**
 * 全流程 e2e：按 contentType 依次走通
 *   popular → latest(可选,软) → detail → chapters → pageList/chapterText/videoList → search
 * 硬步骤首个失败即停（后续步骤依赖前序数据），返回结构化报告（不抛错）。
 * 测试侧用 assertE2eReport(report) 断言。
 */
export async function runSourceE2E(options: RunSourceE2eOptions): Promise<E2eReport> {
  const contentType = options.contentType ?? readManifestContentType(options.pluginDir);
  const soft = new Set(options.softSteps ?? ['latest']);
  const report: E2eReport = {
    ok: true,
    failedStep: null,
    steps: [],
    works: [],
    latestWorks: [],
    detail: null,
    chapters: [],
    pages: [],
    chapterText: '',
    videos: [],
    searchWorks: [],
  };

  const plugin = loadExtension({
    pluginDir: options.pluginDir,
    prefs: options.prefs,
    fetchImpl: options.fetchImpl ?? liveFetch(),
    mainJs: options.mainJs,
    shimPath: options.shimPath,
  });

  const runStep =
    async<T>(name: string, fn: () => Promise<T> | T, summaryOf: (value: T) => string): Promise<T | null> => {
      const started = Date.now();
      try {
        const value = await fn();
        report.steps.push({
          name,
          ok: true,
          soft: soft.has(name),
          durationMs: Date.now() - started,
          summary: summaryOf(value)
        });
        return value;
      } catch (error) {
        const message = error instanceof Error ? `${error.message}` : String(error);
        report.steps.push({
          name,
          ok: false,
          soft: soft.has(name),
          durationMs: Date.now() - started,
          summary: '',
          error: message
        });
        if (!soft.has(name)) {
          report.ok = false;
          report.failedStep = name;
        }
        return null;
      }
    };

  const hardFailed = (name: string): boolean => report.failedStep === name;

  // 1. popular（硬）
  const popular = await runStep(
    'popular',
    async () => {
      const page = await plugin.ext.getPopularWorks(1);
      assertWorkPage(page, options.minWorks ?? 1);
      return page;
    },
    (p) => `${p.works.length} 部 / hasNext=${p.hasNextPage}`,
  );
  if (popular === null) {
    return report;
  }
  report.works = popular.works;

  // 2. latest（可选，默认软步骤）
  if (typeof plugin.ext.getLatestWorks === 'function') {
    const latest = await runStep(
      'latest',
      async () => {
        const page = await plugin.ext.getLatestWorks?.(1);
        if (page === undefined) {
          throw new Error('getLatestWorks 未返回结果');
        }
        assertWorkPage(page, 0);
        return page;
      },
      (p) => `${p.works.length} 部 / hasNext=${p.hasNextPage}`,
    );
    if (latest !== null) {
      report.latestWorks = latest.works;
    }
  }

  const first = report.works[0];

  // 3. detail（硬）
  const detail = await runStep(
    'detail',
    async () => {
      const fn = plugin.ext.getWorkDetail;
      if (typeof fn !== 'function') {
        throw new Error('插件未导出 getWorkDetail');
      }
      return assertDetail(await fn(first.key));
    },
    (d) => String(d.title ?? ''),
  );
  if (detail === null && hardFailed('detail')) {
    return report;
  }
  if (detail !== null) {
    report.detail = detail;
  }

  // 4. chapters（硬）
  const chapters = await runStep(
    'chapters',
    async () => {
      const fn = plugin.ext.getChapterList;
      if (typeof fn !== 'function') {
        throw new Error('插件未导出 getChapterList');
      }
      return assertChapterList(await fn(detail?.key || first.key), options.minChapters ?? 1);
    },
    (cs) => `${cs.length} 章`,
  );
  if (chapters === null) {
    return report;
  }
  report.chapters = chapters;

  // 5. 正文步骤（按 contentType）
  if (contentType === 'novel') {
    const text = await runStep(
      'chapterText',
      async () => {
        const fn = plugin.ext.getChapterText;
        if (typeof fn !== 'function') {
          throw new Error('novel 源未导出 getChapterText');
        }
        const value = await fn(chapters[0].key);
        const text = typeof value === 'string' ? value : String(value ?? '');
        const min = options.minTextLength ?? 1;
        if (text.trim().length < min) {
          throw new Error(`章节正文过短（${text.trim().length} < ${min}）`);
        }
        return text;
      },
      (t) => `${t.trim().length} 字符`,
    );
    if (text === null && hardFailed('chapterText')) {
      return report;
    }
    if (text !== null) {
      report.chapterText = text;
    }
  } else if (contentType === 'video') {
    const videos = await runStep(
      'videoList',
      async () => {
        const fn = plugin.ext.getVideoList;
        if (typeof fn !== 'function') {
          throw new Error('video 源未导出 getVideoList');
        }
        return assertVideoList(await fn(chapters[0].key), options.minVideos ?? 1);
      },
      (vs) => `${vs.length} 路`,
    );
    if (videos === null && hardFailed('videoList')) {
      return report;
    }
    if (videos !== null) {
      report.videos = videos;
    }
  } else {
    const pages = await runStep(
      'pageList',
      async () => {
        const fn = plugin.ext.getPageList;
        if (typeof fn !== 'function') {
          throw new Error('manga 源未导出 getPageList');
        }
        return assertPageList(await fn(chapters[0].key), options.minPages ?? 1);
      },
      (ps) => `${ps.length} 页`,
    );
    if (pages === null && hardFailed('pageList')) {
      return report;
    }
    if (pages !== null) {
      report.pages = pages;
    }
  }

  // 6. search（硬；skipSearch 或列入 softSteps 时跳过/软化）
  if (options.skipSearch !== true && !soft.has('search')) {
    const query = options.searchQuery ?? String(first.title ?? '');
    const search = await runStep(
      'search',
      async () => {
        const page = await plugin.ext.getSearchWorks(1, query);
        assertWorkPage(page, options.minSearchResults ?? 1);
        return page;
      },
      (p) => `query="${query}" → ${p.works.length} 部`,
    );
    if (search === null) {
      return report;
    }
    report.searchWorks = search.works;
  }

  return report;
}

/** 断言 e2e 报告全绿；失败时给出失败步骤与原因。 */
export function assertE2eReport(report: E2eReport): void {
  if (report.ok) {
    return;
  }
  const failed = report.steps.find((s) => !s.ok && !s.soft);
  assert.fail(`e2e 失败于步骤 ${report.failedStep}: ${failed?.error ?? '未知错误'}`);
}

// ---- 一行式套件：插件侧只需 defineSourceE2eSuite({ pluginDir }) ------------

export interface SourceE2eSuiteOptions extends Omit<RunSourceE2eOptions, 'pluginDir' | 'fetchImpl'> {
  pluginDir: string;

  // 缺省 <pluginDir>/test/fixtures-e2e
  fixturesDir?: string;

  // 测试名前缀；缺省取 manifest key（目录名）
  name?: string;
}

/**
 * 为插件注册一个完整的 e2e 测试：
 *   import { defineSourceE2eSuite } from '@honyomi/plugin-test';
 *   import * as path from 'node:path';
 *   defineSourceE2eSuite({ pluginDir: path.join(import.meta.dirname, '..') });
 * HONYOMI_E2E 未开启时 skip；replay 模式下未录制 fixtures 也 skip（提示先 record）。
 */
export function defineSourceE2eSuite(options: SourceE2eSuiteOptions): void {
  const mode = e2eMode();
  const fixturesDir = options.fixturesDir ?? path.join(options.pluginDir, 'test', 'fixtures-e2e');
  const name = options.name ?? path.basename(options.pluginDir);
  const recorded = existsSync(path.join(fixturesDir, 'index.json'));
  let skip: string | false = false;
  if (mode === 'off') {
    skip = 'HONYOMI_E2E 未开启（replay/record/live）';
  } else if (mode === 'replay' && !recorded) {
    skip = '未录制 e2e fixtures（先运行 npm run test:e2e:record）';
  }
  test(`${name} 真站全流程 e2e [${mode}]`, { skip }, async () => {
    const report = await runSourceE2E({
      ...options,
      fetchImpl: createE2EFetch({ mode, fixturesDir }),
    });
    assertE2eReport(report);
  });
}
