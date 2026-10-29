#!/usr/bin/env node
// e2e 测试入口：跨平台设置 HONYOMI_E2E 后运行插件的 *.e2e.test.ts。
// 用法：node ../tools/bin/e2e.mjs [replay|record|live] [glob...]
//   缺省模式 replay（离线回放已录制 fixtures）。
//   glob 缺省 "*/test/*.e2e.test.ts"（在 catalog 目录执行）；可传插件名（如 wenku8）
//   自动展开为 "catalog/<name>/test/*.e2e.test.ts" 之外的精确路径。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const modes = new Set(['replay', 'record', 'live']);
let mode = 'replay';
if (args.length > 0 && modes.has(args[0])) {
  mode = args.shift() ?? 'replay';
}
process.env.HONYOMI_E2E = mode;

let globs = args.filter((a) => !a.startsWith('-'));
const flags = args.filter((a) => a.startsWith('-'));
if (globs.length === 0) {
  globs = ['*/test/*.e2e.test.ts'];
} else {
  // 允许直接传插件名：wenku8 → wenku8/test/*.e2e.test.ts
  globs = globs.map((g) => /^[a-z0-9_]+$/.test(g) ? `${g}/test/*.e2e.test.ts` : g);
}

const result = spawnSync(process.execPath, [
  '--import', pathToFileURL(path.join(here, '..', 'register.mjs')).href,
  '--test',
  ...globs,
  ...flags,
], { stdio: 'inherit' });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
