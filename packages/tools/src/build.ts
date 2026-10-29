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

const PLUGIN_KEY = /^(?:src\/)?[A-Za-z0-9_-]+(?:\/[a-z0-9_]+)?$/;

export async function buildPlugins(root: string, keys: string[]): Promise<number> {
  const all = listPluginDirs(root);
  let dirs: string[] = [];
  if (keys.length === 0) {
    dirs = all;
  } else {
    for (const key of keys) {
      const norm = key.split(path.sep).join('/');
      if (!PLUGIN_KEY.test(norm)) {
        throw new Error(`非法插件 key：${key}`);
      }
      const matched = all.filter((dir) => {
        const rel = pluginRel(root, dir);
        return rel === norm || rel.endsWith(`/${norm}`) || rel.startsWith(`${norm}/`);
      });
      if (matched.length === 0) {
        throw new Error(`不是插件目录（缺 main.ts / main.js）：${key}`);
      }
      dirs.push(...matched);
    }
  }
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
