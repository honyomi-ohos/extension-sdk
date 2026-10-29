// @honyomi/plugin-runtime 构建。随工具链发布，不依赖应用仓库目录。
//   node build.mjs                         写入 dist/plugin_runtime_jsvm.js
//   node build.mjs --rawfile <outfile>     同一构建再写入宿主 rawfile
import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const shimOut = path.join(runtimeRoot, 'dist', 'plugin_runtime_jsvm.js');

const BANNER = [
  '// 由 runtime（@honyomi/plugin-runtime）经 esbuild 打包生成 —— 勿手改。',
  '// 源码：@honyomi/plugin-runtime。node build.mjs 写入 dist；宿主打包才加 --rawfile <outfile>。',
  '// 用途：JSVM 插件宿主 runtime（polyfills + $ DSL），拼接在每个扩展 main.js 之前。',
].join('\n');

function newestMtime(target) {
  if (!existsSync(target)) {
    return 0;
  }
  const info = statSync(target);
  if (info.isFile()) {
    return info.mtimeMs;
  }
  let latest = info.mtimeMs;
  for (const name of readdirSync(target)) {
    if (name === 'node_modules' || name === 'dist') {
      continue;
    }
    latest = Math.max(latest, newestMtime(path.join(target, name)));
  }
  return latest;
}

function stampFor(kind) {
  return path.join(runtimeRoot, 'dist', `${kind}.stamp`);
}

async function emit(outfile, kind) {
  const stamp = stampFor(kind);
  const fresh = existsSync(outfile) && existsSync(stamp) &&
    newestMtime(path.join(runtimeRoot, 'src')) <= statSync(stamp).mtimeMs &&
    newestMtime(path.join(runtimeRoot, 'package.json')) <= statSync(stamp).mtimeMs;
  if (fresh) {
    console.log(`runtime up to date ${path.relative(runtimeRoot, outfile)}`);
    return;
  }
  const result = await esbuild.build({
    entryPoints: [path.join(runtimeRoot, 'src', 'index.ts')],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'silent',
    absWorkingDir: runtimeRoot,
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: { js: BANNER },
    write: false,
  });
  const text = result.outputFiles?.[0]?.text ?? '';
  const previous = existsSync(outfile) ? readFileSync(outfile, 'utf8') : '';
  if (previous !== text) {
    mkdirSync(path.dirname(outfile), { recursive: true });
    writeFileSync(outfile, text);
    console.log(`built ${path.relative(runtimeRoot, outfile)}`);
  } else {
    console.log(`runtime unchanged ${path.relative(runtimeRoot, outfile)}`);
  }
  mkdirSync(path.dirname(stamp), { recursive: true });
  writeFileSync(stamp, '');
}

function rawfileArg() {
  const index = process.argv.indexOf('--rawfile');
  if (index === -1) {
    return '';
  }
  const given = process.argv[index + 1];
  if (given === undefined || given.startsWith('-')) {
    throw new Error('用法: node build.mjs --rawfile <outfile>');
  }
  return path.resolve(given);
}

await emit(shimOut, 'dist');
const rawfileOut = rawfileArg();
if (rawfileOut !== '') {
  await emit(rawfileOut, 'rawfile');
}
