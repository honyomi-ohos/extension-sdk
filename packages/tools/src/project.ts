// 命令行认两种工程，都不要求和 sdk 放在同一个仓库：
// - catalog 工程：package.json 的 name 是 honyomi-catalog。
//   官方目录是 <lang>/<id>/。template 把语言目录放进 src/，dist 留在工程根。
// - 独立插件目录：manifest.json + main.ts，产物是该目录的 dist/main.js
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

export interface Project {
  kind: 'catalog' | 'plugin';
  root: string;
  pluginKey?: string;
}

// 显式路径优先。没写路径时，当前目录落在某个插件里就只用该插件。空数组表示整个 catalog。
export function pluginArgs(project: Project, args: string[]): string[] {
  if (project.kind === 'plugin') {
    if (args.length > 0) {
      throw new Error('独立插件目录不接受插件路径');
    }
    return [];
  }
  if (args.length > 0) {
    return args;
  }
  return project.pluginKey === undefined ? [] : [project.pluginKey];
}

function readName(dir: string): string {
  const file = path.join(dir, 'package.json');
  if (!existsSync(file)) {
    return '';
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { name?: string };
    return typeof parsed.name === 'string' ? parsed.name : '';
  } catch {
    return '';
  }
}

function isPluginDir(dir: string): boolean {
  return existsSync(path.join(dir, 'manifest.json')) &&
    (existsSync(path.join(dir, 'main.ts')) || existsSync(path.join(dir, 'main.js')));
}

function pluginKeyFrom(root: string, start: string): string | undefined {
  const rel = path.relative(root, start);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return undefined;
  }
  let dir = start;
  while (dir !== root) {
    if (isPluginDir(dir)) {
      return path.relative(root, dir).split(path.sep).join('/');
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  const posix = rel.split(path.sep).join('/');
  if (posix === 'node_modules' || posix === 'dist' || posix.startsWith('node_modules/') || posix.startsWith('dist/') || posix.startsWith('.')) {
    return undefined;
  }
  return posix;
}

export function locateProject(cwd: string): Project | null {
  const start = path.resolve(cwd);
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (readName(dir) === 'honyomi-catalog') {
      const pluginKey = pluginKeyFrom(dir, start);
      return pluginKey === undefined ? { kind: 'catalog', root: dir } : { kind: 'catalog', root: dir, pluginKey };
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  if (isPluginDir(start)) {
    return { kind: 'plugin', root: start };
  }
  return null;
}
