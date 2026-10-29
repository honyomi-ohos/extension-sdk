// HTTP 封装：默认头合并（Referer/Cookie 等站点级头一次声明）+ HTML 便捷拉取。
import type { BytesRequestOptions, DocNode, FetchBytesResult, HttpRequestOptions, HttpResult } from './types.ts';

function mergeHeaders(base: Record<string, string> | undefined,
  extra: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (base !== undefined) {
    Object.assign(out, base);
  }
  if (extra !== undefined) {
    Object.assign(out, extra);
  }
  return out;
}

export interface Http {
  get(url: string, headers?: Record<string, string>): string;

  post(url: string, body: string, headers?: Record<string, string>): string;

  request(url: string, options?: HttpRequestOptions): HttpResult;

  enqueue(url: string, options?: HttpRequestOptions): void;

  getBytes(url: string, headers?: Record<string, string>, options?: BytesRequestOptions): Uint8Array;

  getBytesResponse(url: string, headers?: Record<string, string>,
    options?: BytesRequestOptions): FetchBytesResult;
}

export function createHttp(defaultHeaders?: Record<string, string>): Http {
  const base = defaultHeaders ?? {};
  return {
    get(url: string, headers?: Record<string, string>): string {
      return $.http.get(url, mergeHeaders(base, headers));
    },
    post(url: string, body: string, headers?: Record<string, string>): string {
      return $.http.post(url, body, mergeHeaders(base, headers));
    },
    request(url: string, options?: HttpRequestOptions): HttpResult {
      return $.http.request(url, {
        ...options,
        headers: mergeHeaders(base, options?.headers),
      });
    },
    enqueue(url: string, options?: HttpRequestOptions): void {
      $.http.enqueue(url, {
        ...options,
        headers: mergeHeaders(base, options?.headers),
      });
    },
    getBytes(url: string, headers?: Record<string, string>, options?: BytesRequestOptions): Uint8Array {
      return $.http.getBytes(url, mergeHeaders(base, headers), options);
    },
    getBytesResponse(url: string, headers?: Record<string, string>,
      options?: BytesRequestOptions): FetchBytesResult {
      return $.http.getBytesResponse(url, mergeHeaders(base, headers), options);
    },
  };
}

// GET 并解析为文档（baseUrl 记入节点，abs: 属性按其解析绝对地址）
export function fetchHtml(url: string, headers?: Record<string, string>): DocNode {
  return $.html($.http.get(url, headers), url);
}
