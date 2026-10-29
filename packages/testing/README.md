# @honyomi/plugin-test

在 Node `vm` 里加载与宿主相同的运行时 shim 和插件构建产物，回放 HTTP，并校验插件返回值。

作者从 `@honyomi/plugin-tools/test` 导入。本包随 `@honyomi/plugin-tools` 安装，也可以直接写 `@honyomi/plugin-test`。

```ts
import * as path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertWorkPage, createFixtureFetch, loadExtension } from '@honyomi/plugin-tools/test';

test('popular', async () => {
  const loaded = loadExtension({
    pluginDir: path.join(import.meta.dirname, '..'),
    prefs: { TOKEN: 'x' },
    fetchImpl: createFixtureFetch(path.join(import.meta.dirname, 'fixtures')),
  });
  const page = await loaded.ext.getPopularWorks(1);
  assertWorkPage(page, 2);
  assert.ok(loaded.calls[0].url.includes('/list?page=1'));
});
```

`honyomi-plugin test` 会先构建 shim 和插件，再跑这些用例。

## 加载

`loadExtension(options)` 返回已加载的插件。

| 字段 | 作用 |
| --- | --- |
| `pluginDir` | 含 `manifest.json` 的插件目录 |
| `prefs` | 种子偏好，写入该插件自己的扁平存储 |
| `fetchImpl` | 请求桩。缺省时，未提供桩的请求直接抛错 |
| `live` | 为真时用 `liveFetch()` 经系统 `curl` 访问真站 |
| `shimPath` | 覆盖 shim。缺省解析 `@honyomi/plugin-runtime/shim` |
| `mainJs` | 覆盖构建产物路径 |

产物路径由 `defaultMainJs` 决定：catalog 工程取工程根 `dist/<lang>/<id>/main.js`（`src/` 前缀会去掉）；独立插件取目录下 `dist/main.js`；没有 `main.ts` 时退回目录里的 `main.js`。

返回值 `LoadedPlugin`：

| 字段 | 作用 |
| --- | --- |
| `ext` | `SourceExtension` |
| `key` | manifest 里的插件 key |
| `prefs()` | 当前偏好快照，含插件运行中写入的值 |
| `calls` | `$.http` 调用记录，按发生顺序 |
| `dnsCalls` | `$.dns.set` 记录。沙箱只记录，不注册直连规则 |
| `hostCalls` | Cookie 与图像编解码等宿主调用记录 |

`FetchMock` 的形态是 `(url, options) => FetchResponse`。`options` 含 `method`、`headers`、`body`。响应至少给出 `body`；`status` 缺省按 200 处理，也可以带 `headers`、`url`、`bytes`。

`liveFetch()` 用 `curl` 发请求：共享 cookie 文件、跟随重定向，只允许 `http` / `https`。

## Fixture

`createFixtureFetch(fixturesDir)` 读取该目录的 `index.json`，把请求回放到本地文件。键是完整 URL，或以 `/` 包裹的正则。未命中的请求会抛错。

```json
{
  "https://example.com/list?page=1": { "file": "list.html" },
  "/^https:\\/\\/example\\.com\\/search\\?/": {
    "file": "search.html",
    "status": 200,
    "headers": { "content-type": "text/html" }
  }
}
```

`file` 必须落在 fixtures 目录内。`loadFixtureIndex(fixturesDir)` 只读取索引，不发请求。

## 断言

这些函数用 `node:assert` 检查宿主接受的推荐字段，失败即抛错，成功时返回传入的列表或对象。

| 函数 | 检查 |
| --- | --- |
| `assertWorkPage(page, min = 1)` | `works` 至少 `min` 条，每条有非空 `key`、`title`，且 `hasNextPage` 为 boolean |
| `assertDetail(work)` | 非空 `key`、`title` |
| `assertChapterList(chapters, min = 1)` | 每条有非空 `key`、`name` |
| `assertPageList(pages, min = 1)` | `index` 为 number，`imageUrl` 非空 |
| `assertVideoList(videos, min = 1)` | `url` 非空 |
| `assertFilterList(filters)` | 非空列表，每条有非空 `type`、`name` |
| `assertPrefs(prefs, expected)` | `expected` 里的每个键与快照相等 |

## E2E

真站全流程走 `popular → latest → detail → chapters → 页面 / 正文 / 视频 → search`。模式来自环境变量 `HONYOMI_E2E`，`honyomi-plugin e2e <mode>` 会设置它并只跑 `*.e2e.test.ts`。

| 值 | 行为 |
| --- | --- |
| 未设置、`off`、`0`、`false` | 用例跳过，不访问网络 |
| `replay`、`1`、`true` 或其他非空值 | 回放 `test/fixtures-e2e/` |
| `record` | 请求真站，并把响应写入 `test/fixtures-e2e/` |
| `live` | 请求真站，不录制 |

`latest` 默认是软步骤：失败只记在报告里，不让整次失败。录制文件与单测 fixture 共用 `index.json` 格式，目录固定为插件下的 `test/fixtures-e2e/`，和单测的 `test/fixtures/` 分开。`record` 只保存状态码和 `content-type`。

插件里通常只注册这一行：

```ts
import * as path from 'node:path';
import { defineSourceE2eSuite } from '@honyomi/plugin-tools/test';

defineSourceE2eSuite({ pluginDir: path.join(import.meta.dirname, '..') });
```

`HONYOMI_E2E` 关闭时该用例跳过。`replay` 下如果还没有 `index.json`，也会跳过，并提示先录制。

需要自己编排时用这些函数：

| 函数 | 作用 |
| --- | --- |
| `e2eMode()` | 读取 `HONYOMI_E2E` |
| `e2eTest(name, fn)` | 模式为 `off` 时跳过的 `node:test` |
| `createE2EFetch({ mode, fixturesDir })` | 按模式装配回放、录制或真站 fetch |
| `createRecordingFetch({ fixturesDir })` | 只做录制 |
| `runSourceE2E(options)` | 跑完全流程并返回 `E2eReport`，步骤失败不抛错 |
| `assertE2eReport(report)` | 报告里有硬失败时抛错 |

`runSourceE2E` 可读 `searchQuery`、`skipSearch`、`contentType`、`softSteps`，以及 `minWorks`、`minChapters`、`minPages`、`minVideos`、`minTextLength`、`minSearchResults`。
