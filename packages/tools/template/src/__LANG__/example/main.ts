import { defineExtension, workOf, workPage } from '@honyomi/plugin-tools/sdk';
import type { SourceExtension, WorkPage } from '@honyomi/plugin-tools/sdk';

const BASE = '__BASE__';

function listWorks(url: string): WorkPage {
  const body = $.http.get(url);
  const doc = $.html(body, BASE + '/');
  const works = doc.select('.item').map((el) => workOf(
    el.selectFirst('a')?.attr('href') ?? '',
    el.selectFirst('.title')?.text() ?? '',
  ));
  return workPage(works, doc.selectFirst('.next') !== null);
}

const ext: SourceExtension = {
  getPopularWorks(page: number) {
    return listWorks(`${BASE}/list?page=${page}`);
  },
  getSearchWorks(page: number, query: string) {
    return listWorks(`${BASE}/search?page=${page}&q=${encodeURIComponent(query)}`);
  },
};

defineExtension(ext);
