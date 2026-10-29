import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttp, fetchHtml } from '../src/http.ts';
import type { DocNode, HttpResult } from '../src/types.ts';

// 宿主 $ DSL 桩：记录调用以断言默认头合并
const calls: string[] = [];
const okResult = (body: string): HttpResult => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: {},
  body,
  url: 'u',
});
let lastHtmlArgs: [string, string | undefined] | null = null;

globalThis.$ = {
  http: {
    get: (url: string, headers?: Record<string, string>): string => {
      calls.push(`GET ${url} ${JSON.stringify(headers ?? {})}`);
      return '<html></html>';
    },
    post: (url: string, body: string, headers?: Record<string, string>): string => {
      calls.push(`POST ${url} ${body} ${JSON.stringify(headers ?? {})}`);
      return body;
    },
    request: (url: string,
      options?: { method?: string; headers?: Record<string, string>; body?: string }): HttpResult => {
      calls.push(`REQ ${url} ${options?.method ?? 'GET'} ${JSON.stringify(options?.headers ?? {})}`);
      return okResult('req-body');
    },
    enqueue: (): void => {
      calls.push('ENQUEUE');
    },
    getBytes: (url: string, headers?: Record<string, string>,
      options?: { method?: string; body?: string }): Uint8Array => {
      calls.push(`GETBYTES ${url} ${options?.method ?? 'GET'} ${options?.body ?? ''} ${JSON.stringify(headers ?? {})}`);
      return new Uint8Array([1, 2, 3]);
    },
    getBytesResponse: (url: string, headers?: Record<string, string>,
      options?: { method?: string; body?: string }): {
      ok: boolean;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      url: string;
      bytes: Uint8Array
    } => {
      calls.push(`GETBYTESRES ${url} ${options?.method ?? 'GET'} ${options?.body ?? ''}`);
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        url: 'u',
        bytes: new Uint8Array([4, 5, 6]),
      };
    },
  },
  html: (html: string, baseUrl?: string): DocNode => {
    lastHtmlArgs = [html, baseUrl];
    return {} as DocNode;
  },
  urlEncodeGbk: (): string => '',
  dns: {
    set: (): void => {
    },
  },
  prefs: {
    get: (): string | undefined => undefined,
    set: (): void => {
    },
    remove: (): void => {
    },
    clear: (): void => {
    },
    all: (): Record<string, string> => ({}),
    dump: (): Record<string, string> => ({}),
  },
  crypto: {
    base64Encode: (s: string): string => s,
    base64Decode: (s: string): string => s,
    aesCbcDecrypt: (): Uint8Array => new Uint8Array(0),
    md5: (s: string): string => s,
    md5Bytes: (): Uint8Array => new Uint8Array(0),
    digest: (): Uint8Array => new Uint8Array(0),
    sha1: (): string => '',
    sha256: (): string => '',
    sha384: (): string => '',
    sha512: (): string => '',
    hmac: (): string => '',
    hmacBytes: (): Uint8Array => new Uint8Array(0),
    pbkdf2: (): Uint8Array => new Uint8Array(0),
    aesGcmDecrypt: (): Uint8Array => new Uint8Array(0),
    aesGcmEncrypt: (): Uint8Array => new Uint8Array(0),
  },
  cookies: {
    header: (): string => '',
    get: (): string => '',
    set: (): void => {
    },
  },
  image: {
    decode: (): { width: number; height: number; pixels: Uint8Array } => ({
      width: 0,
      height: 0,
      pixels: new Uint8Array(0)
    }),
    encodePng: (): Uint8Array => new Uint8Array(0),
  },
};

test('createHttp merges default headers with per-call headers', () => {
  const http = createHttp({ Referer: 'https://a.com/', 'X-Site': 'a' });
  http.get('https://a.com/list');
  assert.equal(calls.pop(), 'GET https://a.com/list {"Referer":"https://a.com/","X-Site":"a"}');

  http.get('https://a.com/list', { Referer: 'https://b.com/' });
  assert.equal(calls.pop(), 'GET https://a.com/list {"Referer":"https://b.com/","X-Site":"a"}');

  http.post('https://a.com/q', 'a=1', { 'Content-Type': 'application/json' });
  assert.equal(calls.pop(),
    'POST https://a.com/q a=1 {"Referer":"https://a.com/","X-Site":"a","Content-Type":"application/json"}');

  const r = http.request('https://a.com/api', { method: 'POST', headers: { Authorization: 't' }, body: 'x=1' });
  assert.equal(r.ok, true);
  assert.equal(r.body, 'req-body');
  assert.equal(calls.pop(),
    'REQ https://a.com/api POST {"Referer":"https://a.com/","X-Site":"a","Authorization":"t"}');

  http.enqueue('https://a.com/log', { method: 'POST', body: 'e=1' });
  assert.equal(calls.pop(), 'ENQUEUE');

  assert.deepEqual(http.getBytes('https://a.com/img'), new Uint8Array([1, 2, 3]));
  assert.equal(calls.pop(),
    'GETBYTES https://a.com/img GET  {"Referer":"https://a.com/","X-Site":"a"}');

  http.getBytes('https://a.com/api/viewer', { 'Content-Type': 'application/x-www-form-urlencoded' },
    { method: 'POST', body: 'a=1' });
  assert.equal(calls.pop(),
    'GETBYTES https://a.com/api/viewer POST a=1 {"Referer":"https://a.com/","X-Site":"a","Content-Type":"application/x-www-form-urlencoded"}');

  const br = http.getBytesResponse('https://a.com/img');
  assert.equal(br.status, 401);
  assert.equal(br.ok, false);
  assert.deepEqual(br.bytes, new Uint8Array([4, 5, 6]));

  http.getBytesResponse('https://a.com/api/viewer', undefined, { method: 'POST', body: 'b=2' });
  assert.equal(calls.pop(), 'GETBYTESRES https://a.com/api/viewer POST b=2');
});

test('fetchHtml parses body with url as baseUrl', () => {
  const doc = fetchHtml('https://a.com/page', { Referer: 'https://a.com/' });
  assert.deepEqual(lastHtmlArgs, ['<html></html>', 'https://a.com/page']);
  assert.notEqual(doc, undefined);
});
