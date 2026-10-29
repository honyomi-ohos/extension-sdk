// 插件契约类型。真源为宿主侧解析代码（JsvmSource.ets / PluginService.ets）：
// 宿主对插件返回值做宽松归一（key/url、coverUrl/thumbnailUrl 等双命名均接受），
// SDK 采用推荐命名；宽字段（如 genre 兼容数组）保持与宿主一致。

// ---- 文档节点（$.html 解析结果，方法契约见宿主 shim wrapNode） ----

export interface DocNode {
  attr(name: string): string;

  text(): string;

  ownText(): string;

  html(): string;

  outerHtml(): string;

  tag(): string;

  location(): string;

  absUrl(name: string): string;

  select(css: string): NodeListLike;

  selectFirst(css: string): DocNode | null;
}

export interface NodeListLike extends Array<DocNode> {
  first(): DocNode | null;

  last(): DocNode | null;

  isEmpty(): boolean;
}

// ---- HTTP（$.http 桥） ----

export interface HttpResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  url: string;
}

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchBytesResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  url: string;
  bytes: Uint8Array;
}

/** 字节请求扩展项：默认 GET / 空 body；POST x-www-form-urlencoded 等场景用 */
export interface BytesRequestOptions {
  method?: string;
  body?: string;
}

export interface HttpBridge {
  get(url: string, headers?: Record<string, string>): string;

  post(url: string, body: string, headers?: Record<string, string>): string;

  request(url: string, options?: HttpRequestOptions): HttpResult;

  enqueue(url: string, options?: HttpRequestOptions): void;

  getBytes(url: string, headers?: Record<string, string>, options?: BytesRequestOptions): Uint8Array;

  /** 同 getBytes，但保留完整响应信封（状态码/头/最终 URL），供插件按 status 分支处理 */
  getBytesResponse(url: string, headers?: Record<string, string>,
    options?: BytesRequestOptions): FetchBytesResult;
}

export interface CryptoBridge {
  base64Encode(s: string): string;

  base64Decode(s: string): string;

  aesCbcDecrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array;

  md5(s: string | Uint8Array): string;

  md5Bytes(bytes: Uint8Array): Uint8Array;

  // ---- @noble 补全：SHA / HMAC / PBKDF2 / AES-GCM 同步助手 ----
  /** 摘要原始字节（'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'） */
  digest(algo: string, data: string | Uint8Array | ArrayBuffer): Uint8Array;

  sha1(data: string | Uint8Array | ArrayBuffer): string;

  sha256(data: string | Uint8Array | ArrayBuffer): string;

  sha384(data: string | Uint8Array | ArrayBuffer): string;

  sha512(data: string | Uint8Array | ArrayBuffer): string;

  /** HMAC 十六进制（algo 同 digest；Bytes 变体返回原始字节） */
  hmac(algo: string, key: string | Uint8Array | ArrayBuffer,
    data: string | Uint8Array | ArrayBuffer): string;

  hmacBytes(algo: string, key: string | Uint8Array | ArrayBuffer,
    data: string | Uint8Array | ArrayBuffer): Uint8Array;

  /** PBKDF2-HMAC-SHA-256 派生密钥（dkLen 为字节数，1..1024；iterations 1..2000000） */
  pbkdf2(password: string | Uint8Array | ArrayBuffer, salt: string | Uint8Array | ArrayBuffer,
    iterations: number, dkLen: number): Uint8Array;

  /** AES-GCM 解密（data 须含 16 字节 tag；认证失败抛错） */
  aesGcmDecrypt(data: Uint8Array | ArrayBuffer, key: Uint8Array | ArrayBuffer,
    iv: Uint8Array | ArrayBuffer, aad?: Uint8Array | ArrayBuffer): Uint8Array;

  /** AES-GCM 加密（返回 ct||tag） */
  aesGcmEncrypt(data: Uint8Array | ArrayBuffer, key: Uint8Array | ArrayBuffer,
    iv: Uint8Array | ArrayBuffer, aad?: Uint8Array | ArrayBuffer): Uint8Array;
}

// $.dns 直连桥：把域名钉到指定 IPv4 列表（宿主 netstack 直连规则），
// 绕过被污染的系统 DNS（ChannelDns 式按源直连）
export interface DnsBridge {
  /** 注册 host→IP 直连规则；host 须为域名（非 IP 字面量），ips 为 1..8 个 IPv4 */
  set(host: string, ips: string[]): void;
}

// $.cookies 域级 CookieJar 读写桥：HTTP 请求时宿主已自动存取响应/请求
// Cookie，此桥供插件主动读写跨域会话（如 noyacg SessionCookieJar）
export interface CookieBridge {
  /** 返回 URL 可用的全部 Cookie 拼接（name=value; …，无 Cookie: 前缀） */
  header(url: string): string;

  /** 读取 URL 域下指定 Cookie 值；不存在返回 '' */
  get(url: string, name: string): string;

  /** 为 URL 写入一条 Cookie（持久化，跨请求/跨源共享） */
  set(url: string, name: string, value: string): void;
}

// $.image.decode 解码结果：RGBA 像素（4 字节/像素，行主序）
export interface DecodedImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

// $.image 像素编解码桥（宿主 @ohos.image），供图片还原类拦截器使用
// （如 hanabimanga TileScrambleInterceptor 的切块重排）
export interface ImageBridge {
  /** 图片字节 → {width, height, pixels(RGBA)}；不支持的格式/超大图抛错 */
  decode(bytes: Uint8Array | ArrayBuffer): DecodedImage;

  /** RGBA 像素（width*height*4 字节）→ PNG 字节 */
  encodePng(width: number, height: number, pixels: Uint8Array | ArrayBuffer): Uint8Array;
}

// $.prefs 偏好桥（shim 闭包私有 prefsStore 的唯一访问口；
// raw __prefs_* 全局不进插件可见面）
export interface PrefsBridge {
  get(key: string): string | undefined;

  set(key: string, value: string): void;

  remove(key: string): void;

  clear(): void;

  all(): Record<string, string>;

  dump(): Record<string, string>;
}

// 宿主 $ DSL（plugin_runtime_jsvm.js 尾部导出）
export interface DollarDsl {
  http: HttpBridge;
  dns: DnsBridge;
  cookies: CookieBridge;
  image: ImageBridge;
  crypto: CryptoBridge;
  prefs: PrefsBridge;

  html(html: string, baseUrl?: string): DocNode;

  urlEncodeGbk(text: string): string;
}

// ---- manifest.json（静态声明） ----

export interface PrefOption {
  value: string;
  label: string;
}

// type: 'switch' | 'select' | 'edit' | 'password'（宿主宽松解析，password 归并为敏感 edit）
export interface ManifestSetting {
  type: string;
  key: string;
  title: string;
  summary?: string;
  default?: string;
  options?: PrefOption[];
  sensitive?: boolean;
  hidden?: boolean;
}

export interface PluginManifest {
  // 插件唯一身份，小写 UUID v4。与源码目录名无关。
  key: string;
  name: string;
  lang: string;
  version: string;
  versionCode: number;
  baseUrl?: string;
  nsfw?: boolean;
  supportsLatest?: boolean;
  minAppVersion?: number;
  dslVersion?: number;
  icon?: string;

  // BT 源标记：内容为种子/magnet 下载（宿主展示 BT 徽标）
  bt?: boolean;
  runtime?: string;
  engine?: string;
  // 主内容类型（manga | novel | video，缺省 manga）
  contentType?: string;
  // 内容类型全量列表（可多选；声明时优先于 contentType，contentType 须包含在列表内）
  contentTypes?: string[];
  settings?: ManifestSetting[];
}

// ---- 插件返回值（宿主 Raw* 宽松形态的推荐命名） ----

export interface RawWork {
  key: string;

  // 宿主宽松归一：缺失时回退 key；详情接口允许最小返回（如仅 key + status）
  title?: string;
  url?: string;
  coverUrl?: string;
  thumbnailUrl?: string;
  author?: string;
  artist?: string;
  description?: string;
  genre?: string[] | string;
  status?: number | string;

  // 作品级内容类型声明（manga | novel | video）：多类型插件区分单部作品归属；
  // 未声明（或缺省）时宿主回退插件主类型
  contentType?: string;
}

export interface WorkPage {
  works: RawWork[];
  hasNextPage: boolean;
}

export interface RawChapter {
  key: string;
  name: string;
  url?: string;
  chapterNumber?: number;
  dateUpload?: number;
  scanlator?: string;
  pages?: number;
  sortOrder?: number;
}

export interface RawPage {
  index: number;
  imageUrl: string;
  url?: string;
  pageUrl?: string;
}

export interface RawVideo {
  url: string;
  quality?: string;
  headers?: Record<string, string>;
}

// 浏览过滤器（type: 'group' | 'tristate' | 'checkbox' | 'select' | 'text' | ...）
export interface RawFilter {
  type?: string;
  name?: string;
  state?: number | boolean | string;
  values?: string[];
  filters?: RawFilter[];
  index?: number;

  // checkbox 等需携带站点侧 id 的过滤器使用（dmzj 题材、elitebabes 标签等）
  id?: string;
}

// ---- 插件导出契约（module.exports） ----

export interface SourceExtension {
  getPopularWorks(page: number): Promise<WorkPage> | WorkPage;

  getSearchWorks(page: number, query: string): Promise<WorkPage> | WorkPage;

  getLatestWorks?(page: number): Promise<WorkPage> | WorkPage;

  getWorkDetail?(workKey: string): Promise<RawWork> | RawWork;

  /** 相关/推荐作品（Tachiyomi fetchRelatedMangas 对应）；未导出则详情页隐藏该区块 */
  getRelatedWorks?(workKey: string): Promise<RawWork[]> | RawWork[];

  getChapterList?(workKey: string): Promise<RawChapter[]> | RawChapter[];

  getPageList?(chapterKey: string): Promise<RawPage[]> | RawPage[];

  getChapterText?(chapterKey: string): Promise<string> | string;

  getVideoList?(chapterKey: string): Promise<RawVideo[]> | RawVideo[];

  getFilterList?(): Promise<RawFilter[]> | RawFilter[];

  applyFilterState?(updates: string | RawFilter[]): unknown;

  resetFilters?(): unknown;

  setPreference?(key: string, value: string): unknown;

  getHeaders?(): Promise<Record<string, string>> | Record<string, string>;

  /** 图片字节代取/解密：返回 base64（data URL 或裸 base64，宿主宽松归一） */
  fetchImage?(pageUrl: string, imageUrl: string): Promise<string> | string;
}
