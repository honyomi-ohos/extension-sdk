// runtime 测试自己用的 TypeScript loader，不依赖 plugins 工具链。
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
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
