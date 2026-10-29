// 返回值构造器：统一推荐命名 + 缺省值，免去插件手写重复样板。
import type { RawChapter, RawPage, RawVideo, RawWork, WorkPage } from './types.ts';

export function genreOf(genre: string[] | string | undefined): string {
  if (genre === undefined) {
    return '';
  }
  return Array.isArray(genre) ? genre.join(', ') : genre;
}

export function workOf(key: string, title: string, extra?: Partial<RawWork>): RawWork {
  return { key, title, ...extra };
}

export function workPage(works: RawWork[], hasNextPage: boolean): WorkPage {
  return { works, hasNextPage };
}

export function chapterOf(key: string, name: string, extra?: Partial<RawChapter>): RawChapter {
  return { key, name, ...extra };
}

export function pageOf(index: number, imageUrl: string, pageUrl?: string): RawPage {
  return { index, imageUrl, pageUrl };
}

export function videoOf(url: string, quality?: string, headers?: Record<string, string>): RawVideo {
  return { url, quality, headers };
}
