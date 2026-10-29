// JSVM 宿主 runtime —— 宿主全局类型、raw 桥闭包捕获与 CJS/global 初始化。
// 本模块是 @honyomi/plugin-runtime 的编排根基（esbuild 打包为
// plugins/dist/runtime/，宿主自动打包时另写入 entry rawfile，两处都不入库）。
// 执行顺序契约（index.ts 编排）：captureHost() 必须最先运行，把 bootstrap
// 注入的 raw 桥（fetch / fetchBytes / __nativeUrlEncodeGbk）捕获进模块闭包，
// 供 $ DSL 在 surface 白名单清理之后继续使用。
// 模块求值顺序注意：esbuild 先于本模块体求值各依赖包
// （fast-text-encoding / whatwg-url / js-md5 / aes-js），因此各 polyfill
// 的安装函数均不依赖导入时序，只依赖安装时的宿主形状。

// ---- 宿主桥类型（ArkTS 侧注入契约：JsvmWorkerManager / NativeHttpBridge） ----

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  ok?: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  url?: string;
  text?: () => string;
}

export interface HttpBytesResponse {
  ok?: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  url?: string;
  bytes?: Uint8Array;
}

export type HostFetch = (url: string, options?: HttpRequestOptions) => HttpResponse;

export type HostFetchBytes = (url: string, options?: HttpRequestOptions) => HttpBytesResponse;

// ---- lexbor 桥的 JSON 节点形态（html_selector.h 契约） ----

export interface RawSummary {
  tag: string;
  id: string;
  className: string;
  text: string;
  ownText: string;

  // 前置兄弟元素摘要（最近优先；桥未提供时缺省）
  prevSiblings?: RawSummary[];
}

export interface RawHit {
  outerHtml: string;
  innerHtml: string;
  text: string;
  ownText: string;
  tag: string;
  attrs: Record<string, string>;
  prev: RawSummary | null;

  // 命中元素的前置兄弟摘要（最近优先，桥上限 16 个；旧数据缺省）
  prevSiblings?: RawSummary[];
  parents: RawSummary[];
}

// ---- polyfill 安装后的插件可见形状（与 @honyomi/plugin-sdk global.d.ts 对齐） ----

export interface UrlSearchParamsLike {
  append(key: string, value: string): void;

  set(key: string, value: string): void;

  get(key: string): string | null;

  getAll(key: string): string[];

  has(key: string): boolean;

  delete(key: string): void;

  toString(): string;
}

export interface UrlLike {
  href: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  searchParams: UrlSearchParamsLike;

  toString(): string;
}

export type UrlCtor = new (url: string, base?: string) => UrlLike;

export type UrlSearchParamsCtor = new (init?: string | UrlSearchParamsLike) => UrlSearchParamsLike;

export type TextEncoderCtor = new () => { encode(input?: string): Uint8Array };

export type TextDecoderCtor = new (label?: string) => { decode(input?: ArrayBuffer | Uint8Array): string };

// ---- crypto 适配形状（手写 subtle 适配层，保持 {_k,_a} 私有约定） ----

export interface SubtleKeyShape {
  _k?: Uint8Array;
  _a?: unknown;
}

export interface SubtleAlgo {
  name?: string;
  iv?: Uint8Array | ArrayBuffer;

  // HMAC / PBKDF2 的摘要选择（'SHA-256' 等，或 {name} 形状）
  hash?: string | SubtleAlgo;

  // PBKDF2
  salt?: Uint8Array | ArrayBuffer;
  iterations?: number;

  // AES-GCM 附加认证数据
  additionalData?: Uint8Array | ArrayBuffer;
}

export interface SubtleShape {
  importKey(format: string, keyData: Uint8Array | ArrayBuffer, algorithm: unknown): Promise<SubtleKeyShape>;

  encrypt(algorithm: SubtleAlgo, key: SubtleKeyShape, data: Uint8Array | ArrayBuffer): Promise<ArrayBuffer>;

  decrypt(algorithm: SubtleAlgo, key: SubtleKeyShape, data: Uint8Array | ArrayBuffer): Promise<ArrayBuffer>;

  // SHA-1 / SHA-256 / SHA-384 / SHA-512（@noble/hashes）
  digest(algorithm: string | SubtleAlgo, data: Uint8Array | ArrayBuffer): Promise<ArrayBuffer>;

  // HMAC-SHA1 / SHA-256 / SHA-384 / SHA-512
  sign(algorithm: SubtleAlgo, key: SubtleKeyShape, data: Uint8Array | ArrayBuffer): Promise<ArrayBuffer>;

  verify(algorithm: SubtleAlgo, key: SubtleKeyShape, signature: Uint8Array | ArrayBuffer,
    data: Uint8Array | ArrayBuffer): Promise<boolean>;

  // PBKDF2（length 为位长，须为 8 的倍数）
  deriveBits(algorithm: SubtleAlgo, key: SubtleKeyShape, length: number): Promise<ArrayBuffer>;
}

export interface CryptoShape {
  subtle?: SubtleShape;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

export interface VmModule {
  exports: unknown;
}

// 宿主全局（shim 运行的目标 realm；索引签名供 surface 白名单遍历/删除）
export interface HostGlobal {
  fetch?: HostFetch;
  fetchBytes?: HostFetchBytes;
  querySelectorAll: (html: string, css: string) => RawHit[];
  __nativeUrlEncodeGbk?: (text: string) => string;

  // C++ 侧 DNS 直连桥（__nativeDnsSet）：注册 host→IP 的 netstack 直连规则
  // （ArkTS Doh.pin）；沙箱由 sandbox.ts 注入 mock 实现并记录调用
  __nativeDnsSet?: (host: string, ipsJson: string) => string;

  // C++ 侧通用宿主调用桥（__nativeHostCall）：把 (kind, payloadJson) 转发给
  // ArkTS HostCalls 按 kind 路由（cookie 存取 / 图像像素编解码等宿主能力），
  // 同步返回 JsvmHttpResult 信封 JSON；沙箱由 sandbox.ts 注入 mock 实现
  __nativeHostCall?: (kind: string, payloadJson: string) => string;

  // C++ 侧 libohcrypto 硬件熵随机桥（crypto.getRandomValues 后端）；
  // 沙箱由 sandbox.ts 注入 node:crypto 实现，裸 vm 不注入（Math.random 兜底）
  __nativeRandomBytes?: (n: number) => Uint8Array;
  __PREFS_STORE__?: Record<string, string>;
  atob?: (s: string) => string;
  btoa?: (s: string) => string;
  TextEncoder?: TextEncoderCtor;
  TextDecoder?: TextDecoderCtor;
  URL?: UrlCtor;
  URLSearchParams?: UrlSearchParamsCtor;
  crypto?: CryptoShape;
  global?: unknown;
  module?: VmModule;
  exports?: unknown;
  $?: unknown;

  [key: string]: unknown;
}

// 目标 realm 全局对象：shim 总在插件所在 realm 内执行（设备 JSVM worker /
// 测试沙箱 vm.createContext），globalThis 即该 realm 的全局
export const g: HostGlobal = globalThis as unknown as HostGlobal;

// raw 桥闭包捕获（surface 清理后仍可经 $ DSL / crypto polyfill 使用）。
// 模块求值时先取一份；captureHost() 再按传入的宿主对象重绑，避免桥在
// 求值之后才挂上全局时读到空引用。
export const natives: {
  fetch?: HostFetch;
  fetchBytes?: HostFetchBytes;
  gbk?: (text: string) => string;
  randomBytes?: (n: number) => Uint8Array;
  dnsSet?: (host: string, ipsJson: string) => string;
  hostCall?: (kind: string, payloadJson: string) => string;
} = {
  fetch: g.fetch,
  fetchBytes: g.fetchBytes,
  gbk: g.__nativeUrlEncodeGbk,
  randomBytes: g.__nativeRandomBytes,
  dnsSet: g.__nativeDnsSet,
  hostCall: g.__nativeHostCall,
};

// CJS 约定与 global 兜底（设备 bootstrap 已设，沙箱/其它嵌入方未设时补齐）
export function captureHost(host: HostGlobal): void {
  natives.fetch = host.fetch;
  natives.fetchBytes = host.fetchBytes;
  natives.gbk = host.__nativeUrlEncodeGbk;
  natives.randomBytes = host.__nativeRandomBytes;
  natives.dnsSet = host.__nativeDnsSet;
  natives.hostCall = host.__nativeHostCall;
  if (typeof host.global === 'undefined') {
    host.global = host;
  }
  if (host.module === undefined) {
    const mod: VmModule = { exports: {} };
    host.module = mod;
    host.exports = mod.exports;
  }
}

// ---- SharedPreferences 宿主桥（内存扁平映射 + ArkTS 侧 seed） ----
// 安全边界：每个引擎实例只承载一个扩展，偏好存储是该扩展自己的扁平映射
// （k→v，闭包私有）。种子经 seed 脚本（先于 shim 执行）写入
// globalThis.__PREFS_STORE__，此处捕获进闭包后立即从全局删除——
// __PREFS_STORE__ / __prefs_* / __prefsDump 均不进插件可见面，
// prefs 能力仅经 $.prefs 提供（SDK createPrefs() 的后端）。

export let prefsStore: Record<string, string> = {};

export function capturePrefs(host: HostGlobal): void {
  const seed = host.__PREFS_STORE__;
  // 只接受普通对象。数组也是 object，但当偏好表会让数字下标混进持久化快照。
  if (typeof seed === 'object' && seed !== null && !Array.isArray(seed)) {
    prefsStore = seed;
  }
  delete host.__PREFS_STORE__;
}
