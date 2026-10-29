// URL 工具：相对地址解析语义与宿主 shim URL polyfill 保持一致。

export function trimSlash(url: string): string {
  return String(url ?? '').replace(/\/+$/, '');
}

// 域名不区分大小写，统一归一为小写（与 WHATWG URL 语义一致），便于比较。
export function hostOf(url: string): string {
  const m = String(url ?? '').match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/);
  return m !== null ? m[1].toLowerCase() : '';
}

// 相对/协议相对/根相对地址 → 基于 base 的绝对地址
export function relToAbs(url: string, base: string): string {
  const u = String(url ?? '');
  const b = String(base ?? '');
  if (u === '') {
    return b;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) {
    return u;
  }
  if (u.startsWith('//')) {
    const m = b.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:)/);
    return m !== null ? m[1] + u : u;
  }
  if (b === '') {
    return u;
  }
  if (u.startsWith('/')) {
    const m = b.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/);
    return m !== null ? m[0] + u : u;
  }
  return b.replace(/[?#].*$/, '').replace(/\/[^/]*$/, '/') + u;
}

export function joinUrl(base: string, path: string): string {
  return trimSlash(base) + '/' + String(path ?? '').replace(/^\/+/, '');
}
