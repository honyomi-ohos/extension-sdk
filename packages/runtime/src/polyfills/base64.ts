// atob / btoa：保持手写实现（宽松解码是既有插件的依赖行为——非法字符
// 静默剔除、宽松填充接受——未替换为严格 polyfill）。
import type { HostGlobal } from '../host';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function installBase64(g: HostGlobal): void {
  if (typeof g.btoa !== 'function') {
    g.btoa = (s: string): string => {
      s = String(s);
      let out = '';
      let i = 0;
      while (i < s.length) {
        const a = s.charCodeAt(i++);
        const b = i < s.length ? s.charCodeAt(i++) : NaN;
        const c = i < s.length ? s.charCodeAt(i++) : NaN;
        const t = (a << 16) | ((b & 255) << 8) | (c & 255);
        out += B64[(t >> 18) & 63] + B64[(t >> 12) & 63];
        out += isNaN(b) ? '=' : B64[(t >> 6) & 63];
        out += isNaN(c) ? '=' : B64[t & 63];
      }
      return out;
    };
  }
  if (typeof g.atob !== 'function') {
    g.atob = (s: string): string => {
      s = String(s).replace(/[^A-Za-z0-9+/=]/g, '');
      let out = '';
      let i = 0;
      while (i < s.length) {
        const e1 = B64.indexOf(s.charAt(i++));
        const e2 = B64.indexOf(s.charAt(i++));
        const e3 = B64.indexOf(s.charAt(i++));
        const e4 = B64.indexOf(s.charAt(i++));
        const t = (e1 << 18) | (e2 << 12) | ((e3 & 63) << 6) | (e4 & 63);
        out += String.fromCharCode((t >> 16) & 255);
        if (e3 !== 64 && e3 !== -1) {
          out += String.fromCharCode((t >> 8) & 255);
        }
        if (e4 !== 64 && e4 !== -1) {
          out += String.fromCharCode(t & 255);
        }
      }
      return out;
    };
  }
}
