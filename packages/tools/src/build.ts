// 插件构建：esbuild 编译 catalog 工程的 <key>/ → dist/<key>/main.js。
// - TS 插件（main.ts）：bundle 打包（相对导入自动打入）为自包含单文件 iife（es2020）
// - 手写插件（main.js）：不打包，仅压缩（顶层结构与 module.exports 等全局引用原样）
// 全部产物 minify；产物目录与源码分离（dist/）。
import * as esbuild from 'esbuild';
import { existsSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

// catalog 工程的构建产物。key 不含 src/：<id> 或 <lang>/<id>。
export function distMainJs(root: string, key: string): string {
  const parts = key.split(/[/\\]/).filter((part) => part !== '' && part !== '.' && part !== '..');
  return path.join(root, 'dist', ...parts, 'main.js');
}

export function pluginRel(root: string, dir: string): string {
  const rel = path.relative(root, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return path.basename(dir);
  }
  return rel.split(path.sep).join('/');
}

// dist 与 src 分开：源码在 src/<lang>/<id> 时，产物仍是 dist/<lang>/<id>/main.js。
export function outputKey(root: string, dir: string): string {
  const rel = pluginRel(root, dir);
  return rel.startsWith('src/') ? rel.slice('src/'.length) : rel;
}

const SKIP_DIRS = new Set(['node_modules', 'dist']);

function skipped(name: string): boolean {
  return name.startsWith('_') || name.startsWith('.') || SKIP_DIRS.has(name);
}

function hasEntry(dir: string): boolean {
  return existsSync(path.join(dir, 'main.ts')) || existsSync(path.join(dir, 'main.js'));
}

// 插件源码两种摆法都认：
// - <lang>/<id>/main.ts，或没有语言层的 <id>/（官方 catalog）
// - src/<lang>/<id>/main.ts（template：dist 与 src 分开，不和 lang 并列）
function collectPlugins(base: string, out: string[]): void {
  if (!existsSync(base)) {
    return;
  }
  for (const name of readdirSync(base)) {
    if (skipped(name)) {
      continue;
    }
    const dir = path.join(base, name);
    if (!statSync(dir).isDirectory()) {
      continue;
    }
    if (hasEntry(dir)) {
      out.push(dir);
      continue;
    }
    for (const child of readdirSync(dir)) {
      if (skipped(child)) {
        continue;
      }
      const nested = path.join(dir, child);
      if (!statSync(nested).isDirectory() || !hasEntry(nested)) {
        continue;
      }
      out.push(nested);
    }
  }
}

export function listPluginDirs(root: string): string[] {
  const out: string[] = [];
  collectPlugins(root, out);
  const src = path.join(root, 'src');
  if (existsSync(src) && statSync(src).isDirectory()) {
    collectPlugins(src, out);
  }
  return out;
}

// 独立插件工程的构建产物（<plugin>/dist/main.js）。
export function pluginMainJs(pluginDir: string): string {
  return path.join(pluginDir, 'dist', 'main.js');
}

const PLUGIN_DIR_KEY = /^(?:src\/)?[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/;

// 接受 src/zh/example、zh/example，以及语言目录 zh / src/zh。
export function normalizeKey(key: string): string {
  let norm = key.split(path.sep).join('/').replace(/\\/g, '/');
  if (norm.startsWith('./')) {
    norm = norm.slice(2);
  }
  return norm.replace(/\/+$/, '');
}

export function isPluginDirKey(key: string): boolean {
  return PLUGIN_DIR_KEY.test(normalizeKey(key));
}

function pluginMatches(rel: string, norm: string): boolean {
  return rel === norm || rel.endsWith(`/${norm}`) || rel.startsWith(`${norm}/`) || rel.includes(`/${norm}/`);
}

export function matchPluginDirs(root: string, keys: string[]): string[] {
  const all = listPluginDirs(root);
  if (keys.length === 0) {
    return all;
  }
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const key of keys) {
    const norm = normalizeKey(key);
    if (!PLUGIN_DIR_KEY.test(norm)) {
      throw new Error(`非法插件 key：${key}`);
    }
    const matched = all.filter((dir) => pluginMatches(pluginRel(root, dir), norm));
    if (matched.length === 0) {
      throw new Error(`不是插件目录（缺 main.ts / main.js）：${key}`);
    }
    for (const dir of matched) {
      const abs = path.resolve(dir);
      if (seen.has(abs)) {
        continue;
      }
      seen.add(abs);
      dirs.push(dir);
    }
  }
  return dirs;
}

export async function buildPlugins(root: string, keys: string[]): Promise<number> {
  const dirs = matchPluginDirs(root, keys);
  for (const dir of dirs) {
    const key = outputKey(root, dir);
    await buildPlugin(dir, distMainJs(root, key), root);
    console.log(`built dist/${key}/main.js`);
  }
  if (dirs.length === 0) {
    console.log('no plugins to build');
  }
  return dirs.length;
}

export async function buildPlugin(dir: string, outfile: string, absWorkingDir = dir): Promise<void> {
  const common: esbuild.BuildOptions = {
    outfile,
    target: 'es2020',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'silent',
    absWorkingDir,
  };
  if (existsSync(path.join(dir, 'main.ts'))) {
    await esbuild.build({
      ...common,
      entryPoints: [path.join(dir, 'main.ts')],
      bundle: true,
      format: 'iife',
      platform: 'browser',
    });
    return;
  }
  if (existsSync(path.join(dir, 'main.js'))) {
    await esbuild.build({
      ...common,
      entryPoints: [path.join(dir, 'main.js')],
      bundle: false,
    });
    return;
  }
  throw new Error(`不是插件目录（缺 main.ts / main.js）：${dir}`);
}
