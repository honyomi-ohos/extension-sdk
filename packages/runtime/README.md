# @honyomi/plugin-runtime

Honyomi 插件的 JSVM 运行时 shim。它补上引擎里没有的 Web API，装上 `$`，再把插件看不见的全局收掉。产物是一份 IIFE，拼在每个插件的 `main.js` 前面。

插件作者通过 `@honyomi/plugin-tools` 用到本包。测试加载已经打好的 shim；宿主在编译资源前把同一次构建写进应用 rawfile。`$` 和插件可见全局的类型在 `@honyomi/plugin-sdk`。

## 构建

在本包目录执行：

```bash
node build.mjs
node build.mjs --rawfile <outfile>
```

第一条写入 `dist/plugin_runtime_jsvm.js`。第二条把同一次构建再写入 `<outfile>`，供宿主放进 rawfile。`src/` 或 `package.json` 没有更新时，按 `dist/*.stamp` 跳过。

`honyomi-plugin test` 会先执行第一条，保证沙箱加载的 shim 与源码一致。

esbuild 以 `src/index.ts` 为入口，目标 `es2020`，格式 IIFE，并压缩。安装顺序是：捕获宿主桥、Base64、文本、URL、捕获偏好、加密、`$`、收敛可见全局。

## 导出

| 路径 | 内容 |
| --- | --- |
| `@honyomi/plugin-runtime` | 打包入口。被 import 时会在当前全局安装 polyfill 和 `$` |
| `@honyomi/plugin-runtime/shim` | `dist/plugin_runtime_jsvm.js`。Node 测试加载这一份 |
| `@honyomi/plugin-runtime/build` | `build.mjs` |

沙箱和宿主加载 `shim` 那份产物。包入口只给 esbuild 打包：被 import 时会在当前进程安装 polyfill 和 `$`。

## 插件可见面

shim 执行完之后，插件能使用标准 JS 内建，以及：

| 名称 | 作用 |
| --- | --- |
| `btoa` / `atob` | Base64 |
| `TextEncoder` / `TextDecoder` | UTF-8 文本 |
| `URL` / `URLSearchParams` | URL 解析与查询串 |
| `crypto` | `getRandomValues` 与 `subtle` 的摘要、HMAC、PBKDF2、AES-GCM |
| `$` | `http`、`html`、`dns`、`cookies`、`image`、`crypto`、`prefs`、`urlEncodeGbk` |
| `fetchBytes` | 带状态码和响应头的字节请求 |
| `console` | 宿主提供的调试日志 |
| `module` / `exports` | `defineExtension` 写入 `module.exports` 用 |

裸 `fetch`、宿主原生桥，以及 `__PREFS_STORE__` 一类原始偏好全局，会在收敛时从插件可见面上删掉。HTTP 走 `$.http` 或 `fetchBytes`，偏好走 `createPrefs()`（后端是 `$.prefs`）。

本包依赖 `@noble/hashes`、`@noble/ciphers`、`aes-js`、`js-md5`、`whatwg-url`、`fast-text-encoding`，全部打进 shim，插件工程不用再安装。
