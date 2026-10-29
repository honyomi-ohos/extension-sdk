// 插件安全测试：确认插件模式无跨插件偏好泄露。
// Node 可测覆盖面（真实 shim + vm 沙箱，非 SDK 桩）：
//   1. prefs 限定：$.prefs 只见本插件扁平偏好，直接探测受害者键名经任何途径均不可见
//   2. 引擎隔离：同进程两个插件实例（各自引擎）的偏好互不可见、互不污染
//   3. 桥收敛锁定：raw prefs 桥（__PREFS_STORE__ / __prefs_* / __prefsDump）不可见，
//      $.prefs 是唯一访问口且方法集固定
//   4. 沙箱最小暴露：vm 内无宿主 Node 全局（process/require/Buffer），构造器链逃逸无效
// 设备侧策略（ArkTS，由设备构建保证，Node 不可测）：
//   - HTTP 桥仅 http/https，https 禁降级、跨源重定向剥离凭据头（NativeHttpBridge.ets）
//   - 安装拒绝 key 相同但 name 不匹配的包（plugin_key_conflict），阻止仿冒既有插件 key 继承其偏好
//   - 卸载清除明文 blob（__extprefs）+ SecureStore 敏感值，重装/仿冒不继承旧值
import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import type { SourceExtension } from '@honyomi/plugin-sdk';
import { loadExtension } from '../src/index.ts';

const victimDir = path.join(import.meta.dirname, 'sec-victim');
const attackDir = path.join(import.meta.dirname, 'sec-attack');
const SECRET = 'VICTIM_SECRET_TOKEN_9f3e';

// 插件可见全局白名单（与 shim SURFACE_KEEP 同源）：
// 标准 JS 内建 + 公开 DSL + CJS 约定
const SURFACE_ALLOWLIST = new Set([
  // ECMAScript 标准内建
  'AggregateError', 'ArrayBuffer', 'Array', 'Atomics', 'BigInt',
  'BigInt64Array', 'BigUint64Array', 'Boolean', 'DataView', 'Date',
  'DisposableStack', 'AsyncDisposableStack', 'Error', 'EvalError',
  'FinalizationRegistry', 'Float16Array', 'Float32Array', 'Float64Array',
  'Function', 'Infinity', 'Int8Array', 'Int16Array', 'Int32Array',
  'Intl', 'Iterator', 'JSON', 'Map', 'Math', 'NaN', 'Number',
  'Object', 'Promise', 'Proxy', 'RangeError', 'ReferenceError',
  'Reflect', 'RegExp', 'Set', 'SharedArrayBuffer', 'String',
  'SuppressedError', 'Symbol', 'SyntaxError', 'TypeError', 'URIError',
  'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array',
  'WeakMap', 'WeakRef', 'WeakSet', 'WebAssembly', 'decodeURI',
  'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape',
  'eval', 'globalThis', 'isFinite', 'isNaN', 'parseFloat', 'parseInt',
  'unescape', 'undefined',
  // 运行时公开契约
  'console', 'global', 'module', 'exports', 'fetchBytes',
  'querySelectorAll', 'btoa', 'atob',
  'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'crypto',
  '$',
]);

interface VictimExt extends SourceExtension {
  readSecret: () => string;
  dumpStore: () => Record<string, string>;
}

interface StoreProbe {
  viaGet: string | undefined;
  viaAll: Record<string, string>;
  viaDump: Record<string, string>;
}

interface PrefsBridgeProbe {
  rawStore: string;
  rawGet: string;
  rawSet: string;
  rawRemove: string;
  rawClear: string;
  rawGetAll: string;
  rawDump: string;
  dollarPrefsKeys: string[];
}

interface HostProbe {
  process: string;
  require: string;
  Buffer: string;
  fnProcess: string;
  ctorProcess: string;
}

interface AttackExt extends SourceExtension {
  probeStore: () => StoreProbe;
  writePoison: () => string;
  poisonPrefs: () => { thrown: string; injected: string; own: string | undefined };
  probePrefsBridge: () => PrefsBridgeProbe;
  probeHost: () => HostProbe;
  probeGlobalSurface: () => string[];
}

function loadVictim(): VictimExt {
  return loadExtension({ pluginDir: victimDir, prefs: { token: SECRET } }).ext as VictimExt;
}

function loadAttacker(prefs: Record<string, string>): AttackExt {
  return loadExtension({ pluginDir: attackDir, prefs }).ext as AttackExt;
}

test('受害者插件可读自己种子的敏感偏好（正控）', async () => {
  const victim = loadVictim();
  assert.equal(await victim.readSecret(), SECRET);
  const store = await victim.dumpStore();
  assert.equal(store['token'], SECRET);
  assert.equal(Object.keys(store).length, 1);
});

test('攻击者直接探测受害者键名，任何 prefs 途径均不可见', async () => {
  const victim = loadVictim();
  const attacker = loadAttacker({ own: 'a' });

  // get / all / dump 全部只见自身偏好
  const probe = await attacker.probeStore();
  assert.equal(probe.viaGet, undefined);
  assert.equal(JSON.stringify(probe.viaAll), JSON.stringify({ own: 'a' }));
  assert.equal(JSON.stringify(probe.viaDump), JSON.stringify({ own: 'a' }));

  // 受害者不受攻击者加载影响
  assert.equal(await victim.readSecret(), SECRET);
});

test('攻击者写入只落在自身存储，受害者不受污染', async () => {
  const attackerPlugin = loadExtension({ pluginDir: attackDir, prefs: {} });
  const attacker = attackerPlugin.ext as AttackExt;
  assert.equal(await attacker.writePoison(), 'pwned');
  // 写入实际落入攻击者自身偏好快照
  assert.deepEqual(attackerPlugin.prefs(), { poison: 'pwned' });

  // 新引擎中的受害者（同种子重载）看不到污染
  const victim = loadVictim();
  const store = await victim.dumpStore();
  assert.equal(store['poison'], undefined);
  assert.equal(store['token'], SECRET);
});

test('原型键写入被拒绝，dump 快照不能回写存储', async () => {
  const attacker = loadAttacker({ own: 'a' });
  const probe = await attacker.poisonPrefs();
  assert.match(probe.thrown, /invalid prefs key/);
  assert.equal(probe.injected, 'undefined');
  assert.equal(probe.own, 'a');
});

test('raw prefs 桥不可见，$.prefs 是唯一访问口', async () => {
  const attacker = loadAttacker({});
  const probe = await attacker.probePrefsBridge();
  // raw 桥（__PREFS_STORE__ / __prefs_* / __prefsDump）全部退出插件可见面
  assert.equal(probe.rawStore, 'undefined');
  assert.equal(probe.rawGet, 'undefined');
  assert.equal(probe.rawSet, 'undefined');
  assert.equal(probe.rawRemove, 'undefined');
  assert.equal(probe.rawClear, 'undefined');
  assert.equal(probe.rawGetAll, 'undefined');
  assert.equal(probe.rawDump, 'undefined');
  // $.prefs 方法集固定（get/set/remove/clear/all/dump）
  assert.deepEqual(Array.from(probe.dollarPrefsKeys), ['all', 'clear', 'dump', 'get', 'remove', 'set']);
});

test('沙箱不暴露宿主 Node 全局，构造器链逃逸无效', async () => {
  const attacker = loadAttacker({});
  const probe = await attacker.probeHost();
  assert.equal(probe.process, 'undefined');
  assert.equal(probe.require, 'undefined');
  assert.equal(probe.Buffer, 'undefined');
  // vm realm 内 Function / constructor 链求值仍在沙箱上下文，取不到宿主全局
  assert.equal(probe.fnProcess, 'undefined');
  assert.equal(probe.ctorProcess, 'undefined');
});

test('插件可见全局面收敛：raw native 桥与内部实现不可见', async () => {
  const attacker = loadAttacker({});
  const names = await attacker.probeGlobalSurface();

  // raw native 桥 / 内部实现 / raw prefs 桥全部退出插件可见全局
  const hidden = ['__nativeHttpRequest', '__nativeHttpRequestShared',
    '__nativeUrlEncodeGbk', '__nativeDnsSet', 'nativeSelector', 'nativeSelectorBuffer',
    '__nativeLog', 'fetch', 'tachiyomiHttpRequest', '__honyomiPluginKey',
    '__PREFS_STORE__', '__nativeRandomBytes', '__prefs_get', '__prefs_set', '__prefs_remove',
    '__prefs_clear', '__prefs_getAll', '__prefsDump'];
  for (const name of hidden) {
    assert.ok(!names.includes(name), `${name} 不应出现在插件可见全局`);
  }

  // 公开契约必须保留
  const essential = ['$', 'fetchBytes', 'querySelectorAll', 'console',
    'module', 'exports', 'URL', 'URLSearchParams', 'crypto', 'TextEncoder',
    'TextDecoder', 'atob', 'btoa'];
  for (const name of essential) {
    assert.ok(names.includes(name), `${name} 应保留在插件可见全局`);
  }

  // 面 ⊆ 白名单（标准 JS 内建 + 公开 DSL），无未申报全局
  // （names/filter 来自 vm realm，Array.from 归一宿主原型后再比较）
  const unexpected = Array.from(names.filter((n) => !SURFACE_ALLOWLIST.has(n)));
  assert.deepEqual(
    unexpected,
    [],
    '存在白名单之外的全局，暴露面收敛被绕过',
  );
});
