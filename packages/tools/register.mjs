// esbuild TS loader：让 node 直接运行完整 TypeScript（enum / namespace 等非可擦除语法）。
// 用法：node --import ./tools/register.mjs <script.ts | --test ...>
// 替代 Node 原生 type stripping（strip-only 模式拒绝 enum/namespace/参数属性）；
// 模块解析仍走 Node 原生 resolver，仅 load 阶段经 esbuild transformSync 转译。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import * as esbuild from 'esbuild';

registerHooks({
  load(url, context, nextLoad) {
    if (url.split('?')[0].endsWith('.ts')) {
      const file = fileURLToPath(url);
      const out = esbuild.transformSync(readFileSync(file, 'utf8'), {
        loader: 'ts',
        format: 'esm',
        target: 'es2022',
        sourcemap: 'inline',
        sourcefile: file,
      });
      return { format: 'module', shortCircuit: true, source: out.code };
    }
    return nextLoad(url, context);
  },
});
