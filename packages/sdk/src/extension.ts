// 插件入口注册：写入宿主提供的 CommonJS module.exports 并原样返回扩展对象。
// 经 globalThis 间接引用，避免 esbuild iife 输出将裸 `module` 识别为 CommonJS 标记
// 而在产物中生成自带的 module 垫片（宿主必须读到真实的 module.exports）。
import type { SourceExtension } from './types.ts';

interface CommonJsGlobal {
  module?: { exports?: unknown };
}

export function defineExtension(ext: SourceExtension): SourceExtension {
  const g = globalThis as unknown as CommonJsGlobal;
  const mod = g.module;
  if (mod !== undefined) {
    mod.exports = ext;
  }
  return ext;
}
