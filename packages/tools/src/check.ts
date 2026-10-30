// 静态检查：manifest 校验 + 插件构建产物陈旧检测。
// runtime rawfile 由构建生成、不入库，不再做已提交产物的逐字节比对。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { parseManifest, validateManifest } from './manifest.ts';
import { distMainJs, matchPluginDirs, outputKey, pluginMainJs, pluginRel } from './build.ts';

// 插件目录顶层源文件的最新 mtime（构建输入：TS 源 + 手写 main.js；test/ 子目录不算）
function newestSourceMtime(dir: string): number {
  let latest = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts') && name !== 'main.js') {
      continue;
    }
    const p = path.join(dir, name);
    if (!statSync(p).isFile()) {
      continue;
    }
    const m = statSync(p).mtimeMs;
    if (m > latest) {
      latest = m;
    }
  }
  return latest;
}

export function check(root: string, keys: string[] = []): void {
  const problems: string[] = [];
  const dirs = matchPluginDirs(root, keys);

  // manifest 校验：扁平 <id>/ 与 <lang>/<id>/ 都扫
  for (const dir of dirs) {
    const label = pluginRel(root, dir);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      problems.push(`${label}: 缺少 manifest.json`);
      continue;
    }
    const man = parseManifest(readFileSync(manifestPath, 'utf8'));
    if (man === null) {
      problems.push(`${label}: manifest.json 解析失败`);
      continue;
    }
    problems.push(...validateManifest(man, label));
  }

  // 陈旧检测：dist 产物缺失或早于任一顶层源文件
  for (const dir of dirs) {
    const key = outputKey(root, dir);
    const js = distMainJs(root, key);
    if (!existsSync(js)) {
      problems.push(`${key}: dist/${key}/main.js 缺失（npm run build）`);
    } else if (statSync(js).mtimeMs < newestSourceMtime(dir)) {
      problems.push(`${key}: 构建产物落后于源码（npm run build）`);
    }
  }

  if (problems.length > 0) {
    for (const p of problems) {
      console.error(`check: ${p}`);
    }
    throw new Error(`check 发现 ${problems.length} 处问题`);
  }
  console.log('check: ok');
}

export function checkStandalone(dir: string, label = 'lint'): void {
  const problems: string[] = [];
  const manifestPath = path.join(dir, 'manifest.json');
  const man = parseManifest(readFileSync(manifestPath, 'utf8'));
  const source = path.basename(dir);
  if (man === null) {
    problems.push(`${source}: manifest.json 解析失败`);
  } else {
    problems.push(...validateManifest(man, source));
  }
  const js = pluginMainJs(dir);
  if (!existsSync(js)) {
    problems.push(`${source}: dist/main.js 缺失（honyomi-plugin build）`);
  } else if (statSync(js).mtimeMs < newestSourceMtime(dir)) {
    problems.push(`${source}: 构建产物落后于源码（honyomi-plugin build）`);
  }
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`${label}: ${problem}`);
    }
    throw new Error(`${label} 发现 ${problems.length} 处问题`);
  }
}
