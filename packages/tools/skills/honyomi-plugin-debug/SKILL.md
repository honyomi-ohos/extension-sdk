---
name: honyomi-plugin-debug
description: 调试 plugins/catalog 下的内容源插件（任意 Mihon/Honyomi 式插件）。当插件报错、容器/选择器解析失败、站点结构变化、入口域名失效或轮换、站点防护/反爬挑战（WAF、PoW、指纹）、FetchMock 测试失败、需要 live e2e 真站验证、编写或修改 main.ts / test / manifest.json 时使用。关键词：plugin-sdk、$.http、$.html、loadExtension、FetchMock、npm test。
---

# Honyomi/Mihon 插件调试通用方案

## 1. 架构与能力边界

```
catalog/<lang>/<id>/ main.ts（插件主体）、manifest.json、test/<id>.test.ts
工具链在 npm 包 @honyomi/plugin-tools（只安装这一个包）：
  sdk/      @honyomi/plugin-sdk，也可从 @honyomi/plugin-tools/sdk 导入
  runtime/  JSVM 沙箱 shim（plugin_runtime_jsvm.js 逐字加载）+ $ DSL
  testing/  loadExtension 沙箱（真实 shim + linkedom 桥）+ 断言助手 + liveFetch
```

插件运行在 JSVM 沙箱，**能力边界**（TS 编写，无 DOM/fetch/Node API）：

- `$.http.get/post/request/getBytes`；`request` 返回 `{ok,status,statusText,headers,body,url}`
- `$.html(html, baseUrl)` → DocNode（select/selectFirst/text/attr/ownText）
- `$.crypto.sha256`（hex）；`$.prefs.get/set`；`URL` 为全局
- 导出 `const ext: SourceExtension = {...}` 并 `defineExt(ext)`

宿主 HTTP 桥（NativeHttpBridge.ets）契约，调试时必须知道：

- **CookieJar 全局共享**：每请求自动附带已存 cookie，每跳响应 Set-Cookie 自动入库
  → 插件原则上不手工管理 cookie；过防护挑战后后续请求（含封面/图片）自动带上
- 手动跟随重定向 ≤8 跳；非标准状态码（4xx 防护码）带 body 透传；网络错误 status=0

测试面（node:test，在 catalog 目录）：

- `loadExtension({ pluginDir, prefs, fetchImpl, live })`：真实 shim 沙箱加载构建产物
- FetchMock：`router(exact(url, resp), includes(sub, resp), ...)` 顺序匹配
- 断言助手：`assertWorkPage / assertPageList / assertChapterList`
- `live: true`：liveFetch——curl 真站请求，共享 cookie jar（`-b/-c`）+ 跟随重定向（`-L`），
  多跳响应取最后一段，行为对齐宿主 CookieJar

## 2. 命令速查

```bash
# catalog 目录：构建运行时 + 插件，再跑测试
npm test
# 或：npx honyomi-plugin test
# catalog 目录：manifest、构建产物、oxlint、tsc
npx honyomi-plugin lint
# 改完 main.ts 后必须重新构建，否则测试加载的是旧的 dist
npx honyomi-plugin build
```

## 3. 通用调试流程（七步）

1. **定位**：`npm test` 找失败用例；区分是"逻辑错误"还是"fixture 与现实漂移"
2. **取证**：写临时 node 脚本抓线上真实响应（原生 fetch + 手动 cookie jar），
   存 HTML/JSON 样本。**观察现状，不要凭记忆假设站点行为**
3. **验证假设**：用 linkedom 解析样本逐项验证选择器、URL 形式、参数语义
   （`const { document } = parseHTML(html)`，注意是 `document.querySelector` 不是 `doc.getElementById`）
4. **修复**：main.ts 修复 + 同步 test fixture，fixture 结构以真实样本为准
5. **回归**：`npm test` 全绿
6. **live 验证**：live e2e 真站全链路（发现→列表→搜索→详情→分页图片），模板见 §5
7. **收尾**：manifest bump `version`/`versionCode`；改了 ets 则 `devecocli build`

## 4. 通用模式库

调试中遇到的问题大多落入以下六类，每类给出通用解法。

### 4.1 站点防护 / 反爬挑战

**识别**：响应为非标准状态码（4xx 自定义码）或返回含 JS 挑战/配置块的 HTML。

**通用解法**：

1. 抓挑战页全文，找配置块（`<script>` 内 JSON / JS 变量）——防护方案几乎都把
   seed/难度/验证路径/字段名写死在页面里
2. 按配置实现验证：PoW（hash 前缀匹配，注意手工补零 nonce，别依赖 padStart）、
   指纹上报（POST JSON）、verify 表单（字段全量来自配置块）
3. **UA 全链统一硬编码**（指纹上报与请求头一致），避免宿主 UA 变化导致指纹不匹配
4. Cookie 完全依赖宿主 CookieJar；挑战循环设上限（换镜像 ×3 × 挑战轮 ×6）
5. live 模式靠 liveFetch 的 curl cookie jar 模拟同样行为

**实例：gatekeeper PoW（baozi 的 bzmgcn.com 域，2026-10 实战）**

完整流程（通用可复刻）：

1. 业务请求 → `403` + JSON `{"challenge_url":"...","error":"challenge_required"}`
2. GET `challenge_url`（相对当前最终域 origin 拼接）→ 200 HTML，
   内联脚本 `g.start({challengeId,ticket,verifyUrl,workerUrl,difficultyBits,...})`
   （**key 无引号**，正则逐字段提取，不要 JSON.parse 整体）
3. PoW：`$.crypto.sha256("gatekeeper-pow-v1:"+challengeId+":"+nonce)`，nonce 从 0 递增十进制串，
   要求 hash **前导零 bit 数 ≥ difficultyBits**——是 bit 不是 hex 字符
   （`parseInt(hex.slice(0,4),16)===0` 仅当 bits 为 4 的倍数时成立；通用写法逐 hex 字符折算 bit）
4. POST `verifyUrl`，body `{"challenge_id":...,"ticket":...,"nonce":...}`，
   Content-Type application/json；响应 `"passed"` 后 CookieJar 自动收 clearance cookie
5. 重试原请求（≤2 轮）；PoW 迭代上限 1<<22 兜底

踩坑记录：

- **binding_mismatch**：ticket 绑定 cookie。取证脚本若用"扁平 cookie jar"（不分域），
  首域 302 种下的同名 `__Host-gk_browser_*` 会污染次域挑战，verify 必挂。
  排查时每个 host 独立 jar；宿主 CookieJar 天然分域，无此问题
- 难度 16bit 平均 ~65536 次哈希，JSVM 内秒级可解；取证脚本误写成 24bit 时 80s 才出解
  ——发现 PoW 慢得离谱先查位数换算

### 4.2 入口失效 / 域名轮换

**识别**：入口域 302 到陌生域、原选择器在新页面全部失效、`#容器缺失` 类报错。

**通用解法**（发现流水线）：

1. 请求入口 → 观察跳转目标；跳转页常是 JS 挑战页，内含**候选域名池**
   （自定义编码：base-N + 字符替换 + 反转序列等，逆向后写解码器）
2. 候选逐个**探活**：判活条件 = 防护特征状态码 / 200 且含站点特征串；
   **停放页（200 无特征）必须排除**；探活数量设上限，随机顺序遍历
3. 真实站点常在候选域的**子域**上（先去 `www.` 前缀再拼子域）
4. 结果落 `$.prefs` 缓存；使用前先探活校验，失败强制重发现；保留兜底域名
5. 解码器写**互逆编码器**造 fixture 测试（编码器在测试、解码器在插件，互逆验证）

### 4.3 URL / 资源规范化

- **从 HTML 属性提取的 URL 必须先实体解码**：`.replace(/&amp;/g, '&')` 再 `new URL()`，
  否则查询参数名错位（`amp;t`）
- 协议相对 `//x` 补 `https:`；相对路径用 origin 拼；http 统一升级 https
- **图片 CDN 域被拦**（403 与 Referer/cookie 无关）时：镜像/同源域常代理相同路径，
  用正则把死域 URL 重写到 `origin()` + 原路径
- 语言/分页前缀统一在 buildUrl 一处处理，key 存**去前缀路径**，出口再补全

### 4.4 选择器漂移 / 参考实现过时

**原则：以站点自身 UI 的链接和结构为权威，外部参考实现（keiyoushi 等移植源）只是历史快照。**

- 语义漂移检测用**三向对比法**：`?param=A` vs `?param=B` vs 无参——内容各不同才说明参数在过滤；
  再与站点 UI 自己用的形式（路径 vs 查询参数）对比，不同则以站点 UI 为准
- 列表页侧栏分类的旧容器（如 `#w3`）可能已迁移（如 `#w1`），以实抓样本为准
- 空标题/空锚点是部分站点的真实行为 → 用 slug 兜底，不要当 bug 修

### 4.5 会话与请求头

- `getHeaders()` 返回图片加载所需 Referer/UA（防护校验用）
- 指纹/防护会话绑定 UA，改 UA 等于换会话——一切 UA 变更都要全链同步
- 请求显式带 UA，不依赖宿主默认值

### 4.6 测试工程原则

- prefs 预置缓存域名时，插件会先发**探活请求**（calls[0]），每个用例的 mock 必须含探活响应
- `exact()` 匹配探活 URL、`includes()` 匹配页面 URL，避免子串误匹配
- fixture 挑战页要**逐字段还原真实结构**（HTML 转义、字段名、cookie 名）
- 契约变更（如 DollarDsl 加字段）后，**所有 $ 桩测试同步补字段**，否则 tsc 挂

### 4.7 DNS 污染识别与验证（不影响插件代码）

**识别**：域名解析到可疑 IP（如 Facebook 段 69.63.x）但 NS 是 Cloudflare；443/80 均超时或 RST。
**确认**：用域名型 DoH（`https://cloudflare-dns.com/dns-query?name=X&type=A` + accept dns-json）
拿真实 IP（直连 IP 型 DoH 如 1.1.1.1/dns.google 可能被禁，域名型可走代理），
`curl --resolve host:443:真实IP` 能通 → 纯本地污染，站点正常。
**结论导向**：宿主 App 有内建 DoH（entry `net/Doh.ets`，设置页选供应商即对全部请求生效），
插件代码无需改动；live 验证时用 fetchImpl 包装 `curl --resolve` 代替 liveFetch 即可全链路 e2e。
上游 keiyoushi 的 git tree API（`/repos/keiyoushi/extensions-source/git/trees/main?recursive=1`）
可全量检索 `src/<lang>/<id>/`，用于核对 baseUrl 是否变更（baseUrl 在 build.gradle.kts 的
`keiyoushi { source { baseUrl = ... } }`，不在 .kt 里）。

### 4.8 地理屏蔽识别（非插件问题）

国内站（dmzj 等）常屏蔽海外出口 IP：80 口 `302 Location: https://webblock.volcengine.com`
（响应头 `Server: Suzaku` = 火山引擎 CDN），443 直接 TLS RST。此为站点侧屏蔽，
换网络（国内设备）即可用，插件代码无需改动；海外沙箱环境无法 live 验证，
只能依赖单测 + fixture 回归。

### 4.9 JS 网关域与镜像自动发现（4khd 模式）

站点把主域改造成 JS 网关（根页 `const sites = ['https://镜像A','https://镜像B']`，
REST API 302 到跳转页），镜像域名随机轮换、随时会换。修复模式（fourkhd）：

1. 请求 BASE 失败判据不是 status——跟随重定向后 200 但 body 是网关 HTML；
   用"body 首字符是否 `[`/`{`"判定 JSON 失效（`looksJson`）
2. 发现流程：GET BASE 根页 → 正则 `/'(https:\/\/[^']+)'/g` 提取候选 →
   逐个探测轻量 API（`page=1&per_page=1`）→ 首个 200 JSON 作镜像缓存（模块级变量）
3. 镜像中途失效：清空缓存重新发现一次，重试原请求一次；全失败优雅返回空列表
4. 踩坑：测试沙箱 `loadExtension` 加载的是 `catalog/dist/<key>/main.js` 构建产物——
   改完 main.ts 必须 `npx honyomi-plugin build` 重新构建，
   否则测试跑的是旧代码（症状：新逻辑相关断言全挂、请求序列不符）
5. 站方图片短链域（img.4khd.com/img.uuss.uk）与主域一起网关化时，图片保留
   原始 Jetpack CDN URL（i*.wp.com）——站点自身页面引用它，实测可用

### 4.10 MangaDex API 变更（2026-10 实测）

1. **URL 方括号**：`order[x]=`、`includes[]`、`contentRating[]` 裸 `[` `]` 会被
   curl（curl error 3 bad range）与部分 HTTP 客户端拒绝。统一 `%5B`/`%5D` 编码
   （API 等价接受），在单一 `apiGet` 出口做 `url.replace(/\[/g,'%5B')`
2. **feed 接口 `includeExternalUrl=0` 已失效**：现在会把 total 直接清零
   （疑似 API 语义变更）。移除该参数；externalUrl 章节由客户端
   `attributes.externalUrl` 判空过滤（toChapter 返回 null）
3. 部分热门作品（Solo Leveling、One Piece）因官方授权 MD 只剩 external 章节，
   章节 0 是正常现象；验证用 Chainsaw Man（98 话本地托管）
4. feed 里偶有 at-home 404 的僵尸章节（One Piece 1191），属 MD 数据异常，
   非插件问题

### 4.11 站点死亡 / 改版判定（simplycosplay / xfdm 模式）

1. **关站**：API/主域 DoH `Status:3`（NXDOMAIN，.com 注册局 SOA 兜底）+
   其余子域 CF 502（源站下线）→ 站点已关（simplycosplay）。代码+单测通过
   即保留，待官方回归
2. **改版迁移**：旧域 301 到新门户（Astro catch-all：任意路径返回同一首页壳
   18467 字节）→ 旧模板结构（/search.html、player_aaaa 等）已不存在（xfdm）。
   新站若本网络不可达（443 IP 段 RST + 80 被反诈中心劫持页），无法抓样本
   重写，插件标记失效待用户决定去留
3. **判别要点**：curl -w `%{url_effective}` 看 301 链；对 catch-all 站点用
   两个不相关路径对比响应长度即可确认"全路径同壳"
4. **CF managed challenge 全域质询**：整域 403 "Just a moment..." +
   `challenge-platform` 脚本 = 浏览器/WebView 可过（wenku8 模式），与
   §4.1 的硬屏蔽（"Sorry, you have been blocked"）区分；判站点存活的旁证：
   静态资源 CDN / app API 子域是否直连 200

### 4.12 GFW 环境 DoH 供应商矩阵与污染判别（2026-10 模拟器实测）

**背景**：模拟器 QEMU NAT 纯 IPv4，宿主可用的 IPv6 绕行路径在模拟器内不存在；
app 内建 DoH（`net/Doh.ets`）是唯一干净解析通道。实测结论：

1. **DoH 供应商分级**（模拟器内，TLS 连通 + 答案干净度）：
  - cloudflare-dns.com：TLS 直连即被 RST（TCP 连上、ClientHello 后断）——死
  - quad9/adguard/quad101/mullvad/njalla：443 黑洞（连接超时）——死
  - controld：TLS OK 但查询返回解析失败——不可用
  - dns.alidns.com（223.5.5.5/223.6.6.6）：TLS OK 但答案被污染——不可用
  - **doh.pub（DNSPod，120.53.53.53/1.12.12.12）：唯一可用**，但 wire 与
    JSON 后端不同：`POST /dns-query`（RFC 8484 wire）答案污染率 4/4，
    `GET /dns-query?name=X&type=A` + `accept: application/dns-json` 干净 9/9
    （同宿主同时刻对比）。AliDNS 的 JSON 接口同样污染，勿对称类推
2. **GFW 注入是竞态而非确定性**：同一 provider 同一域名，11:16 返回假 IP
   （31.13.73.169）、11:21 返回干净 IP——上游递归被间歇注入，缓存过期后重试
   即可能拿到干净答案。失败后重试一次是标准动作（CosplayTele 复活实例）
3. **假 IP 特征**：Facebook/Twitter 段（31.13.x、69.63.x、199.59.x、104.31.x
   是 CF 不是假）+ 各种单 IP 黑洞（98.159.x、115.126.x、185.163.0.1 等）。
   静态黑名单不可穷举，**TCP 探测才是正解**：对候选 IP 发 443 SYN，
   真实 CF 秒连、假 IP 黑洞/RST。app 的 Doh.ets 已内置（PROBE 900ms）
4. **SNI 阻断 vs DNS 污染判别法**：`curl --resolve host:443:干净IP -I https://host`
   （或 openssl s_client -servername）——DNS 已干净仍 000/RST = SNI 阻断，
   app 侧无解（需代理）；能通 = 纯 DNS 污染，DoH + 探测注入即可修复
5. **实测修复矩阵**（用户报告失效 8 源，模拟器 VM 全链路验证）：
  - 修复：Buon Dua（DoH JSON 干净+注入）、哔咔（pin 保护）、4KHD、
    CosplayTele（站点迁 CF 后 + 竞态重试）
  - 环境性：Femjoy Hunter（www 子域确定性污染 5/5）、EveriaClub（污染+
    真实 IP 死）、Elite Babes / 3600000（SNI 阻断，DNS 干净仍 000）
6. **验证铁证**（hilog）：`NETSTACK add custom dns rule: [host, 443, IP]`
   = 干净 IP 注入成功；`Doh: answer for X rejected (poisoned/unreachable):
   IP via provider` = 假答案被探测拒绝；`provider X unreachable, backoff 60s`
   = DoH 供应商本身不可达（退避中）
7. **宿主 vs 模拟器差异**：宿主有 IPv6 时 cloudflare-dns/站点可走 v6 绕过
   v4 SNI-RST，得出"宿主干净、模拟器必死"的假象；排查时先确认测试路径
   的协议族，勿用宿主结论推断模拟器内行为

## 5. live e2e 脚本模板

```js
// catalog/live-e2e.mjs（临时脚本，跑完删除）
import * as path from 'node:path';
import * as url from 'node:url';
import { loadExtension } from '@honyomi/plugin-test';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const p = loadExtension({ pluginDir: path.join(here, '<id>'), live: true, prefs: {} });

const page = await p.ext.getLatestWorks(1);
console.log('works:', page.works.length, 'cachedHost:', p.prefs().<hostKey>);
const sp = await p.ext.getSearchWorks(1, '<词>');
console.log('search:', sp.works.length);
const d = await p.ext.getWorkDetail(page.works[0].key);
const pages = await p.ext.getPageList(page.works[0].key);
console.log('pages:', pages.length, 'p0:', pages[0]?.imageUrl);
```

## 6. 错误分类 → 排查路径

| 症状类别                 | 排查路径                                                                                                                                                                                                 |
|----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `#容器缺失` 类解析失败        | 站点结构漂移（重抓样本验证选择器）或镜像失效/防护未过（§4.1/4.2）                                                                                                                                                                |
| 收尾报 `status=-1` 类    | 全部请求异常/挑战循环耗尽 → 探活判定过严或 cookie 未回传                                                                                                                                                                   |
| 单测过、live 挂           | fixture 与线上结构漂移 → 重抓样本对比；或 liveFetch 行为与宿主不一致                                                                                                                                                        |
| live 卡防护挑战循环         | live 模式无 cookie jar（确认 liveFetch 版本含 curl -b/-c + -L）                                                                                                                                                |
| 字段取到空/默认值            | 提取的 URL 未实体解码，或配置块字段名/结构变化                                                                                                                                                                           |
| typecheck 挂在测试桩      | 契约（DollarDsl 等）变更后 $ 桩未同步                                                                                                                                                                            |
| TLS 握手被 RST（curl 35） | 先分辨"站点死"还是"网络阻"：同 IP 换任意 SNI——收到 TLS alert（SEC_E_ILLEGAL_MESSAGE）说明路径通，是该 SNI 被中间盒阻断；80 口 301 由 CF 边缘产生不证明源站活着。旁证：拉 keiyoushi/extensions-source 的 git trees API（`?recursive=1`，非截断）搜索插件目录，上游已删除≈站点停运 |

## 安装方式

本 skill 随 `@honyomi/plugin-tools` 发布，路径是
`node_modules/@honyomi/plugin-tools/skills/honyomi-plugin-debug/SKILL.md`。
源码在 extension-sdk 的 `packages/tools/skills/honyomi-plugin-debug/`。

```bash
npx honyomi-plugin skill path
npx honyomi-plugin skill install
```

`skill install` 复制到项目的 `.cursor/skills/honyomi-plugin-debug/` 和
`.deveco/skills/honyomi-plugin-debug/`。也可以不复制，在 DevEco / Cursor 里把
skill 搜索路径指到包目录：

```json
"skills": { "paths": ["node_modules/@honyomi/plugin-tools/skills"] }
```

全局安装仍可复制到 `~/.config/deveco/skills/`、`~/.claude/skills/` 或 `~/.agents/skills/`。
配置不热加载，改完需重启对应工具。详见同目录 README.md。
