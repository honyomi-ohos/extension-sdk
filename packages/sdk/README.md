# @honyomi/plugin-sdk

编写一个 Honyomi 插件：一个目录、一份 `manifest.json`、一份 `main.ts`。

```json
{
  "key": "example",
  "name": "Example",
  "lang": "zh",
  "version": "1.0.0",
  "versionCode": 1,
  "baseUrl": "https://example.com"
}
```

```ts
import { createPrefs, defineExtension, workOf, workPage } from '@honyomi/plugin-sdk';
import type { SourceExtension } from '@honyomi/plugin-sdk';

const prefs = createPrefs();

const ext: SourceExtension = {
  getPopularWorks(page) {
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

`$`（`http` / `html` / `crypto` / `prefs`）是宿主运行插件时注入的全局对象，类型由本包声明，不用 import。

作者只安装 `@honyomi/plugin-tools`。本包、`@honyomi/plugin-test` 和运行时 shim 会一起装上。

```bash
npm install -D @honyomi/plugin-tools
npx honyomi-plugin build
npx honyomi-plugin test
npx honyomi-plugin lint
```

导入可以用 `@honyomi/plugin-sdk`，也可以用 `@honyomi/plugin-tools/sdk`。测试用 `@honyomi/plugin-test` 或 `@honyomi/plugin-tools/test`。仓库索引导入 `@honyomi/plugin-sdk/repo`，或 `@honyomi/plugin-tools/sdk/repo`。

测试把插件目录交给 `loadExtension`。独立插件的构建产物是目录下的 `dist/main.js`，测试会自动找到它。沙箱、断言和真站回放见 `@honyomi/plugin-test` 的 README。

## 插件方法

`SourceExtension` 的方法可以同步返回，也可以返回 Promise。

| 方法 | 返回 |
| --- | --- |
| `getPopularWorks(page)` | `WorkPage`，必填 |
| `getSearchWorks(page, query)` | `WorkPage`，必填 |
| `getLatestWorks(page)` | `WorkPage` |
| `getWorkDetail(workKey)` | `RawWork` |
| `getRelatedWorks(workKey)` | `RawWork[]` |
| `getChapterList(workKey)` | `RawChapter[]` |
| `getPageList(chapterKey)` | `RawPage[]` |
| `getChapterText(chapterKey)` | 章节正文 `string` |
| `getVideoList(chapterKey)` | `RawVideo[]` |
| `getFilterList()` | `RawFilter[]` |
| `applyFilterState(updates)` | 应用筛选。`updates` 为 JSON 字符串或 `RawFilter[]` |
| `resetFilters()` | 清空筛选 |
| `setPreference(key, value)` | 写入一条偏好 |
| `getHeaders()` | 图片等后续请求要附带的头 |
| `fetchImage(pageUrl, imageUrl)` | 代取或解密后的图片，base64 或 data URL |

`manifest.json` 里 `key` 是小写 UUID v4。常用字段还有 `name`、`lang`、`version`、`versionCode`、`baseUrl`、`nsfw`、`contentType`（`manga` / `novel` / `video`）、`contentTypes`、`settings`、`supportsLatest`、`bt`、`icon`、`dslVersion`、`minAppVersion`。`settings[].type` 为 `switch`、`select`、`edit` 或 `password`。

## 返回值

```ts
import { chapterOf, pageOf, videoOf, workOf, workPage } from '@honyomi/plugin-sdk';

workOf('/work/1', '标题', { coverUrl: 'https://example.com/a.jpg' });
workPage([/* RawWork */], false);
chapterOf('ch-1', '第一话', { chapterNumber: 1 });
pageOf(0, 'https://example.com/0.jpg', 'https://example.com/read/0');
videoOf('https://example.com/a.m3u8', '1080p', { Referer: 'https://example.com/' });
```

`genreOf` 把 `string` 或 `string[]` 收成一段文本，缺省为空串。作品上的 `genre` 字段本身仍可以是数组。

## 偏好与请求

`createPrefs()` 读写当前插件自己的偏好。`get` 缺省返回 `''`，`isTrue` 把 `'true'` 和 `'1'` 当成真，`num` 解析失败时返回缺省值。

`createHttp({ Referer: 'https://example.com/' })` 给 `$.http` 的每次调用合并同一组默认头，方法与 `$.http` 相同。`fetchHtml(url, headers?)` 等价于 `$.html($.http.get(url, headers), url)`。

URL：`trimSlash`、`hostOf`、`relToAbs(url, base)`、`joinUrl(base, path)`。文本：`decodeEntities`、`stripTags`、`parseDate`（解析失败返回 `0`）。

`defineExtension(ext)` 在宿主提供 `module` 时写入 `module.exports`，并返回 `ext`。

## `$`

类型由 `src/global.d.ts` 声明。插件工程把它列进 `tsconfig.json` 的 `include`，写法见 `@honyomi/plugin-tools` 的 README。

| 成员 | 作用 |
| --- | --- |
| `$.http.get(url, headers?)` | GET，返回响应体 |
| `$.http.post(url, body, headers?)` | POST，返回响应体 |
| `$.http.request(url, options?)` | 返回 `ok`、`status`、`statusText`、`headers`、`body`、`url` |
| `$.http.enqueue(url, options?)` | 发出请求，忽略结果 |
| `$.http.getBytes` / `getBytesResponse` | 字节体；后者保留状态码、头和最终 URL |
| `$.html(html, baseUrl?)` | `DocNode`：`select`、`selectFirst`、`text`、`ownText`、`attr`、`absUrl`、`html` |
| `$.dns.set(host, ips)` | 把域名钉到 1–8 个 IPv4 |
| `$.cookies.header(url)` / `get` / `set` | 读写宿主 CookieJar |
| `$.image.decode` / `encodePng` | RGBA 像素与 PNG 字节 |
| `$.crypto` | Base64、MD5、SHA、HMAC、PBKDF2、AES-CBC、AES-GCM |
| `$.prefs` | 偏好桥。作者代码用 `createPrefs()` |
| `$.urlEncodeGbk(text)` | GBK 百分号编码 |
| `fetchBytes(url, options?)` | 全局字节请求，返回带 `bytes` 的完整响应 |

文档节点上的 `select` 返回带 `first()`、`last()`、`isEmpty()` 的数组。

## 仓库索引

`honyomi-plugin publish` 用本子路径把仓库写成 `index.bin`。字段布局在 `proto/repo_index.proto`。

```ts
import { decodeRepoIndex, encodeRepoIndex, REPO_INDEX_FILENAME } from '@honyomi/plugin-sdk/repo';
```

`encodeRepoIndex` / `decodeRepoIndex` 处理 `RepoIndexStore`。`looksLikeRepoProto` 按首字节区分 protobuf 与旧的 JSON 索引（`{` 或 `[` 开头视为 JSON）。内容分级常量为 `REPO_CONTENT_WARNING_UNSPECIFIED`、`SAFE`、`MIXED`、`NSFW`。内容类型常量为 `REPO_CONTENT_TYPE_MANGA`、`NOVEL`、`VIDEO`。`REPO_INDEX_FILENAME` 是 `index.bin`。
