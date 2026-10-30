// selector.ts 逗号并集语义测试：加载构建产物 dist/plugin_runtime_jsvm.js 到裸 vm，
// 注入记录型 querySelectorAll 桥，断言纯 CSS 逗号段合并为单次 native 调用
// （jsoup 文档序去重并集语义由 native 承载），jsoup 伪类段保持逐段路径。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

const SHIM_PATH = path.resolve(import.meta.dirname, '..', 'dist', 'plugin_runtime_jsvm.js');
const SHIM_SRC = readFileSync(SHIM_PATH, 'utf8');

interface BridgeCall {
  html: string;
  css: string;
}

interface RawHitStub {
  outerHtml: string;
  innerHtml: string;
  text: string;
  ownText: string;
  tag: string;
  attrs: Record<string, string>;
  prev: object;
  prevSiblings: object[];
  parents: object[];
}

function makeHit(tag: string, text: string, className?: string): RawHitStub {
  const attrs: Record<string, string> = {};
  if (className !== undefined) {
    attrs['class'] = className;
  }
  return {
    outerHtml: `<${tag}>${text}</${tag}>`,
    innerHtml: text,
    text,
    ownText: text,
    tag,
    attrs,
    prev: {},
    prevSiblings: [],
    parents: [],
  };
}

interface LoadedShim {
  ctx: vm.Context;
  calls: BridgeCall[];
}

// 桥按 css 返回预置命中（模拟 native 单趟文档序结果）；throwOnMerged 为真时
// 对含逗号的合并查询抛错，模拟 native 拒绝合并选择器列表。
function loadShim(table: Record<string, RawHitStub[]>, throwOnMerged = false): LoadedShim {
  const calls: BridgeCall[] = [];
  const sandboxGlobal: Record<string, unknown> = {
    fetch: (): object => ({ ok: true, status: 200, text: (): string => '', headers: {} }),
    fetchBytes: (): object => ({ ok: true, status: 200, headers: {}, bytes: [] }),
    querySelectorAll: (html: string, css: string): RawHitStub[] => {
      calls.push({ html, css });
      if (throwOnMerged && css.indexOf(',') >= 0) {
        throw new Error('merged selector rejected');
      }
      return table[css] ?? [];
    },
  };
  const ctx = vm.createContext(sandboxGlobal);
  vm.runInContext(SHIM_SRC, ctx, { filename: 'plugin_runtime_jsvm.js' });
  return { ctx, calls };
}

test('纯 CSS 逗号段合并为单次 native 调用，结果保持 native 文档序', () => {
  const { ctx, calls } = loadShim({
    '.a, .b': [makeHit('p', '2', 'b'), makeHit('p', '1', 'a')],
  });
  const r = vm.runInContext(`(function () {
    const list = $.html('<p class="a">1</p><p class="b">2</p>').select('.a, .b');
    return list.map((e) => e.text()).join('|');
  })()`, ctx);
  assert.equal(r, '2|1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].css, '.a, .b');
});

test(':not/:has 属纯 CSS，原样并入合并查询', () => {
  const { ctx, calls } = loadShim({
    'li:not(.b), div:has(em)': [makeHit('li', 'x', 'a')],
  });
  const r = vm.runInContext(`(function () {
    const list = $.html('<ul><li class="a">x</li></ul>').select('li:not(.b), div:has(em)');
    return list.length;
  })()`, ctx);
  assert.equal(r, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].css, 'li:not(.b), div:has(em)');
});

test('含 :contains 的段走逐段路径，文本过滤仍然生效', () => {
  const { ctx, calls } = loadShim({
    'div': [makeHit('div', 'foo'), makeHit('div', 'bar')],
    'span': [makeHit('span', 'zz')],
  });
  const r = vm.runInContext(`(function () {
    const list = $.html('<div>foo</div><div>bar</div><span>zz</span>')
      .select('div:contains(foo), span');
    return list.map((e) => e.tag() + ':' + e.text()).join('|');
  })()`, ctx);
  assert.equal(r, 'div:foo|span:zz');
  assert.deepEqual(calls.map((c) => c.css), ['div', 'span']);
});

test(':eq 段走逐段路径并按命中序号截取', () => {
  const { ctx } = loadShim({
    'p': [makeHit('p', '0'), makeHit('p', '1'), makeHit('p', '2')],
  });
  const r = vm.runInContext(`(function () {
    const list = $.html('<div><p>0</p><p>1</p><p>2</p></div>').select('p:eq(1)');
    return list.length === 1 ? list[0].text() : 'bad:' + list.length;
  })()`, ctx);
  assert.equal(r, '1');
});

test('合并查询被 native 拒绝时退回逐段路径', () => {
  const { ctx, calls } = loadShim({
    '.a': [makeHit('p', '1', 'a')],
    '.b': [makeHit('p', '2', 'b')],
  }, true);
  const r = vm.runInContext(`(function () {
    const list = $.html('<p class="a">1</p><p class="b">2</p>').select('.a, .b');
    return list.map((e) => e.text()).join('|');
  })()`, ctx);
  assert.equal(r, '1|2');
  assert.deepEqual(calls.map((c) => c.css), ['.a, .b', '.a', '.b']);
});
