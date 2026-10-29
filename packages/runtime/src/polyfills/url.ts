// URL / URLSearchParams —— whatwg-url v14（MIT，含 tr46 / webidl-conversions /
// punycode），替换原手写正则近似解析：href/origin/port/searchParams 语义对齐
// 浏览器规范；非法 URL 构造抛 TypeError（selector 层 absUrl 已捕获降级）。
import { URL, URLSearchParams } from 'whatwg-url';
import type { HostGlobal } from '../host';

export function installUrl(g: HostGlobal): void {
  if (typeof g.URL !== 'function') {
    g.URL = URL;
  }
  if (typeof g.URLSearchParams !== 'function') {
    g.URLSearchParams = URLSearchParams;
  }
}
