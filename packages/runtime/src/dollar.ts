// $ 宿主 DSL（原 Honyomi 插件契约，SDK 类型见 @honyomi/plugin-sdk 的 global.d.ts）：
// http（fetch 闭包桥，仅 http/https）/ html（jsoup 包装）/ urlEncodeGbk（宿主 GBK 桥）/
// dns（host→IP 直连规则桥，绕过污染 DNS）/ cookies（域级 CookieJar 读写桥）/
// image（@ohos.image 像素编解码桥）/ crypto（AES-CBC/GCM + SHA/HMAC/PBKDF2 + md5 + base64）/
// prefs（闭包私有偏好存储的唯一访问口，dump/all 只返回字符串快照）。
import type { HostGlobal, HttpRequestOptions, } from './host';
import { g, natives, prefsStore } from './host';
import type { BytesInput } from './polyfills/crypto';
import { aesCbc, aesGcm, digestBytes, hmacBytes, md5bin, md5hex, pbkdf2Bytes, toHex } from './polyfills/crypto';
import type { WrappedNode } from './selector';
import { wrapDocument } from './selector';

// PROPFIND：WebDAV 列目录（Depth: 1）。不放行 TRACE / CONNECT 等其它扩展方法。
const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'PROPFIND']);
const PREFS_BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
const PREFS_KEY_MAX = 256;
const PREFS_VALUE_MAX = 1024 * 1024;

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const wanted = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) {
      return true;
    }
  }
  return false;
}

// 与宿主 NativeHttpBridge 同一条协议边界：只放行 http/https，并拒绝头注入字符。
function requireHttpUrl(url: unknown): string {
  const u = String(url ?? '').trim();
  if (u.indexOf('https://') !== 0 && u.indexOf('http://') !== 0) {
    throw new Error(`仅支持 http/https 请求: ${u}`);
  }
  if (/[\r\n\0]/.test(u)) {
    throw new Error('invalid http url');
  }
  return u;
}

function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers === undefined || headers === null) {
    return out;
  }
  for (const key of Object.keys(headers)) {
    const name = String(key);
    const value = String(headers[key] ?? '');
    if (name === '' || /[\r\n\0:]/.test(name) || /[\r\n\0]/.test(value)) {
      throw new Error('invalid http header');
    }
    out[name] = value;
  }
  return out;
}

function requireMethod(method: unknown): string {
  const name = String(method || 'GET').toUpperCase();
  if (!HTTP_METHODS.has(name)) {
    throw new Error(`unsupported http method: ${name}`);
  }
  return name;
}

// ---- $.dns.set 校验（宿主 ArkTS 侧会再防御一遍） ----

function normalizeDnsHost(input: unknown): string {
  const host = String(input ?? '').trim().toLowerCase();
  if (host === '' || host.length > 253) {
    throw new Error('invalid dns host');
  }
  // 域名（至少一级子域），拒绝端口 / 协议 / IP 字面量
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    throw new Error(`invalid dns host: ${host}`);
  }
  return host;
}

function normalizeDnsIps(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new Error('dns ips must be an array');
  }
  if (input.length === 0 || input.length > 8) {
    throw new Error('dns ips must contain 1..8 addresses');
  }
  const out: string[] = [];
  for (const item of input) {
    const ip = String(item ?? '').trim();
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
      throw new Error(`invalid dns ip: ${ip}`);
    }
    const parts = ip.split('.');
    for (const part of parts) {
      if (Number(part) > 255) {
        throw new Error(`invalid dns ip: ${ip}`);
      }
    }
    out.push(ip);
  }
  return out;
}

// 字节响应（$.http.getBytes / getBytesResponse 共用）：走 fetchBytes 桥，
// 返回完整信封；bytes 缺失视为空体错误。options 可指定 method/body
// （如 POST x-www-form-urlencoded 取 protobuf 二进制响应），默认 GET。
function httpBytesRequest(url: string, headers?: Record<string, string>,
  options?: { method?: string; body?: string }): Record<string, unknown> {
  const nativeFetchBytes = natives.fetchBytes;
  if (nativeFetchBytes === undefined) {
    throw new Error('fetchBytes bridge not available');
  }
  const target = requireHttpUrl(url);
  const method = requireMethod(options === undefined ? undefined : options.method);
  const body = options === undefined || options.body === undefined ? '' : String(options.body);
  const r = nativeFetchBytes(target, { method, headers: sanitizeHeaders(headers), body });
  const bytes = r.bytes;
  // 桥可能来自另一个 realm，不能用 instanceof Uint8Array。
  if (bytes == null || typeof bytes.length !== 'number') {
    throw new Error('fetchBytes: empty body');
  }
  return {
    ok: r.ok ?? ((r.status ?? 0) >= 200 && (r.status ?? 0) < 300),
    status: r.status ?? 0,
    statusText: r.statusText ?? '',
    headers: r.headers ?? {},
    url: r.url || target,
    bytes,
  };
}

// ---- 通用宿主调用（__nativeHostCall 桥）----
// 把 (kind, payload) 同步转发给宿主（ArkTS HostCalls 按 kind 路由），
// 返回结果 body JSON 的已解析对象。桥缺失 / 超时 / 宿主拒绝统一抛 Error，
// 由插件自行降级。信封格式与 HTTP 桥一致（{error?, body?}）。
function hostCall(kind: string, payload: Record<string, unknown>): Record<string, unknown> {
  const bridge = natives.hostCall;
  if (bridge === undefined) {
    throw new Error(`host call bridge not available: ${kind}`);
  }
  let raw: string;
  try {
    raw = bridge(kind, JSON.stringify(payload));
  } catch (e) {
    throw new Error(`host call failed: ${kind}: ${String(e)}`);
  }
  let parsed: { error?: string; body?: string };
  try {
    parsed = JSON.parse(raw) as { error?: string; body?: string };
  } catch {
    throw new Error(`host call result parse failed: ${kind}`);
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`host call result parse failed: ${kind}`);
  }
  if (parsed.error) {
    throw new Error(String(parsed.error));
  }
  const body = parsed.body == null ? '' : String(parsed.body);
  if (body === '') {
    return {};
  }
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error(`host call result body parse failed: ${kind}`);
  }
}

// ---- $.cookies / $.image 的载荷校验 ----

// 图像桥载荷上限：输入 64MB；解码后 1600 万像素（≈4096×4096，RGBA 64MB）
const IMAGE_BYTES_MAX = 64 * 1024 * 1024;
const IMAGE_PIXELS_MAX = 16 * 1024 * 1024;

// Uint8Array / ArrayBuffer 归一（兼容跨 realm typed array：按形状复制）
function asBytes(x: Uint8Array | ArrayBuffer): Uint8Array {
  if (x instanceof Uint8Array) {
    return x;
  }
  if (x instanceof ArrayBuffer) {
    return new Uint8Array(x);
  }
  // 跨 realm typed array（如沙箱 fetchBytes 返回的 Node Uint8Array）：
  // 按内部槽形状识别，构造本 realm 视图（构造器按内部槽接受外域 ArrayBuffer）
  const shaped = x as unknown as { length?: unknown; buffer?: unknown; byteOffset?: unknown };
  const buf = shaped.buffer;
  if (typeof shaped === 'object' && shaped !== null && typeof shaped.length === 'number' &&
    typeof shaped.byteOffset === 'number' && typeof buf === 'object' && buf !== null &&
    typeof (buf as { byteLength?: unknown }).byteLength === 'number') {
    return new Uint8Array(buf as ArrayBuffer, shaped.byteOffset, shaped.length);
  }
  throw new Error('image bytes must be Uint8Array or ArrayBuffer');
}

function requireCookieName(name: unknown): string {
  const n = String(name ?? '');
  if (n === '' || /[\r\n\0;=,]/.test(n)) {
    throw new Error('invalid cookie name');
  }
  return n;
}

function requireCookieValue(value: unknown): string {
  const v = String(value ?? '');
  if (/[\r\n\0]/.test(v)) {
    throw new Error('invalid cookie value');
  }
  return v;
}

// bytes → base64（经 polyfill 的 btoa；分块规避 fromCharCode.apply 参数上限）
function bytesToBase64(bytes: Uint8Array): string {
  const btoa = g.btoa;
  if (btoa === undefined) {
    throw new Error('btoa not available');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    const part: number[] = [];
    for (let j = 0; j < slice.length; j++) {
      part.push(slice[j]);
    }
    binary += String.fromCharCode.apply(null, part);
  }
  return btoa(binary);
}

// base64 → bytes（经 polyfill 的 atob）
function base64ToBytes(b64: string): Uint8Array {
  const atob = g.atob;
  if (atob === undefined) {
    throw new Error('atob not available');
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function httpRequest(url: string, options: HttpRequestOptions): Record<string, unknown> {
  const target = requireHttpUrl(url);
  const method = requireMethod(options.method);
  const headers = sanitizeHeaders(options.headers);
  const body = options.body == null ? '' : String(options.body);
  if (/[\r\n\0]/.test(body) && (method === 'GET' || method === 'HEAD')) {
    throw new Error('invalid http body');
  }
  if ((method === 'POST' || method === 'PUT') && body !== '' && !hasHeader(headers, 'Content-Type')) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  if (method === 'PROPFIND' && body !== '' && !hasHeader(headers, 'Content-Type')) {
    headers['Content-Type'] = 'application/xml; charset=utf-8';
  }
  const nativeFetch = natives.fetch;
  if (nativeFetch === undefined) {
    throw new Error('http bridge not available');
  }
  const r = nativeFetch(target, { method, headers, body });
  return {
    ok: r.ok,
    status: r.status,
    statusText: r.statusText,
    headers: r.headers || {},
    body: typeof r.text === 'function' ? r.text() : String(r.body == null ? '' : r.body),
    url: r.url || target,
  };
}

function prefsKey(key: unknown): string {
  const k = String(key);
  if (k.length === 0 || k.length > PREFS_KEY_MAX || PREFS_BLOCKED.has(k) || k.includes('\0')) {
    throw new Error('invalid prefs key');
  }
  return k;
}

function writePref(key: string, value: string): void {
  // defineProperty 不走 [[Set]]，避免键名 __proto__ 触发原型 setter。
  Object.defineProperty(prefsStore, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function prefsSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(prefsStore)) {
    if (PREFS_BLOCKED.has(key)) {
      continue;
    }
    const value = prefsStore[key];
    if (typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

export function installDollar(g: HostGlobal): void {
  g.$ = {
    http: {
      get: (url: string, headers?: Record<string, string>): string =>
      httpRequest(url, { method: 'GET', headers: headers || {} }).body as string,
      post: (url: string, body?: string, headers?: Record<string, string>): string =>
      httpRequest(url, {
        method: 'POST',
        headers: headers || {},
        body: body == null ? '' : String(body),
      }).body as string,
      request: (url: string, options?: HttpRequestOptions): Record<string, unknown> =>
      httpRequest(url, options || {}),
      enqueue: (url: string, options?: HttpRequestOptions): void => {
        try {
          httpRequest(url, options || {});
        } catch {
          /* fire-and-forget */
        }
      },
      getBytes: (url: string, headers?: Record<string, string>,
        options?: { method?: string; body?: string }): Uint8Array => {
        return httpBytesRequest(url, headers, options).bytes;
      },
      // 同 getBytes 但保留完整响应信封（ok/status/statusText/headers/url/bytes），
      // 供插件按状态码分支（如 401 图片链接过期提示）。
      getBytesResponse: (url: string, headers?: Record<string, string>,
        options?: { method?: string; body?: string }): Record<string, unknown> => {
        return httpBytesRequest(url, headers, options);
      },
    },
    html: (html: string, baseUrl?: string): WrappedNode => wrapDocument(html, baseUrl || ''),
    // DNS 直连桥：把 host 钉到指定 IPv4 列表（netstack 直连规则 + DoH 缓存 pin），
    // 绕过被污染的系统 DNS（ChannelDns 式按源直连）。桥不可用或宿主拒绝时抛错。
    dns: {
      set: (host: string, ips: string[]): void => {
        const target = normalizeDnsHost(host);
        const list = normalizeDnsIps(ips);
        const bridge = natives.dnsSet;
        if (bridge === undefined) {
          throw new Error('dns bridge not available');
        }
        const raw = bridge(target, JSON.stringify(list));
        let parsed: { error?: string } | null;
        try {
          parsed = JSON.parse(raw) as { error?: string };
        } catch {
          throw new Error('dns bridge result parse failed');
        }
        if (parsed === null || typeof parsed !== 'object') {
          throw new Error('dns bridge result parse failed');
        }
        if (parsed.error) {
          throw new Error(String(parsed.error));
        }
      },
    },
    // Cookie 存取桥（__nativeHostCall → CookieJar）：插件侧读写域级持久
    // CookieJar。HTTP 请求时宿主本就自动存取 Cookie，此桥用于跨域会话
    // 共享 / 插件主动注入场景（如 noyacg SessionCookieJar）。
    cookies: {
      // 返回 URL 可用的全部 Cookie 拼接（name=value; …，无 Cookie: 前缀）
      header: (url: string): string => {
        const target = requireHttpUrl(url);
        const res = hostCall('cookieHeader', { url: target });
        return String(res.header ?? '');
      },
      // 读取 URL 域下指定 Cookie 值；不存在返回 ''
      get: (url: string, name: string): string => {
        const target = requireHttpUrl(url);
        const res = hostCall('cookieGet', { url: target, name: requireCookieName(name) });
        return String(res.value ?? '');
      },
      // 为 URL 写入一条 Cookie（持久化，跨请求 / 跨源共享）
      set: (url: string, name: string, value: string): void => {
        const target = requireHttpUrl(url);
        hostCall('cookieSet', {
          url: target,
          name: requireCookieName(name),
          value: requireCookieValue(value),
        });
      },
    },
    // 图像像素编解码桥（__nativeHostCall → @ohos.image）：解码任意图片字节
    // 为 RGBA 像素 / 把 RGBA 像素回编为 PNG，供图片还原类拦截器使用
    // （如 hanabimanga TileScrambleInterceptor）。
    image: {
      // 图片字节 → {width, height, pixels}（pixels 为 RGBA Uint8Array，4 字节/像素）
      decode: (bytes: Uint8Array | ArrayBuffer): Record<string, unknown> => {
        const data = asBytes(bytes);
        if (data.length === 0) {
          throw new Error('image decode: empty input');
        }
        if (data.length > IMAGE_BYTES_MAX) {
          throw new Error('image decode: input too large');
        }
        const res = hostCall('imageDecode', { bytesBase64: bytesToBase64(data) });
        const width = Number(res.width ?? 0);
        const height = Number(res.height ?? 0);
        if (!Number.isInteger(width) || !Number.isInteger(height) ||
          width <= 0 || height <= 0 || width * height > IMAGE_PIXELS_MAX) {
          throw new Error('image decode: invalid result');
        }
        const pixels = base64ToBytes(String(res.pixelsBase64 ?? ''));
        if (pixels.length !== width * height * 4) {
          throw new Error('image decode: pixel buffer mismatch');
        }
        return { width, height, pixels };
      },
      // RGBA 像素（width*height*4 字节）→ PNG 字节
      encodePng: (width: number, height: number, pixels: Uint8Array | ArrayBuffer): Uint8Array => {
        const w = Number(width);
        const h = Number(height);
        if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || w * h > IMAGE_PIXELS_MAX) {
          throw new Error('image encode: invalid size');
        }
        const data = asBytes(pixels);
        if (data.length !== w * h * 4) {
          throw new Error('image encode: pixel buffer mismatch');
        }
        const res = hostCall('imageEncodePng', {
          width: w,
          height: h,
          pixelsBase64: bytesToBase64(data),
        });
        return base64ToBytes(String(res.pngBase64 ?? ''));
      },
    },
    // GBK URL 编码桥：宿主系统 TextEncoder('gbk') 编码文本并做百分号编码
    // （NativeHttpBridge.encodeGbkUrl）。桥不可用或编码失败时抛错，插件自行降级。
    urlEncodeGbk: (text: string): string => {
      if (typeof natives.gbk !== 'function') {
        throw new Error('urlEncodeGbk: bridge not available');
      }
      const raw = natives.gbk(String(text));
      let parsed: { error?: string; body?: string };
      try {
        parsed = JSON.parse(raw) as { error?: string; body?: string };
      } catch {
        throw new Error('urlEncodeGbk: bridge result parse failed');
      }
      if (parsed === null || typeof parsed !== 'object') {
        throw new Error('urlEncodeGbk: bridge result parse failed');
      }
      if (parsed.error) {
        throw new Error(String(parsed.error));
      }
      return String(parsed.body == null ? '' : parsed.body);
    },
    crypto: {
      base64Encode: (s: string): string => {
        const btoa = g.btoa;
        if (btoa === undefined) {
          throw new Error('btoa not available');
        }
        return btoa(s);
      },
      base64Decode: (s: string): string => {
        const atob = g.atob;
        if (atob === undefined) {
          throw new Error('atob not available');
        }
        return atob(s);
      },
      aesCbcDecrypt: (
        data: Uint8Array | ArrayBuffer,
        key: Uint8Array | ArrayBuffer,
        iv: Uint8Array | ArrayBuffer,
      ): Uint8Array => aesCbc(data, key, iv, true),
      md5: (s: string | Uint8Array | ArrayBuffer): string => md5hex(s),
      md5Bytes: (bytes: Uint8Array | ArrayBuffer): Uint8Array => md5bin(bytes),
      // ---- 扩展补全（@noble）：SHA / HMAC / PBKDF2 / AES-GCM 同步助手 ----
      digest: (algo: string, data: BytesInput): Uint8Array => digestBytes(algo, data),
      sha1: (data: BytesInput): string => toHex(digestBytes('SHA-1', data)),
      sha256: (data: BytesInput): string => toHex(digestBytes('SHA-256', data)),
      sha384: (data: BytesInput): string => toHex(digestBytes('SHA-384', data)),
      sha512: (data: BytesInput): string => toHex(digestBytes('SHA-512', data)),
      hmac: (algo: string, key: BytesInput, data: BytesInput): string => toHex(hmacBytes(algo, key, data)),
      hmacBytes: (algo: string, key: BytesInput, data: BytesInput): Uint8Array => hmacBytes(algo, key, data),
      pbkdf2: (
        password: BytesInput,
        salt: BytesInput,
        iterations: number,
        dkLen: number,
      ): Uint8Array => pbkdf2Bytes('SHA-256', password, salt, iterations, dkLen),
      aesGcmDecrypt: (
        data: Uint8Array | ArrayBuffer,
        key: Uint8Array | ArrayBuffer,
        iv: Uint8Array | ArrayBuffer,
        aad?: Uint8Array | ArrayBuffer,
      ): Uint8Array => aesGcm(data, key, iv, aad, true),
      aesGcmEncrypt: (
        data: Uint8Array | ArrayBuffer,
        key: Uint8Array | ArrayBuffer,
        iv: Uint8Array | ArrayBuffer,
        aad?: Uint8Array | ArrayBuffer,
      ): Uint8Array => aesGcm(data, key, iv, aad, false),
    },
    // 偏好桥（闭包私有 prefsStore 的唯一访问口）：
    // SDK createPrefs() 的后端，raw __prefs_* 全局不进插件面
    prefs: {
      get: (key: string): string | undefined => {
        const k = prefsKey(key);
        if (!Object.prototype.hasOwnProperty.call(prefsStore, k)) {
          return undefined;
        }
        const value = prefsStore[k];
        return typeof value === 'string' ? value : undefined;
      },
      set: (key: string, value: string): void => {
        const k = prefsKey(key);
        if (typeof value !== 'string') {
          throw new Error('prefs value must be a string');
        }
        if (value.length > PREFS_VALUE_MAX) {
          throw new Error('prefs value too large');
        }
        writePref(k, value);
      },
      remove: (key: string): void => {
        delete prefsStore[prefsKey(key)];
      },
      clear: (): void => {
        // 原地清空而非换新对象：宿主沙箱持有同一引用，用来读取写入结果。
        for (const key of Object.keys(prefsStore)) {
          delete prefsStore[key];
        }
      },
      // 快照而非活引用：插件改返回值不能把循环结构送进宿主 __prefsDump。
      all: (): Record<string, string> => prefsSnapshot(),
      dump: (): Record<string, string> => prefsSnapshot(),
    },
  };
}
