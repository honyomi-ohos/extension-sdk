// 插件测试沙箱：Node vm 中运行真实宿主 shim + 插件构建产物。
// 环境保真点：
//   - shim（plugin_runtime_jsvm.js）逐字加载，$ DSL / $.prefs / crypto polyfill 与宿主一致
//   - 仅注入 shim 期望的宿主桥：fetch / fetchBytes / querySelectorAll / __PREFS_STORE__
//     （seed 通道，shim 初始化时捕获进闭包并从全局删除）
//   - querySelectorAll 用 linkedom 实现 lexbor 桥的 JSON 节点形态
//     （{outerHtml, innerHtml, text, ownText, tag, attrs, prev, prevSiblings, parents}，见 html_selector.h）
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { parseHTML } from 'linkedom';
import type { HttpRequestOptions, SourceExtension } from '@honyomi/plugin-sdk';

export interface FetchResponse {
  status?: number;
  ok?: boolean;
  statusText?: string;
  headers?: Record<string, string>;
  body: string;
  url?: string;
  bytes?: Uint8Array;
}

export type FetchMock = (url: string, options: HttpRequestOptions) => FetchResponse;

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface DnsCall {
  host: string;
  ips: string[];
}

// __nativeHostCall 调用记录（kind + 原始载荷 JSON）
export interface HostCallCall {
  kind: string;
  payload: string;
}

export interface LoadOptions {
  // 插件目录（含 manifest.json；TS 插件的构建产物在 dist/，见 mainJs 解析）
  pluginDir: string;

  // 种子偏好：直接作为该插件的扁平偏好存储（与设备端 seed 语义一致）
  prefs?: Record<string, string>;

  // fetch 桩；缺省时未匹配请求直接抛错
  fetchImpl?: FetchMock;

  // live 模式：经 curl 真站请求（需系统 curl；默认关闭）
  live?: boolean;

  // 宿主 shim 路径；缺省解析 @honyomi/plugin-runtime/shim
  // （包内 dist；写入 entry rawfile 只发生在宿主自动打包）
  shimPath?: string;

  // main.js 路径覆盖；缺省见 defaultMainJs
  mainJs?: string;
}

export interface LoadedPlugin {
  ext: SourceExtension;
  key: string;

  // 当前偏好快照（本插件扁平存储，setPreference 等写入后可见）
  prefs: () => Record<string, string>;

  // fetch 调用记录（按发生顺序）
  calls: FetchCall[];

  // $.dns.set 调用记录（按发生顺序；沙箱侧 mock，不真正注册规则）
  dnsCalls: DnsCall[];

  // __nativeHostCall 调用记录（按发生顺序；cookie 存取 + 图像编解码均记录）
  hostCalls: HostCallCall[];
}

function resolveDefaultShim(): string {
  try {
    return createRequire(import.meta.url).resolve('@honyomi/plugin-runtime/shim');
  } catch {
    return path.resolve(import.meta.dirname, '..', '..', 'runtime', 'dist', 'plugin_runtime_jsvm.js');
  }
}

export const DEFAULT_SHIM_PATH = resolveDefaultShim();

// ---- lexbor 桥的 JSON 节点形态（html_selector.h 契约） ----

interface RawSummary {
  tag: string;
  id: string;
  className: string;
  text: string;
  ownText: string;
  prevSiblings?: RawSummary[];
}

interface RawHit {
  outerHtml: string;
  innerHtml: string;
  text: string;
  ownText: string;
  tag: string;
  attrs: Record<string, string>;
  prev: RawSummary | null;
  prevSiblings: RawSummary[];
  parents: RawSummary[];
}

interface ElementLike {
  tagName: string;
  id: string;
  textContent: string | null;
  innerHTML: string;
  outerHTML: string;
  childNodes: Array<{ nodeType: number; nodeValue: string | null }>;
  parentElement: ElementLike | null;
  previousElementSibling: ElementLike | null;

  getAttributeNames(): string[];

  getAttribute(name: string): string | null;
}

function ownTextOf(el: ElementLike): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      out += node.nodeValue ?? '';
    }
  }
  return out;
}

function summarize(el: ElementLike | null): RawSummary | null {
  if (el === null) {
    return null;
  }
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id ?? '',
    className: el.getAttribute('class') ?? '',
    text: el.textContent ?? '',
    ownText: ownTextOf(el),
  };
}

// 前置兄弟摘要（最近优先，上限与 native 桥一致取 16）
function prevSiblingsOf(el: ElementLike | null): RawSummary[] {
  const out: RawSummary[] = [];
  if (el === null) {
    return out;
  }
  let s = el.previousElementSibling;
  while (s !== null && out.length < 16) {
    const summary = summarize(s);
    if (summary !== null) {
      out.push(summary);
    }
    s = s.previousElementSibling;
  }
  return out;
}

function toRawHit(el: ElementLike): RawHit {
  const attrs: Record<string, string> = {};
  for (const name of el.getAttributeNames()) {
    attrs[name] = el.getAttribute(name) ?? '';
  }
  const parents: RawSummary[] = [];
  let p = el.parentElement;
  while (p !== null) {
    const s = summarize(p);
    if (s !== null) {
      parents.push({ ...s, prevSiblings: prevSiblingsOf(p) });
    }
    p = p.parentElement;
  }
  const prev = summarize(el.previousElementSibling);
  return {
    outerHtml: el.outerHTML,
    innerHtml: el.innerHTML,
    text: el.textContent ?? '',
    ownText: ownTextOf(el),
    tag: el.tagName.toLowerCase(),
    attrs,
    prev,
    prevSiblings: prevSiblingsOf(el),
    parents,
  };
}

function makeQuerySelectorAll(): (html: string, css: string) => RawHit[] {
  return (html: string, css: string): RawHit[] => {
    try {
      const { document } = parseHTML(String(html));
      const hits = document.querySelectorAll(String(css)) as unknown as ElementLike[];
      const out: RawHit[] = [];
      for (const el of hits) {
        out.push(toRawHit(el));
      }
      return out;
    } catch {
      return [];
    }
  };
}

// ---- live 模式：curl 同步真站请求 ----
// 与宿主 NativeHttpBridge 行为对齐：共享 CookieJar（curl -b/-c）+ 手动跟随重定向（-L），
// 使 WAF 挑战（Set-Cookie 回传）等依赖会话的流程可在 live 模式下完整验证。

export function liveFetch(): FetchMock {
  const cookieDir = mkdtempSync(path.join(tmpdir(), 'honyomi-live-'));
  const cookieFile = path.join(cookieDir, 'cookies.txt');
  return (url: string, options: HttpRequestOptions): FetchResponse => {
    if (!/^https?:\/\//.test(url)) {
      throw new Error(`live 模式仅允许 http/https：${url}`);
    }
    const args = ['-sS', '--max-time', '30', '-D', '-', '-L', '--max-redirs', '8',
      '-b', cookieFile, '-c', cookieFile, '-X', options.method ?? 'GET'];
    for (const key of Object.keys(options.headers ?? {})) {
      const value = options.headers?.[key] ?? '';
      if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) {
        throw new Error('live 模式拒绝含换行的请求头');
      }
      args.push('-H', `${key}: ${value}`);
    }
    if (options.body !== undefined && options.body !== '') {
      args.push('--data-raw', options.body);
    }
    args.push('--', url);
    const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    // -L 时输出包含每跳的 header 段；body 为最后一个非 header 段，status 取最后一跳
    const segments = out.split('\r\n\r\n');
    let status = 200;
    const headers: Record<string, string> = {};
    let bodyStart = 0;
    for (let i = 0; i < segments.length; i++) {
      const firstLine = segments[i].split(/\r?\n/, 1)[0] ?? '';
      if (!/^HTTP\/[\d.]+\s+\d+/.test(firstLine)) {
        bodyStart = i;
        break;
      }
      const m = firstLine.match(/^HTTP\/[\d.]+\s+(\d+)/);
      if (m !== null) {
        status = Number(m[1]);
      }
      const lines = segments[i].split(/\r?\n/);
      for (let j = 1; j < lines.length; j++) {
        const idx = lines[j].indexOf(':');
        if (idx > 0) {
          headers[lines[j].slice(0, idx).trim()] = lines[j].slice(idx + 1).trim();
        }
      }
      bodyStart = i + 1;
    }
    const body = bodyStart < segments.length ? segments.slice(bodyStart).join('\r\n\r\n') : '';
    return {
      status,
      statusText: '',
      headers,
      body
    };
  };
}

function strictFetch(): FetchMock {
  return (url: string): FetchResponse => {
    throw new Error(`未提供 fetchImpl，请求被拒绝：${url}`);
  };
}

interface SandboxConsole {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

function redactLog(text: string): string {
  const redacted = text
    .replace(/([?&#](?:api[_-]?key|access[_-]?token|token|password|passwd|pwd|authorization|auth)=)[^&#\s]*/gi, '$1***')
    .replace(
      /((?:api[_-]?key|access[_-]?token|token|password|passwd|pwd|authorization)\s*[:=]\s*)(?!\[)([^\s,&;"']+)/gi,
      '$1***')
    .replace(/(MediaBrowser Token=")[^"]*(")/g, '$1***$2')
    .replace(/(Bearer\s+)\S+/gi, '$1***')
    .replace(/("(?:apiKey|api_key|password|token|authorization)"\s*:\s*")[^"]*(")/gi, '$1***$2');
  return redacted.length <= 500 ? redacted : redacted.slice(0, 500) + '…';
}

function makeConsole(key: string): SandboxConsole {
  const at = (level: string) => (...args: unknown[]): void => {
    const msg = redactLog(args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    console.log(`[plugin:${key}] ${level}: ${msg}`);
  };
  return {
    log: at('log'),
    info: at('info'),
    debug: at('debug'),
    warn: at('warn'),
    error: at('error'),
  };
}

interface VmModule {
  exports?: unknown;
}

// main.js 默认解析：
// - honyomi-catalog 工程里的插件 → <catalog>/dist/<id>/main.js，或 dist/<lang>/<id>/main.js
// - 独立插件目录 → <plugin>/dist/main.js
// 手写插件未构建时回退目录里的 main.js
function catalogRootOf(pluginDir: string): string | null {
  let dir = path.dirname(pluginDir);
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
        if (parsed.name === 'honyomi-catalog') {
          return dir;
        }
      } catch {
        // 继续向上找 catalog 根。
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

export function defaultMainJs(pluginDir: string): string {
  const catalogRoot = catalogRootOf(pluginDir);
  if (catalogRoot !== null) {
    const key = path.relative(catalogRoot, pluginDir).split(path.sep).join('/');
    const distKey = key.startsWith('src/') ? key.slice('src/'.length) : key;
    const dist = path.join(catalogRoot, 'dist', ...distKey.split('/'), 'main.js');
    if (existsSync(path.join(pluginDir, 'main.ts'))) {
      return dist;
    }
    return existsSync(dist) ? dist : path.join(pluginDir, 'main.js');
  }
  const local = path.join(pluginDir, 'dist', 'main.js');
  if (existsSync(path.join(pluginDir, 'main.ts')) || existsSync(local)) {
    return local;
  }
  return path.join(pluginDir, 'main.js');
}

// ---- 纯 JS PNG 编解码（沙箱 __nativeHostCall 的 image* mock 后端） ----
// 与宿主 @ohos.image 行为对齐的最小子集：仅 8 位非隔行 RGB/RGBA PNG。
// 设备端为全格式系统解码器；沙箱仅服务单元测试的像素级还原断言。

interface PngImage {
  width: number;
  height: number;
  pixels: Uint8Array; // RGBA
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

function decodePng(input: Uint8Array): PngImage {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (input[i] !== sig[i]) {
      throw new Error('图片解码失败: 非 PNG 数据');
    }
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (pos + 8 <= input.length) {
    const len = (input[pos] << 24 >>> 0) + (input[pos + 1] << 16 >>> 0) +
      (input[pos + 2] << 8 >>> 0) + input[pos + 3];
    const type = String.fromCharCode(input[pos + 4], input[pos + 5], input[pos + 6], input[pos + 7]);
    const dataStart = pos + 8;
    const dataEnd = dataStart + len;
    if (dataEnd > input.length) {
      throw new Error('图片解码失败: PNG 数据截断');
    }
    if (type === 'IHDR') {
      width = (input[dataStart] << 24 >>> 0) + (input[dataStart + 1] << 16 >>> 0) +
        (input[dataStart + 2] << 8 >>> 0) + input[dataStart + 3];
      height = (input[dataStart + 4] << 24 >>> 0) + (input[dataStart + 5] << 16 >>> 0) +
        (input[dataStart + 6] << 8 >>> 0) + input[dataStart + 7];
      bitDepth = input[dataStart + 8];
      colorType = input[dataStart + 9];
      interlace = input[dataStart + 12];
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(input.subarray(dataStart, dataEnd)));
    } else if (type === 'IEND') {
      break;
    }
    pos = dataEnd + 4;
  }
  if (width <= 0 || height <= 0 || width * height > 16 * 1024 * 1024) {
    throw new Error('图片解码失败: 尺寸超限');
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error('图片解码失败: 仅支持 8 位非隔行 RGB/RGBA PNG');
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  if (raw.length < (stride + 1) * height) {
    throw new Error('图片解码失败: 像素数据不完整');
  }
  const pixels = new Uint8Array(width * height * 4);
  let prev = Buffer.alloc(stride);
  let inPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inPos++];
    const line = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const v = raw[inPos + x];
      const left = x >= bpp ? line[x - bpp] : 0;
      const up = prev[x];
      const ul = x >= bpp ? prev[x - bpp] : 0;
      let out: number;
      if (filter === 0) {
        out = v;
      } else if (filter === 1) {
        out = (v + left) & 0xff;
      } else if (filter === 2) {
        out = (v + up) & 0xff;
      } else if (filter === 3) {
        out = (v + ((left + up) >> 1)) & 0xff;
      } else if (filter === 4) {
        out = (v + paeth(left, up, ul)) & 0xff;
      } else {
        throw new Error('图片解码失败: 非法滤波器');
      }
      line[x] = out;
    }
    inPos += stride;
    prev = line;
    for (let x = 0; x < width; x++) {
      const src = x * bpp;
      const dst = (y * width + x) * 4;
      pixels[dst] = line[src];
      pixels[dst + 1] = line[src + 1];
      pixels[dst + 2] = line[src + 2];
      pixels[dst + 3] = bpp === 4 ? line[src + 3] : 255;
    }
  }
  return { width, height, pixels };
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(img: PngImage): Uint8Array {
  if (img.pixels.length !== img.width * img.height * 4) {
    throw new Error('图片编码失败: 像素缓冲长度不匹配');
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(img.pixels.buffer, img.pixels.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 6 });
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---- __nativeHostCall mock：cookie 存取（内存 jar）+ 图像编解码（PNG） ----

function sandboxHostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
  const authority = m === null ? '' : m[1];
  const at = authority.lastIndexOf('@');
  const host = (at >= 0 ? authority.slice(at + 1) : authority).toLowerCase();
  const colon = host.indexOf(':');
  return colon >= 0 ? host.slice(0, colon) : host;
}

function makeHostCallMock(
  cookies: Map<string, Map<string, string>>,
  hostCalls: HostCallCall[],
): (kind: string, payloadJson: string) => string {
  const envelope = (body: string): string => JSON.stringify({
    status: 200,
    statusText: 'OK',
    headersJson: '{}',
    body,
    error: null,
    url: '',
  });
  const fail = (message: string): string => JSON.stringify({
    status: 0,
    statusText: '',
    headersJson: '{}',
    body: '',
    error: message,
    url: '',
  });
  return (kind: string, payloadJson: string): string => {
    hostCalls.push({ kind: String(kind), payload: String(payloadJson) });
    try {
      const payload = JSON.parse(String(payloadJson)) as {
        url?: string;
        name?: string;
        value?: string;
        bytesBase64?: string;
        width?: number;
        height?: number;
        pixelsBase64?: string;
      };
      const url = typeof payload.url === 'string' ? payload.url : '';
      if (kind === 'cookieHeader' || kind === 'cookieGet' || kind === 'cookieSet') {
        if (url.indexOf('https://') !== 0 && url.indexOf('http://') !== 0) {
          throw new Error(`仅支持 http/https 地址: ${url}`);
        }
        const host = sandboxHostOf(url);
        if (host === '') {
          throw new Error('无法解析 cookie 域名');
        }
        if (kind === 'cookieHeader') {
          const parts: string[] = [];
          cookies.forEach((entries: Map<string, string>, domain: string) => {
            if (host !== domain && !host.endsWith(`.${domain}`)) {
              return;
            }
            entries.forEach((value: string, name: string) => {
              parts.push(`${name}=${value}`);
            });
          });
          return envelope(JSON.stringify({ header: parts.join('; ') }));
        }
        if (kind === 'cookieGet') {
          const name = typeof payload.name === 'string' ? payload.name : '';
          if (name === '' || /[\r\n\0;,=]/.test(name)) {
            throw new Error('非法 cookie 名');
          }
          let value = '';
          cookies.forEach((entries: Map<string, string>, domain: string) => {
            if (value !== '' || (host !== domain && !host.endsWith(`.${domain}`))) {
              return;
            }
            const hit = entries.get(name);
            if (hit !== undefined) {
              value = hit;
            }
          });
          return envelope(JSON.stringify({ value }));
        }
        const name = typeof payload.name === 'string' ? payload.name : '';
        const value = typeof payload.value === 'string' ? payload.value : '';
        if (name === '' || /[\r\n\0;,=]/.test(name)) {
          throw new Error('非法 cookie 名');
        }
        if (/[\r\n\0]/.test(value)) {
          throw new Error('非法 cookie 值');
        }
        let entries = cookies.get(host);
        if (entries === undefined) {
          entries = new Map<string, string>();
          cookies.set(host, entries);
        }
        entries.set(name, value);
        return envelope('{}');
      }
      if (kind === 'imageDecode') {
        const b64 = typeof payload.bytesBase64 === 'string' ? payload.bytesBase64 : '';
        if (b64 === '') {
          throw new Error('图片解码失败: 空输入');
        }
        const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
        const img = decodePng(bytes);
        return envelope(JSON.stringify({
          width: img.width,
          height: img.height,
          pixelsBase64: Buffer.from(img.pixels).toString('base64'),
        }));
      }
      if (kind === 'imageEncodePng') {
        const w = typeof payload.width === 'number' ? Math.floor(payload.width) : 0;
        const h = typeof payload.height === 'number' ? Math.floor(payload.height) : 0;
        if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || w * h > 16 * 1024 * 1024) {
          throw new Error(`图片编码失败: 尺寸非法 (${w}x${h})`);
        }
        const b64 = typeof payload.pixelsBase64 === 'string' ? payload.pixelsBase64 : '';
        if (b64 === '') {
          throw new Error('图片编码失败: 空像素缓冲');
        }
        const pixels = new Uint8Array(Buffer.from(b64, 'base64'));
        const png = encodePng({ width: w, height: h, pixels });
        return envelope(JSON.stringify({ pngBase64: Buffer.from(png).toString('base64') }));
      }
      throw new Error(`不支持的 host call: ${kind}`);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };
}

export function loadExtension(options: LoadOptions): LoadedPlugin {
  const manifest = JSON.parse(
    readFileSync(path.join(options.pluginDir, 'manifest.json'), 'utf8'),
  ) as { key?: string };
  const key = typeof manifest.key === 'string' && manifest.key !== '' ? manifest.key : 'plugin';

  const store: Record<string, string> = { ...(options.prefs ?? {}) };
  const calls: FetchCall[] = [];
  const dnsCalls: DnsCall[] = [];
  const hostCalls: HostCallCall[] = [];
  const sandboxCookies = new Map<string, Map<string, string>>();
  const fetchImpl = options.fetchImpl ??
    (options.live === true ? liveFetch() : strictFetch());

  const fetchFn = (url: string, options?: HttpRequestOptions): object => {
    const opts = options ?? {};
    calls.push({
      url,
      method: opts.method ?? 'GET',
      headers: { ...(opts.headers ?? {}) },
      body: opts.body ?? '',
    });
    const r = fetchImpl(url, opts);
    const status = r.status ?? 200;
    const body = r.body ?? '';
    return {
      ok: r.ok ?? (status >= 200 && status < 300),
      status,
      statusText: r.statusText ?? '',
      headers: r.headers ?? {},
      url: r.url ?? url,
      text: (): string => body,
      json: (): unknown => JSON.parse(body),
    };
  };

  const fetchBytesFn = (url: string, options?: HttpRequestOptions): object => {
    const opts = options ?? {};
    calls.push({
      url,
      method: opts.method ?? 'GET',
      headers: { ...(opts.headers ?? {}) },
      body: opts.body ?? '',
    });
    const r = fetchImpl(url, opts);
    const status = r.status ?? 200;
    const bytes = r.bytes ?? new TextEncoder().encode(r.body ?? '');
    return {
      ok: r.ok ?? (status >= 200 && status < 300),
      status,
      statusText: r.statusText ?? '',
      headers: r.headers ?? {},
      url: r.url ?? url,
      bytes,
    };
  };

  const sandboxGlobal: Record<string, unknown> = {
    console: makeConsole(key),
    __PREFS_STORE__: store,
    fetch: fetchFn,
    fetchBytes: fetchBytesFn,
    querySelectorAll: makeQuerySelectorAll(),
    // 安全随机桥：对齐设备端 libohcrypto 硬件熵（crypto.getRandomValues 后端），
    // 沙箱用 node:crypto CSPRNG，避免测试态落到 Math.random 弱随机
    __nativeRandomBytes: (n: number): Uint8Array => {
      const len = Math.floor(Number(n));
      if (!Number.isFinite(len) || len < 0 || len > 65536) {
        throw new Error('randomBytes: invalid length');
      }
      return new Uint8Array(randomBytes(len));
    },
    // DNS 直连桥 mock：记录调用并回成功信封（设备端由 Doh.pin 真正注册）
    __nativeDnsSet: (host: string, ipsJson: string): string => {
      let ips: string[] = [];
      try {
        const parsed = JSON.parse(String(ipsJson)) as string[];
        if (Array.isArray(parsed)) {
          ips = parsed.map((ip) => String(ip));
        }
      } catch {
        ips = [];
      }
      dnsCalls.push({ host: String(host), ips });
      return JSON.stringify({
        status: 200,
        statusText: 'OK',
        headersJson: '{}',
        body: '',
        error: null,
        url: ''
      });
    },
    // 通用宿主调用桥 mock：cookie 存取（内存 jar）+ 图像像素编解码
    // （纯 JS PNG）；全部调用记录进 hostCalls 供断言
    __nativeHostCall: makeHostCallMock(sandboxCookies, hostCalls),
  };
  const context = vm.createContext(sandboxGlobal);

  const shimSrc = readFileSync(options.shimPath ?? DEFAULT_SHIM_PATH, 'utf8');
  vm.runInContext(shimSrc, context, { filename: 'plugin_runtime_jsvm.js' });

  const mainSrc = readFileSync(options.mainJs ?? defaultMainJs(options.pluginDir), 'utf8');
  vm.runInContext(mainSrc, context, { filename: 'main.js' });

  const mod = sandboxGlobal.module as VmModule | undefined;
  const ext = mod?.exports as SourceExtension | undefined;
  if (ext === undefined || typeof ext !== 'object' ||
    typeof ext.getPopularWorks !== 'function' || typeof ext.getSearchWorks !== 'function') {
    throw new Error(`${key}: main.js 未导出有效扩展（缺 getPopularWorks/getSearchWorks）`);
  }
  return {
    ext,
    key,
    prefs: (): Record<string, string> => ({ ...store }),
    calls,
    dnsCalls,
    hostCalls,
  };
}
