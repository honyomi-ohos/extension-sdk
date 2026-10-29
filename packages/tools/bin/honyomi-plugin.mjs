#!/usr/bin/env node
// 已发布的命令入口。源码仍是 TypeScript，由同包的 register.mjs 在启动时转译。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, [
  '--import', pathToFileURL(path.join(here, '..', 'register.mjs')).href,
  path.join(here, '..', 'src', 'cli.ts'),
  ...process.argv.slice(2),
], { stdio: 'inherit' });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
