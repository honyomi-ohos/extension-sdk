// 本地用 file: 安装本包时，npm 不会把依赖提升到使用方的 node_modules。
// 插件源码要直接 import @honyomi/plugin-sdk / plugin-test，所以在这里补上目录联接。
// 从 registry 安装时这些包已由 npm 提升，且旁边没有 packages/sdk，脚本直接退出。
import { lstatSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const prefix = process.env.npm_config_local_prefix;
if (prefix === undefined || prefix === '') {
  process.exit(0);
}

function absent(target) {
  try {
    lstatSync(target);
    return false;
  } catch {
    return true;
  }
}

function link(dest, target) {
  if (!absent(dest) || absent(target)) {
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  symlinkSync(target, dest, 'junction');
}

const nodeModules = path.join(prefix, 'node_modules');
link(path.join(nodeModules, '@honyomi', 'plugin-sdk'), path.join(packagesDir, 'sdk'));
link(path.join(nodeModules, '@honyomi', 'plugin-test'), path.join(packagesDir, 'testing'));
link(path.join(nodeModules, '@honyomi', 'plugin-runtime'), path.join(packagesDir, 'runtime'));
link(
  path.join(nodeModules, '@types', 'node'),
  path.join(packagesDir, '..', 'node_modules', '@types', 'node'),
);
