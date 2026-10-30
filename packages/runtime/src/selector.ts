// Jsoup-ish 节点包装层：nativeSelector（lexbor 桥）JSON → jsoup 风格 Element。
// 自原手写 shim 逐段移植，语义 1:1（含 jsoup 伪类 ：contains/:containsOwn/:eq、
// 组合器 + > ~、src 懒加载回退属性链、canonical link 位置提升）。
import type { RawHit, RawSummary } from './host';
import { g } from './host';

export interface WrappedNode {
  attr(name: string): string;

  text(): string;

  ownText(): string;

  html(): string;

  outerHtml(): string;

  tag(): string;

  location(): string;

  absUrl(name: string): string;

  select(css: string): WrappedList;

  selectFirst(css: string): WrappedNode | null;
}

export interface WrappedList extends Array<WrappedNode> {
  first(): WrappedNode | null;

  last(): WrappedNode | null;

  isEmpty(): boolean;
}

// wrapNode 的宽松入参形状（wrapDocument 传合成根节点；防御性访问历史行为）
interface RawHitLike {
  outerHtml?: string;
  innerHtml?: string;
  text?: string;
  ownText?: string;
  tag?: string;
  attrs?: Record<string, string>;
  parents?: RawSummary[];
}

interface PseudoExtracted {
  css: string;
  contains: string[];
  containsOwn: string[];
  eq: number;
}

interface SimpleSpec {
  css: string;
  tag: string;
  id: string;
  classes: string[];
  eq: number;
  contains: string[];
  containsOwn: string[];
  hasJsoup: boolean;
}

interface SelectorToken {
  comb: string | null;
  spec: SimpleSpec;
}

function absUrl(u: string, base: string): string {
  if (String(u) === '') {
    return '';
  }
  try {
    const urlCtor = g.URL;
    if (urlCtor === undefined) {
      throw new Error('URL polyfill unavailable');
    }
    return new urlCtor(String(u), base === '' ? undefined : base).href;
  } catch {
    return /^https?:\/\//i.test(String(u)) ? String(u) : '';
  }
}

function unquoteJsoup(t: string): string {
  const trimmed = String(t || '').trim();
  if (trimmed.length >= 2) {
    const a = trimmed.charAt(0);
    const b = trimmed.charAt(trimmed.length - 1);
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function splitCommaSelectors(sel: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel.charAt(i);
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    } else if (c === ',' && depth === 0) {
      if (buf.trim() !== '') {
        parts.push(buf.trim());
      }
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim() !== '') {
    parts.push(buf.trim());
  }
  return parts;
}

function extractJsoupPseudos(simple: string): PseudoExtracted {
  const contains: string[] = [];
  const containsOwn: string[] = [];
  let eq = -1;
  let css = String(simple || '');
  css = css.replace(/:containsOwn\(([^)]*)\)/gi, (_m: string, t: string): string => {
    containsOwn.push(unquoteJsoup(t));
    return '';
  });
  css = css.replace(/:contains\(([^)]*)\)/gi, (_m: string, t: string): string => {
    contains.push(unquoteJsoup(t));
    return '';
  });
  css = css.replace(/:eq\((\d+)\)/g, (_m: string, n: string): string => {
    eq = parseInt(n, 10);
    return '';
  });
  css = css.replace(/:matches(?:Own)?\([^)]*\)/gi, '');
  css = css.replace(/\s{2,}/g, ' ').trim();
  return {
    css: css === '' ? '*' : css,
    contains,
    containsOwn,
    eq,
  };
}

// 剥离 CSS 伪类/伪元素（:last-child、:not(...)、::before 等；循环处理嵌套带参形式，
// 如 :not(:nth-child(2))）。这些条件由 native lexbor（测试环境 linkedom）在
// querySelectorAll 阶段过滤，JS 链校验只提取 tag/id/class，不重复求值（信任 native）。
// `:` 转义冒号（如 Tailwind 类名 .group-hover\:\text-...）不属于伪类，跳过。
function stripCssPseudos(s: string): string {
  let out = String(s || '');
  let prev = '';
  while (prev !== out) {
    prev = out;
    out = out.replace(/(?<!\\):{1,2}[a-zA-Z-][\w-]*(\([^()]*\))?/g, '');
  }
  return out;
}

function parseSimple(simple: string): SimpleSpec {
  const x = extractJsoupPseudos(simple);
  const bare = stripCssPseudos(x.css.replace(/\[[^\]]*]/g, ''));
  let tag = '*';
  const tm = bare.match(/^([a-zA-Z][\w-]*)/);
  if (tm !== null) {
    tag = tm[1].toLowerCase();
  }
  let id = '';
  const idm = bare.match(/#([a-zA-Z][\w-]*)/);
  if (idm !== null) {
    id = idm[1];
  }
  const classes: string[] = [];
  const cre = /\.([a-zA-Z][\w-]*)/g;
  let cm: RegExpExecArray | null;
  while ((cm = cre.exec(bare)) !== null) {
    classes.push(cm[1]);
  }
  return {
    css: x.css,
    tag,
    id,
    classes,
    eq: x.eq,
    contains: x.contains,
    containsOwn: x.containsOwn,
    hasJsoup: x.contains.length > 0 || x.containsOwn.length > 0 || x.eq >= 0,
  };
}

function tokenizeSelector(sel: string): SelectorToken[] {
  const tokens: SelectorToken[] = [];
  let buf = '';
  let depth = 0;
  let bracketDepth = 0;
  let quote = '';
  let comb: string | null = null;

  const pushSimple = (): void => {
    const s = buf.trim();
    buf = '';
    if (s === '') {
      return;
    }
    tokens.push({ comb, spec: parseSimple(s) });
  };

  for (let i = 0; i < sel.length; i++) {
    const c = sel.charAt(i);
    // 引号内原样透传（属性值 / :contains 文本里的 + > ~ 与空格不参与分词）
    if (quote !== '') {
      buf += c;
      if (c === quote) {
        quote = '';
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === '(') {
      depth++;
      buf += c;
      continue;
    }
    if (c === ')') {
      depth--;
      buf += c;
      continue;
    }
    if (c === '[') {
      bracketDepth++;
      buf += c;
      continue;
    }
    if (c === ']') {
      bracketDepth--;
      buf += c;
      continue;
    }
    if (depth === 0 && bracketDepth === 0 && (c === '+' || c === '>' || c === '~')) {
      pushSimple();
      comb = c;
      while (i + 1 < sel.length && sel.charAt(i + 1) === ' ') {
        i++;
      }
      continue;
    }
    if (depth === 0 && bracketDepth === 0 && c === ' ') {
      while (i + 1 < sel.length && sel.charAt(i + 1) === ' ') {
        i++;
      }
      const next = i + 1 < sel.length ? sel.charAt(i + 1) : '';
      if (next === '+' || next === '>' || next === '~') {
        continue;
      }
      pushSimple();
      comb = ' ';
      continue;
    }
    buf += c;
  }
  pushSimple();
  return tokens;
}

// matchSimple 的匹配入参形状：RawSummary / RawHit 的公共宽松面
interface MatchInfo {
  tag?: string;
  id?: string;
  className?: string;
  text?: string;
  ownText?: string;
  attrs?: Record<string, string>;
}

function infoClass(info: MatchInfo | null): string {
  if (info === null) {
    return '';
  }
  if (info.className !== undefined) {
    return String(info.className);
  }
  return info.attrs !== undefined && info.attrs['class'] !== undefined ? String(info.attrs['class']) : '';
}

function infoId(info: MatchInfo | null): string {
  if (info === null) {
    return '';
  }
  if (info.id !== undefined && info.id !== '') {
    return String(info.id);
  }
  return info.attrs !== undefined && info.attrs.id !== undefined ? String(info.attrs.id) : '';
}

function matchSimple(info: MatchInfo | null | undefined, spec: SimpleSpec): boolean {
  if (info === null || info === undefined) {
    return false;
  }
  const tag = String(info.tag || '').toLowerCase();
  if (spec.tag !== '*' && tag !== spec.tag) {
    return false;
  }
  if (spec.id !== '' && infoId(info) !== spec.id) {
    return false;
  }
  const cls = ' ' + infoClass(info) + ' ';
  for (const clsName of spec.classes) {
    if (cls.indexOf(' ' + clsName + ' ') < 0) {
      return false;
    }
  }
  const text = String(info.text || '').toLowerCase();
  for (const c of spec.contains) {
    if (text.indexOf(String(c).toLowerCase()) < 0) {
      return false;
    }
  }
  const own = String(info.ownText || '').toLowerCase();
  for (const o of spec.containsOwn) {
    if (own.indexOf(String(o).toLowerCase()) < 0) {
      return false;
    }
  }
  return true;
}

function chainNeedsJsoup(tokens: SelectorToken[]): boolean {
  for (const token of tokens) {
    if (token.spec.hasJsoup) {
      return true;
    }
  }
  return false;
}

// '+'/'~' 组合器匹配：优先用上下文的 prevSiblings（最近优先，桥最多 16 个）；
// 旧桥数据无该字段时退回 raw.prev 单元素近似（历史行为）
function matchSiblings(
  raw: RawHit,
  ctxSiblings: RawSummary[] | null,
  want: SimpleSpec,
  adjacent: boolean,
): boolean {
  if (ctxSiblings !== null) {
    if (adjacent) {
      return ctxSiblings.length > 0 && matchSimple(ctxSiblings[0], want);
    }
    for (const sib of ctxSiblings) {
      if (matchSimple(sib, want)) {
        return true;
      }
    }
    return false;
  }
  return matchSimple(raw.prev, want);
}

function matchesChain(raw: RawHit, tokens: SelectorToken[]): boolean {
  if (tokens.length === 0) {
    return true;
  }
  if (!chainNeedsJsoup(tokens)) {
    return true;
  }
  const parents = raw.parents || [];
  let parentIdx = 0;
  // 当前匹配上下文的前置兄弟摘要（最近优先，无数据为 null）：
  // 初始为命中元素自身；沿 ' '/'>' 进入某个祖先之后切换为该祖先的兄弟
  let ctxSiblings: RawSummary[] | null = raw.prevSiblings || null;
  let ti = tokens.length - 1;
  if (!matchSimple(raw, tokens[ti].spec)) {
    return false;
  }
  while (ti > 0) {
    const comb = tokens[ti].comb;
    const want = tokens[ti - 1].spec;
    ti--;
    if (comb === '+' || comb === '~') {
      if (!matchSiblings(raw, ctxSiblings, want, comb === '+')) {
        return false;
      }
      continue;
    }
    let found = -1;
    const limit = comb === '>' ? Math.min(parentIdx + 1, parents.length) : parents.length;
    for (let p = parentIdx; p < limit; p++) {
      if (matchSimple(parents[p], want)) {
        found = p;
        break;
      }
    }
    if (found < 0) {
      return false;
    }
    parentIdx = found + 1;
    ctxSiblings = parents[found].prevSiblings || null;
  }
  return true;
}

function nativeCssFromTokens(tokens: SelectorToken[]): string {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    if (i > 0) {
      const c = tokens[i].comb;
      out += c === ' ' || c === null ? ' ' : ' ' + c + ' ';
    }
    out += tokens[i].spec.css;
  }
  return out.trim() === '' ? '*' : out.trim();
}

function attachListApi(list: WrappedNode[]): WrappedList {
  const out = list as WrappedList;
  out.first = (): WrappedNode | null => (out.length > 0 ? out[0] : null);
  out.last = (): WrappedNode | null => (out.length > 0 ? out[out.length - 1] : null);
  out.isEmpty = (): boolean => out.length === 0;
  return out;
}

export function jsoupSelect(html: string, selector: string, baseUrl: string): WrappedList {
  const parts = splitCommaSelectors(String(selector || ''));
  const tokenized: SelectorToken[][] = [];
  for (const part of parts) {
    const tokens = tokenizeSelector(part);
    if (tokens.length > 0) {
      tokenized.push(tokens);
    }
  }
  // jsoup 逗号语义 = 文档序去重并集。纯 CSS 段（无 :contains/:eq 等 jsoup 伪类）
  // 合并为单次 native 调用：lexbor/linkedom 单趟遍历天然按文档序返回，同一元素
  // 命中多段时由 native/宿主侧去重，避免 JS 按段拼接造成的段序错乱与跨段重复。
  // 纯段中 matchesChain 恒真（chainNeedsJsoup 短路），语义完全由 native css 承载。
  if (tokenized.length > 0 && tokenized.every((tokens) => !chainNeedsJsoup(tokens))) {
    const css = tokenized.map((tokens) => nativeCssFromTokens(tokens)).join(', ');
    try {
      const hits = g.querySelectorAll(String(html), css) || [];
      const merged: WrappedNode[] = [];
      for (const hit of hits) {
        merged.push(wrapNode(hit, html, baseUrl, false));
      }
      return attachListApi(merged);
    } catch {
      // native 桥拒绝合并选择器（如不支持的选择器列表语法）时退回逐段路径
    }
  }
  const out: WrappedNode[] = [];
  for (const tokens of tokenized) {
    const css = nativeCssFromTokens(tokens);
    let hits: RawHit[] = [];
    try {
      hits = g.querySelectorAll(String(html), css) || [];
    } catch {
      hits = [];
    }
    const matched: WrappedNode[] = [];
    for (const hit of hits) {
      if (!matchesChain(hit, tokens)) {
        continue;
      }
      matched.push(wrapNode(hit, html, baseUrl, false));
    }
    const eq = tokens[tokens.length - 1].spec.eq;
    if (eq >= 0) {
      if (eq < matched.length) {
        out.push(matched[eq]);
      }
    } else {
      for (const node of matched) {
        out.push(node);
      }
    }
  }
  return attachListApi(out);
}

export function wrapNode(raw: RawHitLike, rootHtml: string, baseUrl: string, isDoc: boolean): WrappedNode {
  const base = baseUrl || '';
  return {
    attr(name: string): string {
      name = String(name || '');
      if (name.indexOf('abs:') === 0) {
        return absUrl(this.attr(name.substring(4)), base);
      }
      if (raw.attrs == null) {
        return '';
      }
      const v: string | undefined = raw.attrs[name];
      if (v === undefined && name === 'src') {
        const fallback: string =
          raw.attrs['data-src'] || raw.attrs['data-lazy-src'] || raw.attrs['data-cfsrc'] ||
            raw.attrs['data-manga-src'] || raw.attrs['data-original'] || '';
        return String(fallback);
      }
      return v == null ? '' : String(v);
    },
    text(): string {
      return raw.text ? String(raw.text) : '';
    },
    ownText(): string {
      if (raw.ownText != null && raw.ownText !== '') {
        return String(raw.ownText);
      }
      const h = raw.innerHtml ? String(raw.innerHtml) : '';
      return h.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    },
    html(): string {
      return raw.innerHtml ? String(raw.innerHtml) : '';
    },
    outerHtml(): string {
      return raw.outerHtml ? String(raw.outerHtml) : '';
    },
    tag(): string {
      return raw.tag ? String(raw.tag) : '';
    },
    location(): string {
      return base;
    },
    absUrl(name: string): string {
      return this.attr('abs:' + String(name || ''));
    },
    select(css: string): WrappedList {
      const scope = isDoc ? String(rootHtml || '') : String(raw.outerHtml || '');
      return jsoupSelect(scope, css, base);
    },
    selectFirst(css: string): WrappedNode | null {
      const list = this.select(css);
      return list.length > 0 ? list[0] : null;
    },
  };
}

// 文档级 text()/ownText()：script/style/template 与注释剔除、去标签、
// 实体解码、空白归一（对齐 jsoup Document.text() 语义）
function htmlTextContent(html: string): string {
  return String(html || '')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wrapDocument(html: string, baseUrl: string): WrappedNode {
  let loc = String(baseUrl || '');
  const link = String(html || '').match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i);
  if (link !== null) {
    const href = link[0].match(/href\s*=\s*["']([^"']+)["']/i);
    if (href !== null) {
      loc = absUrl(href[1], loc) || loc;
    }
  }
  return wrapNode(
    {
      outerHtml: html,
      innerHtml: html,
      text: htmlTextContent(html),
      ownText: htmlTextContent(html),
      tag: '#root',
      attrs: {},
      parents: [],
    },
    html,
    loc,
    true,
  );
}
