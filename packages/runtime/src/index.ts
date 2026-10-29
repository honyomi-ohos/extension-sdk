// JSVM 宿主 runtime —— polyfills + 原始 Mihon $ DSL + 暴露面收敛。
// 本入口经 esbuild 打包。node build.mjs 写入 dist/plugin_runtime_jsvm.js，
// 沙箱加载那份产物。宿主 hvigor 再执行 build.mjs --rawfile <outfile>，
// 把同一构建写入 entry rawfile/plugin_runtime_jsvm.js，引擎侧拼到 main.js 之前。
import type { HostGlobal } from './host';
import { captureHost, capturePrefs, g } from './host';
import { installBase64 } from './polyfills/base64';
import { installText } from './polyfills/text';
import { installUrl } from './polyfills/url';
import { installCrypto } from './polyfills/crypto';
import { installDollar } from './dollar';
import { pruneSurface } from './surface';

const host: HostGlobal = g;

// 编排顺序 = 原手写 shim 的段落顺序（契约文档：docs/plugin-interface.md §5.2）
captureHost(host); // raw 桥捕获进闭包 + global/module 初始化
installBase64(host);
installText(host);
installUrl(host);
capturePrefs(host); // __PREFS_STORE__ 捕获进闭包并立即从全局删除
installCrypto(host);
installDollar(host); // 含 selector 层装配（$.html / wrapDocument）
pruneSurface(host); // 白名单收敛插件可见全局面
