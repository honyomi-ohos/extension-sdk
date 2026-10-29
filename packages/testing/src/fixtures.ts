// fixture 路由：按 index.json 精确 URL 或 /正则/ 匹配本地文件回放。
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { FetchMock } from './sandbox.ts';

export interface FixtureEntry {
  file: string;
  status?: number;
  headers?: Record<string, string>;
}

// key 形如 "https://a.com/list"（精确）或 "/^https:\\/\\/a\\.com\\/img\\//"（正则）
export type FixtureIndex = Record<string, FixtureEntry>;

export function loadFixtureIndex(fixturesDir: string): FixtureIndex {
  return JSON.parse(readFileSync(path.join(fixturesDir, 'index.json'), 'utf8')) as FixtureIndex;
}

interface FixtureRule {
  matches: (url: string) => boolean;
  entry: FixtureEntry;
}

function readFixtureFile(fixturesDir: string, file: string): Buffer {
  if (typeof file !== 'string' || file === '' || file.includes('\0')) {
    throw new Error(`fixture 路径非法：${String(file)}`);
  }
  const base = path.resolve(fixturesDir);
  const target = path.resolve(base, file);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`fixture 路径越界：${file}`);
  }
  return readFileSync(target);
}

function compileRules(index: FixtureIndex): FixtureRule[] {
  const rules: FixtureRule[] = [];
  for (const pattern of Object.keys(index)) {
    const entry = index[pattern];
    if (pattern.length > 1 && pattern.startsWith('/') && pattern.endsWith('/')) {
      const source = pattern.slice(1, -1);
      if (source.length > 512) {
        throw new Error(`fixture 正则过长：${pattern}`);
      }
      let re: RegExp;
      try {
        re = new RegExp(source);
      } catch {
        throw new Error(`fixture 正则无效：${pattern}`);
      }
      rules.push({ matches: (url) => re.test(url), entry });
    } else {
      rules.push({ matches: (url) => url === pattern, entry });
    }
  }
  return rules;
}

export function createFixtureFetch(fixturesDir: string, index?: FixtureIndex): FetchMock {
  const rules = compileRules(index ?? loadFixtureIndex(fixturesDir));
  return (url: string): {
    status: number;
    headers: Record<string, string>;
    body: string;
    bytes: Uint8Array
  } => {
    const hit = rules.find((r) => r.matches(url));
    if (hit === undefined) {
      throw new Error(`fixture 未匹配请求：${url}（请在 index.json 补充条目）`);
    }
    const buf = readFixtureFile(fixturesDir, hit.entry.file);
    const status = hit.entry.status ?? 200;
    return {
      status,
      headers: hit.entry.headers ?? {},
      body: buf.toString('utf8'),
      bytes: new Uint8Array(buf),
    };
  };
}
