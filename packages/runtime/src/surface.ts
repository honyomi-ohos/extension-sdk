// 插件可见面收敛：白名单兜底清理任何非公开契约的全局。
// 遍历全部自有全局属性，非 SURFACE_KEEP 且可配置的才删除（含未来新增的桥）。
// 不可配置的属性不碰：JSVM_DEFAULT 原生绑定上 strict delete 会抛
// TypeError: Cannot delete property '…'，插件脚本初始化直接失败。
// 插件可见面 = 标准 JS 内建 + 公开 DSL + CJS 约定 + prefs 桥；
// 安全回归锁定见 @honyomi/plugin-test 的 test/security.test.ts。
import type { HostGlobal } from './host';

const SURFACE_KEEP: Record<string, number> = {
  // ECMAScript 标准内建
  AggregateError: 1,
  ArrayBuffer: 1,
  Array: 1,
  Atomics: 1,
  BigInt: 1,
  BigInt64Array: 1,
  BigUint64Array: 1,
  Boolean: 1,
  DataView: 1,
  Date: 1,
  DisposableStack: 1,
  AsyncDisposableStack: 1,
  Error: 1,
  EvalError: 1,
  FinalizationRegistry: 1,
  Float16Array: 1,
  Float32Array: 1,
  Float64Array: 1,
  Function: 1,
  Infinity: 1,
  Int8Array: 1,
  Int16Array: 1,
  Int32Array: 1,
  Intl: 1,
  Iterator: 1,
  JSON: 1,
  Map: 1,
  Math: 1,
  NaN: 1,
  Number: 1,
  Object: 1,
  Promise: 1,
  Proxy: 1,
  RangeError: 1,
  ReferenceError: 1,
  Reflect: 1,
  RegExp: 1,
  Set: 1,
  SharedArrayBuffer: 1,
  String: 1,
  SuppressedError: 1,
  Symbol: 1,
  SyntaxError: 1,
  TypeError: 1,
  URIError: 1,
  Uint8Array: 1,
  Uint8ClampedArray: 1,
  Uint16Array: 1,
  Uint32Array: 1,
  WeakMap: 1,
  WeakRef: 1,
  WeakSet: 1,
  WebAssembly: 1,
  decodeURI: 1,
  decodeURIComponent: 1,
  encodeURI: 1,
  encodeURIComponent: 1,
  escape: 1,
  eval: 1,
  globalThis: 1,
  isFinite: 1,
  isNaN: 1,
  parseFloat: 1,
  parseInt: 1,
  unescape: 1,
  undefined: 1,
  // 运行时公开契约
  console: 1,
  global: 1,
  module: 1,
  exports: 1,
  fetchBytes: 1,
  querySelectorAll: 1,
  btoa: 1,
  atob: 1,
  TextEncoder: 1,
  TextDecoder: 1,
  URL: 1,
  URLSearchParams: 1,
  crypto: 1,
  $: 1,
};

function hideGlobal(g: HostGlobal, name: string): void {
  try {
    const desc = Object.getOwnPropertyDescriptor(g, name);
    if (desc === undefined || desc.configurable !== true) {
      return;
    }
    delete g[name];
  } catch {
    /* strict delete of a non-configurable property */
  }
}

export function pruneSurface(g: HostGlobal): void {
  const surfaceNames = Object.getOwnPropertyNames(g);
  for (const sname of surfaceNames) {
    if (!SURFACE_KEEP[sname]) {
      hideGlobal(g, sname);
    }
  }
}
