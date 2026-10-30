# @honyomi/plugin-tools

安装这一个包，就可以编写、构建、测试、检查 Honyomi 插件，并带上 SDK 和调试 skill。

```bash
npm install -D @honyomi/plugin-tools
```

`@honyomi/plugin-sdk`、`@honyomi/plugin-test`、`@honyomi/plugin-runtime` 是本包的依赖，不需要再单独安装。

## 导入

```ts
import { createPrefs, defineExtension, workOf, workPage } from '@honyomi/plugin-tools/sdk';
import type { SourceExtension } from '@honyomi/plugin-tools/sdk';
```

测试：

```ts
import { createFixtureFetch, loadExtension, assertWorkPage } from '@honyomi/plugin-tools/test';
```

也可以继续写 `@honyomi/plugin-sdk` 和 `@honyomi/plugin-test`。安装 tools 时这两个包会一起装上。

`$`（http / html / crypto / prefs）是宿主注入的全局对象。`tsconfig.json` 的 `include` 不会收进 `node_modules` 里的声明，所以在插件工程放一个引用文件：

```ts
/// <reference path="./node_modules/@honyomi/plugin-sdk/src/global.d.ts" />
```

把这个文件列进 `include`。

## 命令

在 catalog 工程（`package.json` 的 `name` 为 `honyomi-catalog`）或独立插件目录（`manifest.json` + `main.ts`）执行：

| 命令 | 作用 |
| --- | --- |
| `honyomi-plugin build [插件...]` | 编译插件。catalog 无参数时构建全部 |
| `honyomi-plugin test [插件\|glob...]` | 构建运行时 shim 和插件，再跑 `node:test` |
| `honyomi-plugin e2e [replay\|record\|live] [插件\|glob...]` | 设置 `HONYOMI_E2E` 后跑 `*.e2e.test.ts` |
| `honyomi-plugin lint [--fix] [插件...]` | manifest、产物是否陈旧、oxlint，以及 `tsc`。`--fix` 应用 oxlint 的安全自动修复 |
| `honyomi-plugin typecheck [插件...]` | 只运行 `tsc` |
| `honyomi-plugin check [插件...]` | 只做 manifest 和产物陈旧检测 |
| `honyomi-plugin publish [--release <url>]` | 构建并写出整个仓库的 `dist/repo/`（`.honyomiplug`、图标、`index.bin`）。不接受插件路径。`--release` 把这三类文件都写成 GitHub Release 附件地址 |
| `honyomi-plugin serve [dir] [--host <地址>]` | 静态托管整个仓库索引。在插件目录里执行也托管 `dist/repo` |
| `honyomi-plugin init <dir>` | 初始化 catalog 工程，示例插件在 `src/<lang>/example/` |
| `honyomi-plugin skill path` | 打印随包分发的调试 skill 目录 |
| `honyomi-plugin skill install` | 复制 skill 到 `.cursor/skills` 与 `.deveco/skills` |

`build`、`test`、`e2e`、`lint`、`typecheck`、`check` 都可以只针对一个插件。在 catalog 根目录写上路径，例如 `src/zh/example` 或 `zh/example`；语言目录 `src/zh` 会带上该语言下的全部插件。已经在插件目录里时，不写路径也只处理当前插件。`publish` 始终发布整个仓库。`serve` 始终托管整个 `dist/repo`。

`lint` 会把 manifest、oxlint 和 `tsc` 都跑完，前面的失败不会跳过后面的检查。oxlint 报告未使用变量等代码问题，并禁止插件文件使用沙箱里没有的全局（`fetch`、`window`、`document`、`process` 等）或 `import` Node 内建模块。`test/` 里可以 `import node:`。

TypeScript 由包内的 esbuild loader 直接运行，插件源码可以使用 enum 等语法。

## 初始化

生成一份 catalog 工程。语言目录放在 `src/` 里，`dist` 留在工程根，不和 `lang` 并列：

```text
my-sources/
  .gitignore
  globals.d.ts
  package.json          # name 为 honyomi-catalog
  tsconfig.json
  src/
    zh/
      example/
        manifest.json
        main.ts
        test/
  dist/                 # 构建后出现，dist/zh/example/main.js
```

```bash
npx honyomi-plugin init my-sources --name "My Sources" --lang zh
cd my-sources
npm install
npm test
```

`--lang` 是 `src/` 下的目录名，缺省 `zh`。同一语言继续加插件，复制 `src/zh/example/` 改名即可。官方 catalog 的源码直接在 `<lang>/<id>/`，不套 `src/`。

## 独立插件

目录里放 `manifest.json` 和 `main.ts`：

```ts
import { createPrefs, defineExtension, workPage, workOf } from '@honyomi/plugin-tools/sdk';
import type { SourceExtension } from '@honyomi/plugin-tools/sdk';

const prefs = createPrefs();

const ext: SourceExtension = {
  getPopularWorks(page: number) {
    const body = $.http.get('https://example.com/list?page=' + page);
    const doc = $.html(body, 'https://example.com/');
    return workPage(doc.select('.item').map((el) => workOf(
      el.selectFirst('a')?.attr('href') ?? '',
      el.selectFirst('.title')?.text() ?? '',
    )), false);
  },
  getSearchWorks() {
    return workPage([], false);
  },
};

defineExtension(ext);
```

```bash
npx honyomi-plugin build   # dist/main.js
npx honyomi-plugin test
npx honyomi-plugin lint
npx honyomi-plugin check
```

同目录下的相对 `.ts` 导入会打进同一个 `main.js`。

## 测试

```ts
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { createFixtureFetch, loadExtension, assertWorkPage } from '@honyomi/plugin-tools/test';

const loaded = loadExtension({
  pluginDir: path.join(import.meta.dirname, '..'),
  prefs: { TOKEN: 'x' },
  fetchImpl: createFixtureFetch(path.join(import.meta.dirname, 'fixtures')),
});
const page = await loaded.ext.getPopularWorks(1);
assertWorkPage(page, 2);
assert.ok(loaded.calls[0].url.includes('/list?page=1'));
```

`loadExtension` 在 Node `vm` 里加载与宿主相同的运行时 shim（`@honyomi/plugin-runtime/shim`）和构建产物。断言、fixture 和 `defineSourceE2eSuite` 见 `@honyomi/plugin-test` 的 README。

`honyomi-plugin e2e` 的缺省模式是 `replay`。它只收集 `*.e2e.test.ts`。传入插件相对路径（如 `src/zh/example`）时，会展开成该目录下的 `test/*.e2e.test.ts`，并且只构建这些插件。`honyomi-plugin test` 对同一个路径展开成 `test/*.test.ts`。`record` 与 `live` 会访问真站。

`honyomi-plugin serve` 缺省托管 `dist/repo`，监听 `0.0.0.0:8765`。`--host` 只接受 `127.0.0.1`、`localhost` 或 `0.0.0.0`。请求 `/` 时返回 `index.bin`。

## 发布到 GitHub Release

GitHub Release 的附件没有目录。加上 `--release` 后，`index.bin` 里的插件包和图标改成该 Release 的下载地址，文件名是附件名（`packs/`、`icons/` 只留在本地目录里）。应用里的仓库地址用同一个前缀下的 `index.bin`，索引、插件包、图标都从这次 Release 拉取。

```bash
npx honyomi-plugin publish --release https://github.com/owner/repo/releases/download/v1.0.0
```

也接受 `https://github.com/owner/repo/releases/latest/download`，以及末尾多写的 `/` 或 `/index.bin`。仓库地址是：

```text
https://github.com/owner/repo/releases/download/v1.0.0/index.bin
```

把 `dist/repo/index.bin`、`dist/repo/packs/*.honyomiplug`、`dist/repo/icons/*.png` 作为附件上传。GitHub 用文件名当附件名，不要带上 `packs/` 或 `icons/`。

## Skill

调试步骤在 `skills/honyomi-plugin-debug/SKILL.md`。项目配置可以把 skill 路径指到已安装的包：

```json
"skills": { "paths": ["node_modules/@honyomi/plugin-tools/skills"] }
```

或执行 `honyomi-plugin skill install` 复制到项目里。
