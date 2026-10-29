// runtime 产物测试：裸 vm 加载 dist/runtime shim（与 plugins/testing 的 sandbox 互补，
// 不注入 linkedom 桥），锁定 polyfill 行为基线
// （whatwg-url / fast-text-encoding / js-md5 / aes-js / @noble）+ prefs seed 捕获 +
// raw 桥收敛 + $ DSL 闭包桥。改动 runtime 源后须先 npm run build 再跑本测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

const SHIM_PATH = path.resolve(import.meta.dirname, '..', 'dist', 'plugin_runtime_jsvm.js');
const SHIM_SRC = readFileSync(SHIM_PATH, 'utf8');

interface LoadedShim {
  global: Record<string, unknown>;
  ctx: vm.Context;
}

// 裸 vm 加载：仅注入 shim 期望的最小宿主桥（fetch / fetchBytes /
// querySelectorAll / 可选 __PREFS_STORE__ / __nativeUrlEncodeGbk）
function loadShim(overrides?: Record<string, unknown>): LoadedShim {
  const sandboxGlobal: Record<string, unknown> = {
    fetch: (): object => ({
      ok: true,
      status: 200,
      text: (): string => 'ok',
      headers: {}
    }),
    fetchBytes: (): object => ({ ok: true, bytes: [1, 2, 3] }),
    querySelectorAll: (): object[] => [],
    ...overrides,
  };
  const ctx = vm.createContext(sandboxGlobal);
  vm.runInContext(SHIM_SRC, ctx, { filename: 'plugin_runtime_jsvm.js' });
  return { global: sandboxGlobal, ctx };
}

test('TextEncoder/TextDecoder（fast-text-encoding）：多字节与代理对', () => {
  const { ctx } = loadShim();
  const r = vm.runInContext(`(function () {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    return {
      abc: Array.from(enc.encode('abc')).join(','),
      euro: Array.from(enc.encode('€')).join(','),
      cjk: Array.from(enc.encode('中文')).join(','),
      surrogate: Array.from(enc.encode('😀')).join(','),
      rt: dec.decode(enc.encode('héllo 😀 你好')),
      b64shape: typeof enc.encode === 'function' && typeof dec.decode === 'function',
    };
  })()`, ctx);
  assert.equal(r.abc, '97,98,99');
  assert.equal(r.euro, '226,130,172');
  assert.equal(r.cjk, '228,184,173,230,150,135');
  assert.equal(r.surrogate, '240,159,152,128');
  assert.equal(r.rt, 'héllo 😀 你好');
  assert.equal(r.b64shape, true);
});

test('URL（whatwg-url）：href/origin/port/pathname/searchParams 规范语义', () => {
  const { ctx } = loadShim();
  const r = vm.runInContext(`(function () {
    const u = new URL('/a/b?x=1&x=2#frag', 'https://h.com:8443/base/');
    const p80 = new URL('http://x.com:80/a');
    return {
      href: u.href, origin: u.origin, protocol: u.protocol, host: u.host,
      hostname: u.hostname, port: u.port, pathname: u.pathname,
      search: u.search, hash: u.hash,
      x1: u.searchParams.get('x'), allX: u.searchParams.getAll('x').join('|'),
      y: String(u.searchParams.get('y')),
      p80port: p80.port, p80origin: p80.origin,
    };
  })()`, ctx);
  assert.equal(r.href, 'https://h.com:8443/a/b?x=1&x=2#frag');
  assert.equal(r.origin, 'https://h.com:8443');
  assert.equal(r.protocol, 'https:');
  assert.equal(r.host, 'h.com:8443');
  assert.equal(r.hostname, 'h.com');
  assert.equal(r.port, '8443');
  assert.equal(r.pathname, '/a/b');
  assert.equal(r.search, '?x=1&x=2');
  assert.equal(r.hash, '#frag');
  assert.equal(r.x1, '1');
  assert.equal(r.allX, '1|2');
  assert.equal(r.y, 'null');
  assert.equal(r.p80port, '');
  assert.equal(r.p80origin, 'http://x.com');
});

test('URLSearchParams：append/set/get/delete/has/toString', () => {
  const { ctx } = loadShim();
  const r = vm.runInContext(`(function () {
    const p = new URLSearchParams('a=1&b=2');
    p.append('a', '3');
    const before = p.getAll('a').join('|');
    p.set('a', '9');
    const after = p.get('a');
    p.delete('b');
    return { before, after, hasB: p.has('b'), str: p.toString() };
  })()`, ctx);
  assert.equal(r.before, '1|3');
  assert.equal(r.after, '9');
  assert.equal(r.hasB, false);
  assert.equal(r.str, 'a=9');
});

test('URL：非法构造抛错（absUrl 降级路径的前提）', () => {
  const { ctx } = loadShim();
  assert.throws(() => vm.runInContext('new URL("not a url")', ctx));
});

test('md5（js-md5）：NIST 基线 + UTF-8 字符串 + bytes 输入', () => {
  const { ctx } = loadShim();
  const r = vm.runInContext(`(function () {
    const md5 = $.crypto.md5;
    return {
      abc: md5('abc'),
      empty: md5(''),
      utf8: md5('中文'),
      bytes: md5(new Uint8Array([97, 98, 99])),
      fox: md5('The quick brown fox jumps over the lazy dog'),
      md5BytesHex: Array.from($.crypto.md5Bytes(new Uint8Array([97, 98, 99])))
        .map((x) => x.toString(16).padStart(2, '0')).join(''),
    };
  })()`, ctx);
  assert.equal(r.abc, '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(r.empty, 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(r.utf8, 'a7bac2239fcdcb3a067903d8077c4a07');
  assert.equal(r.bytes, '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(r.fox, '9e107d9d372bb6826bd81d3542a419d6');
  assert.equal(r.md5BytesHex, '900150983cd24fb0d6963f7d28e17f72');
});

test('AES-CBC（aes-js）：NIST SP 800-38A F.2.1 向量 + roundtrip + subtle Promise 形状', async () => {
  const { ctx } = loadShim();
  const out = await vm.runInContext(`(async function () {
    const unhex = (s) => {
      const a = new Uint8Array(s.length / 2);
      for (let i = 0; i < a.length; i++) a[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
      return a;
    };
    const hex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
    const key = unhex('2b7e151628aed2a6abf7158809cf4f3c');
    const iv = unhex('000102030405060708090a0b0c0d0e0f');
    const pt = unhex('6bc1bee22e409f96e93d7e117393172a');
    const k = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' });
    const ctBuf = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, k, pt);
    const ct = new Uint8Array(ctBuf);
    const backBuf = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, k, ct);
    const viaDollar = $.crypto.aesCbcDecrypt(ct, key, iv);
    return {
      firstBlock: hex(ct.subarray(0, 16)),
      back: hex(new Uint8Array(backBuf)),
      dollar: hex(viaDollar),
      bufOk: ctBuf instanceof ArrayBuffer,
      keyLen: k._k.length,
      subtleIsPromise: crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }) instanceof Promise,
    };
  })()`, ctx);
  assert.equal(out.firstBlock, '7649abac8119b246cee98e9b12e9197d');
  assert.equal(out.back, '6bc1bee22e409f96e93d7e117393172a');
  assert.equal(out.dollar, '6bc1bee22e409f96e93d7e117393172a');
  assert.equal(out.bufOk, true);
  assert.equal(out.keyLen, 16);
  assert.equal(out.subtleIsPromise, true);
});

test('atob/btoa：宽松行为基线（非法字符剔除）', () => {
  const { ctx } = loadShim();
  const r = vm.runInContext(`(function () {
    return { enc: btoa('abc'), dec: atob('YWJj'), lenient: atob('YWJ j\\n') };
  })()`, ctx);
  assert.equal(r.enc, 'YWJj');
  assert.equal(r.dec, 'abc');
  assert.equal(r.lenient, 'abc');
});

test('prefs：seed 捕获进闭包，raw 桥不进插件面', () => {
  const { global, ctx } = loadShim({ __PREFS_STORE__: { seed: 'v' } });
  assert.equal(global.__PREFS_STORE__, undefined);
  const r = vm.runInContext(`(function () {
    $.prefs.set('a', '1');
    return {
      seed: $.prefs.get('seed'),
      a: $.prefs.get('a'),
      missing: String($.prefs.get('nope')),
      rawStore: typeof __PREFS_STORE__,
      rawPrefsGet: typeof __prefsGet,
      dumpSeed: $.prefs.dump().seed,
      keys: Object.keys($.prefs.all()).sort().join(','),
    };
  })()`, ctx);
  assert.equal(r.seed, 'v');
  assert.equal(r.a, '1');
  assert.equal(r.missing, 'undefined');
  assert.equal(r.rawStore, 'undefined');
  assert.equal(r.rawPrefsGet, 'undefined');
  assert.equal(r.dumpSeed, 'v');
  assert.equal(r.keys, 'a,seed');
});

test('暴露面收敛：raw fetch/gbk 删除，公开契约保留，gbk 经 $ 可用', () => {
  const { global, ctx } = loadShim({
    __nativeUrlEncodeGbk: (): string => '{"body":"%C4%E3"}',
  });
  assert.equal(global.fetch, undefined);
  assert.equal(global.__nativeUrlEncodeGbk, undefined);
  const r = vm.runInContext(`(function () {
    return {
      dollar: typeof $,
      url: typeof URL,
      textEnc: typeof TextEncoder,
      textDec: typeof TextDecoder,
      crypto: typeof crypto,
      subtle: typeof crypto.subtle,
      getRand: typeof crypto.getRandomValues === 'function',
      module: typeof module,
      exports: typeof exports,
      globalRef: typeof global,
      gbk: $.urlEncodeGbk('你'),
    };
  })()`, ctx);
  assert.equal(r.dollar, 'object');
  assert.equal(r.url, 'function');
  assert.equal(r.textEnc, 'function');
  assert.equal(r.textDec, 'function');
  assert.equal(r.crypto, 'object');
  assert.equal(r.subtle, 'object');
  assert.equal(r.getRand, true);
  assert.equal(r.module, 'object');
  assert.equal(r.exports, 'object');
  assert.equal(r.globalRef, 'object');
  assert.equal(r.gbk, '%C4%E3');
});

test('暴露面收敛：不可配置的 raw 桥不让插件初始化失败，闭包桥仍可用', () => {
  const sandboxGlobal: Record<string, unknown> = {
    fetch: (): object => ({
      ok: true,
      status: 200,
      text: (): string => 'ok',
      headers: {}
    }),
    fetchBytes: (): object => ({ ok: true, bytes: [1, 2, 3] }),
    querySelectorAll: (): object[] => [],
  };
  const gbk = (): string => '{"body":"%C4%E3"}';
  Object.defineProperty(sandboxGlobal, '__nativeUrlEncodeGbk', {
    value: gbk,
    writable: false,
    enumerable: true,
    configurable: false,
  });
  const ctx = vm.createContext(sandboxGlobal);
  assert.doesNotThrow(() => {
    vm.runInContext(SHIM_SRC, ctx, { filename: 'plugin_runtime_jsvm.js' });
  });
  const r = vm.runInContext(`(function () {
    return { gbk: $.urlEncodeGbk('你'), still: typeof __nativeUrlEncodeGbk };
  })()`, ctx);
  assert.equal(r.gbk, '%C4%E3');
  assert.equal(r.still, 'function');
});

test('$ DSL：http.get/post 经闭包 fetch（raw fetch 已从全局删除）', () => {
  const calls: string[] = [];
  const { ctx } = loadShim({
    fetch: (url: string, options: Record<string, unknown>): object => {
      calls.push(`${String(options.method ?? 'GET')} ${url}`);
      return { ok: true, status: 200, text: (): string => `body:${url}` };
    },
  });
  const r = vm.runInContext(`(function () {
    return {
      body: $.http.get('https://x.com/a'),
      posted: $.http.post('https://x.com/b', 'q=1'),
    };
  })()`, ctx);
  assert.equal(r.body, 'body:https://x.com/a');
  assert.equal(r.posted, 'body:https://x.com/b');
  assert.deepEqual(calls, ['GET https://x.com/a', 'POST https://x.com/b']);
});

test('selector：wrapDocument/wrapNode/absUrl 基线（canned lexbor hit）', () => {
  const hit = {
    outerHtml: '<a href="/l">t</a>',
    innerHtml: 't',
    text: 't',
    ownText: 't',
    tag: 'a',
    attrs: { href: '/l' },
    prev: null,
    parents: [],
  };
  const { ctx } = loadShim({
    querySelectorAll: (_html: string, css: string): object[] =>
    css.includes('#missing') ? [] : [hit],
  });
  const r = vm.runInContext(`(function () {
    const doc = $.html('<html><body><a href="/l">t</a></body></html>', 'https://b.com/p/');
    const list = doc.select('a');
    const first = list.first();
    return {
      len: list.length,
      empty: list.isEmpty(),
      tag: first.tag(),
      href: first.attr('href'),
      abs: first.attr('abs:href'),
      text: first.text(),
      own: first.ownText(),
      outer: first.outerHtml(),
      loc: doc.location(),
      none: doc.select('#missing').length,
    };
  })()`, ctx);
  assert.equal(r.len, 1);
  assert.equal(r.empty, false);
  assert.equal(r.tag, 'a');
  assert.equal(r.href, '/l');
  assert.equal(r.abs, 'https://b.com/l');
  assert.equal(r.text, 't');
  assert.equal(r.own, 't');
  assert.equal(r.outer, '<a href="/l">t</a>');
  assert.equal(r.loc, 'https://b.com/p/');
  assert.equal(r.none, 0);
});

test('selector：+ / ~ 组合器使用 prevSiblings（最近优先，含 mid-chain 与旧桥回退）', () => {
  // p.tags 的前置兄弟（最近优先）：a -> br -> h3（非紧邻）。
  // 注：matchesChain 仅在链内含 jsoup 伪类（:contains/:eq/...）时生效，
  // 因此用例选择器都带 :contains 触发链式校验。
  const hitP = {
    outerHtml: '<p class="tags">t</p>',
    innerHtml: 't',
    text: 't',
    ownText: 't',
    tag: 'p',
    attrs: { class: 'tags' },
    className: 'tags',
    prev: {
      tag: 'a',
      id: '',
      className: '',
      text: 'X',
      ownText: 'X'
    },
    prevSiblings: [
      {
        tag: 'a',
        id: '',
        className: '',
        text: 'X',
        ownText: 'X'
      },
      {
        tag: 'br',
        id: '',
        className: '',
        text: '',
        ownText: ''
      },
      {
        tag: 'h3',
        id: '',
        className: '',
        text: 'Tags:',
        ownText: 'Tags:'
      },
    ],
    parents: [
      {
        tag: 'div',
        id: '',
        className: '',
        text: 'Tags: X t',
        ownText: ''
      },
      {
        tag: 'body',
        id: '',
        className: '',
        text: '',
        ownText: ''
      },
    ],
  };
  // 旧桥数据：无 prevSiblings 字段，仅 prev（回退路径）
  const hitLegacy = {
    outerHtml: '<p class="legacy">legacy</p>',
    innerHtml: 'legacy',
    text: 'legacy',
    ownText: 'legacy',
    tag: 'p',
    attrs: {},
    className: 'legacy',
    prev: {
      tag: 'h3',
      id: '',
      className: '',
      text: 'Tags:',
      ownText: 'Tags:'
    },
    parents: [],
  };
  // h3 是 p 父级 div 的前置兄弟（parent 级 ~）
  const hitDivChild = {
    outerHtml: '<p>child</p>',
    innerHtml: 'child',
    text: 'child',
    ownText: 'child',
    tag: 'p',
    attrs: {},
    className: '',
    prev: null,
    prevSiblings: [],
    parents: [
      {
        tag: 'div',
        id: '',
        className: '',
        text: 'child',
        ownText: '',
        prevSiblings: [{
          tag: 'h3',
          id: '',
          className: '',
          text: 'H',
          ownText: 'H'
        }],
      },
    ],
  };
  const { ctx } = loadShim({
    querySelectorAll: (_html: string, css: string): object[] => {
      if (css.includes('legacy')) {
        return [hitLegacy];
      }
      if (css.includes('div')) {
        return [hitDivChild];
      }
      return [hitP];
    },
  });
  const r = vm.runInContext(`(function () {
    const doc = $.html('<html><body></body></html>', 'https://b.com/');
    return {
      tilde: doc.select('h3:contains(Tags:) ~ p').length,
      adjacentNo: doc.select('h3:contains(Tags:) + p').length,
      adjacentYes: doc.select('a:contains(X) + p.tags').length,
      midChain: doc.select('h3:contains(H) ~ div > p').length,
      legacyFallback: doc.select('h3:contains(Tags:) + p.legacy').length,
    };
  })()`, ctx);
  assert.equal(r.tilde, 1);
  assert.equal(r.adjacentNo, 0);
  assert.equal(r.adjacentYes, 1);
  assert.equal(r.midChain, 1);
  assert.equal(r.legacyFallback, 1);
});

test('selector：属性值内的 + / ~ / 空格不被误判为组合器（引号与方括号深度）', () => {
  const seen: string[] = [];
  const scriptHit = {
    outerHtml: '<script type="application/ld+json">{"@context":"x"}</script>',
    innerHtml: '{"@context":"x"}',
    text: '{"@context":"x"}',
    ownText: '{"@context":"x"}',
    tag: 'script',
    attrs: { type: 'application/ld+json' },
    prev: null,
    parents: [],
  };
  const pHit = {
    outerHtml: '<p>a + b ~ c</p>',
    innerHtml: 'a + b ~ c',
    text: 'a + b ~ c',
    ownText: 'a + b ~ c',
    tag: 'p',
    attrs: {},
    prev: {
      tag: 'h3',
      id: '',
      className: '',
      text: 'T',
      ownText: 'T'
    },
    prevSiblings: [{
      tag: 'h3',
      id: '',
      className: '',
      text: 'T',
      ownText: 'T'
    }],
    parents: [],
  };
  const { ctx } = loadShim({
    querySelectorAll: (_html: string, css: string): object[] => {
      seen.push(css);
      if (css === 'p') {
        return [pHit];
      }
      if (css === 'h3 + p') {
        return [pHit];
      }
      return [scriptHit];
    },
  });
  const r = vm.runInContext(`(function () {
    const doc = $.html('<html></html>', 'https://b.com/');
    return {
      ld: doc.select('script[type="application/ld+json"]').length,
      sq: doc.select("div[data-x='a+b ~c>d']").length,
      containsPlus: doc.select('p:contains("a + b ~ c")').length,
      combStill: doc.select('h3:contains(T) + p').length,
    };
  })()`, ctx);
  assert.equal(r.ld, 1);
  assert.equal(r.sq, 1);
  assert.equal(r.containsPlus, 1);
  assert.equal(r.combStill, 1);
  // 传给桥的原生 CSS 未被组合器拆散
  assert.ok(seen.includes('script[type="application/ld+json"]'));
  assert.ok(seen.includes("div[data-x='a+b ~c>d']"));
  assert.ok(seen.includes('h3 + p'));
});

test('selector：CSS 结构伪类不吞进 tag、:not() 参数不污染 class（信任 native 过滤）', () => {
  const seen: string[] = [];
  const tdHit = {
    outerHtml: '<td>cell</td>',
    innerHtml: 'cell',
    text: 'cell',
    ownText: 'cell',
    tag: 'td',
    attrs: {},
    className: '',
    prev: null,
    prevSiblings: [],
    parents: [
      {
        tag: 'tr',
        id: '',
        className: '',
        text: 'Word cell',
        ownText: 'Word'
      },
      {
        tag: 'tbody',
        id: '',
        className: '',
        text: '',
        ownText: ''
      },
    ],
  };
  const pHit = {
    outerHtml: '<p>kid</p>',
    innerHtml: 'kid',
    text: 'kid',
    ownText: 'kid',
    tag: 'p',
    attrs: {},
    className: '',
    prev: null,
    prevSiblings: [],
    parents: [
      {
        tag: 'div',
        id: '',
        className: 'y',
        text: 'T kid',
        ownText: 'T'
      },
    ],
  };
  const { ctx } = loadShim({
    querySelectorAll: (_html: string, css: string): object[] => {
      seen.push(css);
      if (css.includes('td')) {
        return [tdHit];
      }
      if (css.includes('p')) {
        return [pHit];
      }
      return [];
    },
  });
  const r = vm.runInContext(`(function () {
    const doc = $.html('<html></html>', 'https://b.com/');
    return {
      lastChild: doc.select('tr:contains(Word) td:last-child').length,
      notPollution: doc.select('div:not(.x):contains(T) > p').length,
      nested: doc.select('tr:not(:nth-child(2)):contains(Word) td:last-child').length,
      neg: doc.select('h3:contains(Word) td:last-child').length,
    };
  })()`, ctx);
  // 传给桥的原生 CSS 保留结构伪类（native/lexbor 负责过滤），仅剥掉 jsoup 伪类
  assert.ok(seen.includes('tr td:last-child'));
  assert.ok(seen.includes('div:not(.x) > p'));
  assert.ok(seen.includes('tr:not(:nth-child(2)) td:last-child'));
  // 链式校验不再把 :last-child 吞进 tag（此前 tag==='td:last-child' 恒不匹配）
  assert.equal(r.lastChild, 1);
  // :not(.x) 的参数不再被当作必需 class（div 实际 class 为 y）
  assert.equal(r.notPollution, 1);
  // 嵌套 :not(:nth-child(2)) 不破坏 tag 提取
  assert.equal(r.nested, 1);
  // 负例：祖先段不匹配时链校验仍拒绝
  assert.equal(r.neg, 0);
});

test('SHA-256 / HMAC / PBKDF2：公开向量', () => {
  const { ctx } = loadShim();
  const r = vm.runInContext(`(function () {
    const hex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
    const key = new Uint8Array(20);
    key.fill(0x0b);
    return {
      sha: $.crypto.sha256('abc'),
      hmac: $.crypto.hmac('SHA-256', key, 'Hi There'),
      pbkdf2: hex($.crypto.pbkdf2('password', 'salt', 1, 32)),
    };
  })()`, ctx);
  assert.equal(r.sha, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(r.hmac, 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  assert.equal(r.pbkdf2, '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
});

test('AES-GCM 往返，篡改与非法参数抛错', async () => {
  const { ctx } = loadShim();
  const out = await vm.runInContext(`(async function () {
    const key = new Uint8Array(16);
    const iv = new Uint8Array(12);
    iv[0] = 1;
    const pt = new Uint8Array([1, 2, 3, 4, 5]);
    const ct = $.crypto.aesGcmEncrypt(pt, key, iv);
    const back = $.crypto.aesGcmDecrypt(ct, key, iv);
    ct[0] ^= 1;
    let tamper = 'no';
    try { $.crypto.aesGcmDecrypt(ct, key, iv); } catch (e) { tamper = 'yes'; }
    let badNonce = 'no';
    try { $.crypto.aesGcmEncrypt(pt, key, new Uint8Array(8)); } catch (e) { badNonce = 'yes'; }
    let badAlgo = 'no';
    try {
      const k = await crypto.subtle.importKey('raw', key, { name: 'AES-CTR' });
      await crypto.subtle.encrypt({ name: 'AES-CTR', iv: new Uint8Array(16) }, k, pt);
    } catch (e) { badAlgo = 'yes'; }
    let huge = 'no';
    try { $.crypto.pbkdf2('password', 'salt', 2000001, 16); } catch (e) { huge = 'yes'; }
    return { back: Array.from(back).join(','), tamper, badNonce, badAlgo, huge };
  })()`, ctx);
  assert.equal(out.back, '1,2,3,4,5');
  assert.equal(out.tamper, 'yes');
  assert.equal(out.badNonce, 'yes');
  assert.equal(out.badAlgo, 'yes');
  assert.equal(out.huge, 'yes');
});

test('http 拒绝非 http(s)、换行头；prefs 拒绝原型键且 dump 是快照', () => {
  const { ctx } = loadShim();
  const r = vm.runInContext(`(function () {
    const grab = (fn) => { try { fn(); return 'no'; } catch (e) { return String(e && e.message || e); } };
    $.prefs.set('ok', 'v');
    const snap = $.prefs.dump();
    snap.injected = 'nope';
    return {
      fileUrl: grab(() => $.http.get('file:///etc/passwd')),
      badHeader: grab(() => $.http.get('https://x.com/', { 'X-Bad': 'a' + String.fromCharCode(13, 10) + 'B: c' })),
      proto: grab(() => $.prefs.set('__proto__', 'x')),
      injected: String($.prefs.get('injected')),
      ok: $.prefs.get('ok'),
    };
  })()`, ctx);
  assert.match(r.fileUrl, /http\/https/);
  assert.match(r.badHeader, /invalid http header/);
  assert.match(r.proto, /invalid prefs key/);
  assert.equal(r.injected, 'undefined');
  assert.equal(r.ok, 'v');
});

test('getRandomValues：原生桥必须填满，短缓冲与超长请求抛错', () => {
  const full = loadShim({
    __nativeRandomBytes: (n: number): Uint8Array => new Uint8Array(n).fill(0xab),
  });
  const filled = vm.runInContext(`(function () {
    const a = new Uint8Array(4);
    crypto.getRandomValues(a);
    return Array.from(a).join(',');
  })()`, full.ctx);
  assert.equal(filled, '171,171,171,171');

  const short = loadShim({
    __nativeRandomBytes: (): Uint8Array => new Uint8Array(1),
  });
  assert.throws(() => vm.runInContext('crypto.getRandomValues(new Uint8Array(4))', short.ctx), /short buffer/);
  assert.throws(() => vm.runInContext('crypto.getRandomValues(new Uint8Array(65537))', full.ctx), /65536/);
});

test('getRandomValues：Math.random 回退可用且返回原数组', () => {
  const { ctx } = loadShim();
  const r = vm.runInContext(`(function () {
    const a = new Uint8Array(8);
    const ret = crypto.getRandomValues(a);
    return { same: ret === a, inRange: a.every((x) => x >= 0 && x <= 255) };
  })()`, ctx);
  assert.equal(r.same, true);
  assert.equal(r.inRange, true);
});

test('SHA 家族（@noble）：$.crypto 同步 hex + subtle.digest Promise（NIST + UTF-8）', async () => {
  const { ctx } = loadShim();
  const r = await vm.runInContext(`(async function () {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
    const dObj = await crypto.subtle.digest({ name: 'SHA-512' }, new TextEncoder().encode('abc'));
    return {
      sha1: $.crypto.sha1('abc'),
      sha256: $.crypto.sha256('abc'),
      sha384: $.crypto.sha384('abc'),
      sha512: $.crypto.sha512('abc'),
      utf8: $.crypto.sha256('中文'),
      bytes: $.crypto.sha256(new Uint8Array([97, 98, 99])),
      digestHex: Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, '0')).join(''),
      digestObjHex: Array.from(new Uint8Array(dObj)).map((x) => x.toString(16).padStart(2, '0')).join(''),
      digestIsPromise: crypto.subtle.digest('SHA-1', new Uint8Array(0)) instanceof Promise,
    };
  })()`, ctx);
  assert.equal(r.sha1, 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(r.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(r.sha384,
    'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7');
  assert.equal(r.sha512,
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
  assert.equal(r.utf8, '72726d8818f693066ceb69afa364218b692e62ea92b385782363780f47529c21');
  assert.equal(r.bytes, r.sha256);
  assert.equal(r.digestHex, r.sha256);
  assert.equal(r.digestObjHex, r.sha512);
  assert.equal(r.digestIsPromise, true);
});

test('HMAC（@noble）：$.crypto.hmac + subtle.sign/verify（RFC 4231 #2 / RFC 2202 #1）', async () => {
  const { ctx } = loadShim();
  const r = await vm.runInContext(`(async function () {
    const enc = new TextEncoder();
    const jefe = await crypto.subtle.importKey('raw', enc.encode('Jefe'), { name: 'HMAC', hash: 'SHA-256' });
    const sigBuf = await crypto.subtle.sign({ name: 'HMAC' }, jefe, enc.encode('what do ya want for nothing?'));
    const sig = new Uint8Array(sigBuf);
    const ok = await crypto.subtle.verify({ name: 'HMAC' }, jefe, sig, enc.encode('what do ya want for nothing?'));
    const bad = await crypto.subtle.verify({ name: 'HMAC' }, jefe, sig, enc.encode('tampered'));
    const hiKey = new Uint8Array(20).fill(0x0b);
    return {
      hex: Array.from(sig).map((x) => x.toString(16).padStart(2, '0')).join(''),
      ok, bad,
      jefe: $.crypto.hmac('SHA-256', 'Jefe', 'what do ya want for nothing?'),
      hi: $.crypto.hmac('SHA-1', hiKey, 'Hi There'),
      keyLen: jefe._k.length,
    };
  })()`, ctx);
  assert.equal(r.jefe, '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  assert.equal(r.hex, r.jefe);
  assert.equal(r.ok, true);
  assert.equal(r.bad, false);
  assert.equal(r.hi, 'b617318655057264e28bc0b6fb378c8ef146be00');
  assert.equal(r.keyLen, 4); // 'Jefe'
});

test('PBKDF2（@noble）：$.crypto.pbkdf2 + subtle.deriveBits（标准向量）', async () => {
  const { ctx } = loadShim();
  const r = await vm.runInContext(`(async function () {
    const enc = new TextEncoder();
    const hex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
    const p1 = $.crypto.pbkdf2('password', 'salt', 1, 32);
    const p2 = $.crypto.pbkdf2('password', 'salt', 2, 32);
    const k = await crypto.subtle.importKey('raw', enc.encode('password'), { name: 'PBKDF2' });
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode('salt'), iterations: 1, hash: 'SHA-256' }, k, 256);
    return { p1: hex(p1), p2: hex(p2), bits: hex(new Uint8Array(bits)) };
  })()`, ctx);
  assert.equal(r.p1, '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
  assert.equal(r.p2, 'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43');
  assert.equal(r.bits, r.p1);
});

test('AES-GCM（@noble）：$ 同步 + 确定性向量 + 篡改抛错 + subtle GCM', async () => {
  const { ctx } = loadShim();
  const r = await vm.runInContext(`(async function () {
    const enc = new TextEncoder();
    const hex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
    const key = new Uint8Array(16);
    const iv = new Uint8Array(12);
    const det = $.crypto.aesGcmEncrypt(enc.encode('hello'), key, iv);
    let tampered = '';
    try {
      const bad = det.slice();
      bad[0] ^= 1;
      $.crypto.aesGcmDecrypt(bad, key, iv);
    } catch (e) { tampered = 'throws'; }
    const k = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' });
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode('aad') }, k, enc.encode('hello'));
    const back = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode('aad') }, k, ct);
    const detAad = $.crypto.aesGcmEncrypt(enc.encode('hello'), key, iv, enc.encode('aad'));
    return {
      det: hex(det), tampered,
      roundtrip: new TextDecoder().decode(back),
      detAad: hex(detAad),
      ctLen: ct.byteLength,
    };
  })()`, ctx);
  // node:crypto aes-128-gcm 独立核算：ct=6bedb6a20f tag=fc05f3475d29034caa1cc8fa3628c39f
  assert.equal(r.det, '6bedb6a20ffc05f3475d29034caa1cc8fa3628c39f');
  assert.equal(r.tampered, 'throws');
  assert.equal(r.roundtrip, 'hello');
  assert.equal(r.ctLen, 21);
  assert.equal(r.detAad, '6bedb6a20fc4f07856c78e0ae8bac4e0118302f71b');
});

test('getRandomValues：__nativeRandomBytes 原生桥优先且用后从全局删除', () => {
  const counter = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  let calls = 0;
  const { global, ctx } = loadShim({
    __nativeRandomBytes: (n: number): Uint8Array => {
      calls++;
      return new Uint8Array(counter.slice(0, n));
    },
  });
  const r = vm.runInContext(`(function () {
    const a = crypto.getRandomValues(new Uint8Array(4));
    return { first: a[0], third: a[3], rawGone: typeof __nativeRandomBytes };
  })()`, ctx);
  assert.equal(r.first, 0);
  assert.equal(r.third, 3);
  assert.equal(r.rawGone, 'undefined');
  assert.equal((global as Record<string, unknown>).__nativeRandomBytes, undefined);
  assert.equal(calls, 1);
});
