// 从本包的 template/ 复制一份 catalog 工程：<lang>/<id>/ 放插件。
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

const PLUGIN_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface InitOptions {
  dir: string;
  name: string;
  lang: string;
}

export function templateDir(): string {
  return path.resolve(import.meta.dirname, '..', 'template');
}

function toolsRoot(): string {
  return path.resolve(import.meta.dirname, '..');
}

function jsonString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

export function toolsDependencySpec(destDir: string): string {
  const root = toolsRoot();
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: string };
  const version = typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : '0.1.0';
  if (root.split(path.sep).includes('node_modules')) {
    return `^${version}`;
  }
  let rel = path.relative(destDir, root);
  if (path.isAbsolute(rel)) {
    return `file:${rel.split(path.sep).join('/')}`;
  }
  if (rel === '') {
    rel = '.';
  } else if (!rel.startsWith('.')) {
    rel = `.${path.sep}${rel}`;
  }
  return `file:${rel.split(path.sep).join('/')}`;
}

function assertEmpty(dir: string): void {
  if (!existsSync(dir)) {
    return;
  }
  const names = readdirSync(dir).filter((name) => name !== '.git');
  if (names.length > 0) {
    throw new Error(`目录不是空的，不能初始化：${dir}`);
  }
}

function applyTokens(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [token, value] of Object.entries(vars)) {
    out = out.split(token).join(value);
  }
  return out;
}

function writeTree(from: string, to: string, vars: Record<string, string>): void {
  for (const name of readdirSync(from)) {
    const src = path.join(from, name);
    const dest = path.join(to, applyTokens(name, vars));
    if (statSync(src).isDirectory()) {
      mkdirSync(dest, { recursive: true });
      writeTree(src, dest, vars);
      continue;
    }
    writeFileSync(dest, applyTokens(readFileSync(src, 'utf8'), vars));
  }
}

export function initProject(options: InitOptions): { dir: string; key: string } {
  const dir = path.resolve(options.dir);
  const name = options.name.trim();
  const lang = options.lang.trim();
  if (name === '') {
    throw new Error('插件显示名不能为空');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(lang)) {
    throw new Error('lang 只能包含字母、数字、_ 和 -');
  }
  assertEmpty(dir);
  const key = randomUUID();
  if (!PLUGIN_KEY.test(key)) {
    throw new Error(`生成的 key 不是 UUID v4：${key}`);
  }
  mkdirSync(dir, { recursive: true });
  writeTree(templateDir(), dir, {
    __KEY__: key,
    __NAME__: jsonString(name),
    __LANG__: lang,
    __TOOLS__: toolsDependencySpec(dir),
    __BASE__: 'https://example.com',
  });
  return { dir, key };
}
