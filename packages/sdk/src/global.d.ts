// 宿主 JSVM 插件环境全局声明（非模块，ambient）。
// 真源：@honyomi/plugin-runtime 的 src/。Node 测试加载该包的 shim；
// 宿主 hvigor 在编译资源前把同一构建写入 rawfile，引擎侧先于 main.js 执行。
// 暴露面收敛：插件可见全局 = 标准 JS 内建 + 上述公开桥（shim 白名单锁定）；
// console 由宿主 bootstrap 提供（调试日志，自动带上当前插件前缀并打码密钥），
// 裸 fetch / raw native 桥 / raw prefs 桥
// （__PREFS_STORE__ / __prefs_* / __prefsDump）均已移除——
// HTTP 一律走 $.http / fetchBytes，偏好一律走 createPrefs()（后端 $.prefs）。

declare var $: import('./types.ts').DollarDsl;

declare var fetchBytes: (url: string, options?: import('./types.ts').HttpRequestOptions) =>
import('./types.ts').FetchBytesResult;

// 宿主 shim 注入的 WebCrypto 子集（getRandomValues 走原生随机桥，长度上限 65536）。
// 哈希/加密算法请用 $.crypto（同源实现，含 subtle 等价 API）。
declare var crypto: {
  getRandomValues(array: Uint8Array): Uint8Array;
};
