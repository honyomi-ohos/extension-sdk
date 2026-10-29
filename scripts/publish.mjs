// 按依赖顺序发布四个包。发布时把 file: 依赖改写成当前版本，结束后还原 package.json。
// 用法（需已 npm login，且 scope @honyomi 可发布）：node scripts/publish.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const order = ['sdk', 'runtime', 'testing', 'tools'];

function readPkg(dir) {
  const file = path.join(dir, 'package.json');
  return { file, raw: readFileSync(file, 'utf8') };
}

const versions = new Map();
for (const name of order) {
  const { raw } = readPkg(path.join(root, 'packages', name));
  const json = JSON.parse(raw);
  versions.set(json.name, json.version);
}

function publishOne(name) {
  const dir = path.join(root, 'packages', name);
  const { file, raw } = readPkg(dir);
  const json = JSON.parse(raw);
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = json[field];
    if (deps === undefined) {
      continue;
    }
    for (const [dep, spec] of Object.entries(deps)) {
      if (typeof spec === 'string' && spec.startsWith('file:') && versions.has(dep)) {
        deps[dep] = versions.get(dep);
      }
    }
  }
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, ['publish', '--access', 'public'], {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  writeFileSync(file, raw);
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const name of order) {
  publishOne(name);
}
