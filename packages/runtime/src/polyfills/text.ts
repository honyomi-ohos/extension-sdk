// TextEncoder / TextDecoder —— fast-text-encoding（Apache-2.0），
// 替换原手写实现：正确处理 BOM/非法序列/流式边界。
// 形态注意（见 deps.d.ts）：该包是无 exports 的 IIFE，安装目标在求值期决定：
//   - 设备端 bootstrap 已设 global → 自装到 realm 全局，g.TextEncoder 已是函数
//   - 沙箱 / 无 global 环境 → esbuild CJS 模拟下 top-level this = exports，
//     从默认导入取 { TextEncoder, TextDecoder } 再装到 g
// 时序硬约束：whatwg-url 的 lib/encoding.js 在模块体执行 new TextEncoder()
// （其惰性 CJS 求值链早于 index.ts 编排体），而本模块先于 polyfills/url.ts
// 求值——因此必须在模块体尽早安装到 globalThis，不能等 installText。
import fte from 'fast-text-encoding';
import type { HostGlobal } from '../host';

if (typeof globalThis.TextEncoder !== 'function' && fte.TextEncoder !== undefined) {
  globalThis.TextEncoder = fte.TextEncoder;
}
if (typeof globalThis.TextDecoder !== 'function' && fte.TextDecoder !== undefined) {
  globalThis.TextDecoder = fte.TextDecoder;
}

export function installText(g: HostGlobal): void {
  if (typeof g.TextEncoder !== 'function' && fte.TextEncoder !== undefined) {
    g.TextEncoder = fte.TextEncoder;
  }
  if (typeof g.TextDecoder !== 'function' && fte.TextDecoder !== undefined) {
    g.TextDecoder = fte.TextDecoder;
  }
}
