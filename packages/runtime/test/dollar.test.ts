// $ DSL（dollar.ts）行为测试：加载构建产物 dist/plugin_runtime_jsvm.js 到裸 vm，
// 注入记录型 fetchBytes 桥，断言 $.http.getBytes / getBytesResponse 的字节与信封语义。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

const SHIM_PATH = path.resolve(import.meta.dirname, '..', 'dist', 'plugin_runtime_jsvm.js');
const SHIM_SRC = readFileSync(SHIM_PATH, 'utf8');

interface BytesCall {
  url: string;
  options: Record<string, unknown>;
}

interface LoadedShim {
  global: Record<string, unknown>;
  ctx: vm.Context;
  calls: BytesCall[];
}

function loadShim(response?: Record<string, unknown>,
  hostCall?: (kind: string, payloadJson: string) => string): LoadedShim {
  const calls: BytesCall[] = [];
  const sandboxGlobal: Record<string, unknown> = {
    fetch: (url: string, options?: Record<string, unknown>): object => {
      calls.push({ url, options: options ?? {} });
      return {
        ok: true,
        status: 207,
        statusText: 'Multi-Status',
        text: (): string => 'ok',
        headers: {}
      };
    },
    fetchBytes: (url: string, options?: Record<string, unknown>): object => {
      calls.push({ url, options: options ?? {} });
      return response ?? {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'content-type': 'image/jpeg' },
        url: 'https://img.example/final.jpg',
        bytes: [9, 8, 7]
      };
    },
    querySelectorAll: (): object[] => [],
  };
  if (hostCall !== undefined) {
    sandboxGlobal.__nativeHostCall = hostCall;
  }
  const ctx = vm.createContext(sandboxGlobal);
  vm.runInContext(SHIM_SRC, ctx, { filename: 'plugin_runtime_jsvm.js' });
  return { global: sandboxGlobal, ctx, calls };
}

test('$.http.getBytes：仅返回字节；桥收 GET 与清洗后的头', () => {
  const { ctx, calls } = loadShim();
  const r = vm.runInContext(`(function () {
    const bytes = $.http.getBytes('https://img.example/a.jpg', { Referer: 'https://site.example/' });
    return Array.from(bytes).join(',');
  })()`, ctx);
  assert.equal(r, '9,8,7');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://img.example/a.jpg');
  assert.equal((calls[0].options.method as string) ?? 'GET', 'GET');
  assert.equal(JSON.stringify(calls[0].options.headers), '{"Referer":"https://site.example/"}');
});

test('$.http.getBytesResponse：保留完整响应信封（status/ok/headers/url/bytes）', () => {
  const { ctx, calls } = loadShim();
  const r = vm.runInContext(`(function () {
    const env = $.http.getBytesResponse('https://img.example/a.jpg');
    return {
      status: env.status, ok: env.ok, statusText: env.statusText,
      headers: JSON.stringify(env.headers), url: env.url,
      bytes: Array.from(env.bytes).join(','),
    };
  })()`, ctx);
  assert.equal(r.status, 401);
  assert.equal(r.ok, false);
  assert.equal(r.statusText, 'Unauthorized');
  assert.deepEqual(JSON.parse(r.headers), { 'content-type': 'image/jpeg' });
  assert.equal(r.url, 'https://img.example/final.jpg');
  assert.equal(r.bytes, '9,8,7');
  assert.equal(calls.length, 1);
});

test('$.http.getBytesResponse：桥未填 ok 时按 status 推导；缺 bytes 抛错', () => {
  const { ctx } = loadShim({ status: 200, bytes: [1] });
  const r = vm.runInContext(`(function () {
    const env = $.http.getBytesResponse('https://img.example/b.jpg');
    return { ok: env.ok, status: env.status, statusText: JSON.stringify(env.statusText), bytes: Array.from(env.bytes).join(',') };
  })()`, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.statusText, '""');
  assert.equal(r.bytes, '1');

  const empty = loadShim({ status: 200 });
  assert.throws(() => vm.runInContext(`$.http.getBytes('https://img.example/c.jpg')`, empty.ctx), /empty body/);
  assert.throws(() => vm.runInContext(`$.http.getBytesResponse('https://img.example/c.jpg')`, empty.ctx), /empty body/);
});

test('$.http.getBytes 系列拒绝非 http(s) URL', () => {
  const { ctx } = loadShim();
  assert.throws(() => vm.runInContext(`$.http.getBytes('ftp://x/y')`, ctx), /仅支持 http\/https/);
  assert.throws(() => vm.runInContext(`$.http.getBytesResponse('file:///etc/passwd')`, ctx), /仅支持 http\/https/);
});

test('$.http.getBytes 系列 options：POST + body 透传到 fetchBytes 桥', () => {
  const { ctx, calls } = loadShim();
  const r = vm.runInContext(`(function () {
    const env = $.http.getBytesResponse('https://api.example/v3/chapter_viewer',
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      { method: 'post', body: 'os=browser&title_id=42&chapter_id=7' });
    return { status: env.status, bytes: Array.from(env.bytes).join(',') };
  })()`, ctx);
  assert.equal(r.status, 401);
  assert.equal(r.bytes, '9,8,7');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body, 'os=browser&title_id=42&chapter_id=7');
  assert.equal(JSON.stringify(calls[0].options.headers), '{"Content-Type":"application/x-www-form-urlencoded"}');
});

test('$.http.request：放行 PROPFIND 并原样转发 Depth 与 XML 体；TRACE 仍拒绝', () => {
  const { ctx, calls } = loadShim();
  const r = vm.runInContext(`(function () {
    const env = $.http.request('https://dav.example/comics/', {
      method: 'propfind',
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    });
    return { status: env.status, ok: env.ok, body: env.body };
  })()`, ctx);
  assert.equal(r.status, 207);
  assert.equal(r.ok, true);
  assert.equal(r.body, 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://dav.example/comics/');
  assert.equal(calls[0].options.method, 'PROPFIND');
  assert.equal((calls[0].options.headers as Record<string, string>).Depth, '1');
  assert.equal(String(calls[0].options.body).includes('<d:propfind'), true);
  assert.throws(() => vm.runInContext(`$.http.request('https://dav.example/', { method: 'TRACE' })`, ctx),
    /unsupported http method: TRACE/);
});

test('$.http.getBytes 系列 options：非法 method 抛错；body 缺省为空串', () => {
  const { ctx, calls } = loadShim();
  assert.throws(
    () => vm.runInContext(`$.http.getBytes('https://img.example/a.jpg', undefined, { method: 'TRACE' })`, ctx),
    /unsupported http method: TRACE/);
  vm.runInContext(`$.http.getBytes('https://img.example/a.jpg')`, ctx);
  assert.equal(calls[calls.length - 1].options.method, 'GET');
  assert.equal(calls[calls.length - 1].options.body, '');
});

// ---- $.cookies / $.image（__nativeHostCall 通用宿主调用桥） ----

function okEnvelope(body: string): string {
  return JSON.stringify({
    status: 200,
    statusText: 'OK',
    headersJson: '{}',
    body,
    error: null,
    url: ''
  });
}

function failEnvelope(message: string): string {
  return JSON.stringify({
    status: 0,
    statusText: '',
    headersJson: '{}',
    body: '',
    error: message,
    url: ''
  });
}

test('$.cookies.set/get/header：经 __nativeHostCall 桥转发并解析结果', () => {
  const hostCalls: Array<{ kind: string; payload: string }> = [];
  const { ctx } = loadShim(undefined, (kind, payloadJson) => {
    hostCalls.push({ kind, payload: payloadJson });
    if (kind === 'cookieHeader') {
      return okEnvelope(JSON.stringify({ header: 'a=1; b=2' }));
    }
    if (kind === 'cookieGet') {
      return okEnvelope(JSON.stringify({ value: 'ses' }));
    }
    return okEnvelope('{}');
  });
  const r = vm.runInContext(`(function () {
    $.cookies.set('https://www.example.com/', 'session', 'abc');
    const got = $.cookies.get('https://www.example.com/', 'session');
    const header = $.cookies.header('https://www.example.com/');
    return { got, header };
  })()`, ctx);
  assert.equal(r.got, 'ses');
  assert.equal(r.header, 'a=1; b=2');
  assert.equal(hostCalls.length, 3);
  assert.equal(hostCalls[0].kind, 'cookieSet');
  assert.deepEqual(JSON.parse(hostCalls[0].payload),
    { url: 'https://www.example.com/', name: 'session', value: 'abc' });
  assert.equal(hostCalls[1].kind, 'cookieGet');
  assert.deepEqual(JSON.parse(hostCalls[1].payload), { url: 'https://www.example.com/', name: 'session' });
  assert.equal(hostCalls[2].kind, 'cookieHeader');
  assert.deepEqual(JSON.parse(hostCalls[2].payload), { url: 'https://www.example.com/' });
});

test('$.cookies：宿主错误信封转异常；桥缺失/非法输入本地拒绝', () => {
  const { ctx } = loadShim(undefined, () => failEnvelope('cookie 写入被拒'));
  assert.throws(() => vm.runInContext(`$.cookies.set('https://a.example/', 'x', 'y')`, ctx), /cookie 写入被拒/);
  assert.throws(() => vm.runInContext(`$.cookies.get('https://a.example/', 'x')`, ctx), /cookie 写入被拒/);

  const { ctx: noBridge } = loadShim();
  assert.throws(() => vm.runInContext(`$.cookies.set('https://a.example/', 'x', 'y')`, noBridge),
    /host call bridge not available/);

  assert.throws(() => vm.runInContext(`$.cookies.set('ftp://a.example/', 'x', 'y')`, ctx), /仅支持 http\/https/);
  assert.throws(() => vm.runInContext(`$.cookies.set('https://a.example/', 'bad;name', 'y')`, ctx),
    /invalid cookie name/);
  assert.throws(() => vm.runInContext(`$.cookies.set('https://a.example/', 'x', 'v\\r\\n')`, ctx),
    /invalid cookie value/);
});

test('$.image.decode：base64 载荷转发 + 像素结果校验', () => {
  const pixels = new Uint8Array(8).fill(7);
  const hostCalls: Array<{ kind: string; payload: string }> = [];
  const { ctx } = loadShim(undefined, (kind, payloadJson) => {
    hostCalls.push({ kind, payload: payloadJson });
    return okEnvelope(JSON.stringify({ width: 2, height: 1, pixelsBase64: Buffer.from(pixels).toString('base64') }));
  });
  const r = vm.runInContext(`(function () {
    const img = $.image.decode(new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]));
    return { width: img.width, height: img.height, pixels: Array.from(img.pixels).join(',') };
  })()`, ctx);
  assert.equal(r.width, 2);
  assert.equal(r.height, 1);
  assert.equal(r.pixels, '7,7,7,7,7,7,7,7');
  assert.equal(hostCalls.length, 1);
  assert.equal(hostCalls[0].kind, 'imageDecode');
  const payload = JSON.parse(hostCalls[0].payload) as { bytesBase64?: string };
  assert.equal(payload.bytesBase64, Buffer.from([137, 80, 78, 71, 0, 1, 2, 3]).toString('base64'));
});

test('$.image.encodePng：载荷校验 + PNG 字节回传', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const hostCalls: Array<{ kind: string; payload: string }> = [];
  const { ctx } = loadShim(undefined, (kind, payloadJson) => {
    hostCalls.push({ kind, payload: payloadJson });
    return okEnvelope(JSON.stringify({ pngBase64: Buffer.from(png).toString('base64') }));
  });
  const r = vm.runInContext(`(function () {
    const out = $.image.encodePng(2, 1, new Uint8Array(8).fill(3));
    return Array.from(out).join(',');
  })()`, ctx);
  assert.equal(r, '137,80,78,71,1,2,3,4');
  assert.equal(hostCalls.length, 1);
  assert.equal(hostCalls[0].kind, 'imageEncodePng');
  const payload = JSON.parse(hostCalls[0].payload) as { width?: number; height?: number; pixelsBase64?: string };
  assert.equal(payload.width, 2);
  assert.equal(payload.height, 1);
  assert.equal(payload.pixelsBase64, Buffer.from(new Uint8Array(8).fill(3)).toString('base64'));
});

test('$.image：尺寸/缓冲不匹配与桥缺失本地拒绝', () => {
  const { ctx } = loadShim(undefined, () => failEnvelope('宿主拒绝'));
  assert.throws(() => vm.runInContext(`$.image.decode(new Uint8Array(0))`, ctx), /empty input/);
  assert.throws(() => vm.runInContext(`$.image.decode('nope')`, ctx), /image bytes must be/);
  assert.throws(() => vm.runInContext(`$.image.encodePng(0, 1, new Uint8Array(4))`, ctx), /invalid size/);
  assert.throws(() => vm.runInContext(`$.image.encodePng(2, 1, new Uint8Array(4))`, ctx), /pixel buffer mismatch/);
  // 宿主返回的像素缓冲与 width*height*4 不符时拒绝
  const { ctx: badHost } = loadShim(undefined, () =>
  okEnvelope(JSON.stringify({ width: 2, height: 1, pixelsBase64: Buffer.from(new Uint8Array(4)).toString('base64') })));
  assert.throws(() => vm.runInContext(`$.image.decode(new Uint8Array([1, 2, 3, 4]))`, badHost),
    /pixel buffer mismatch/);
  const { ctx: noBridge } = loadShim();
  assert.throws(() => vm.runInContext(`$.image.decode(new Uint8Array([1]))`, noBridge),
    /host call bridge not available/);
});
