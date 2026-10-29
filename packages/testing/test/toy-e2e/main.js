// 玩具全链路插件（plain JS）：供 e2e 框架自测走通
// popular → latest → detail → chapters → pages → search 全流程。
module.exports = {
  getPopularWorks: function (page) {
    var body = $.http.get('https://e2e.test/popular?page=' + page);
    var doc = $.html(body, 'https://e2e.test/popular');
    var items = doc.select('li.item');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      out.push({
        key: items[i].selectFirst('a').attr('href'),
        title: items[i].selectFirst('a').text(),
        coverUrl: items[i].selectFirst('img').attr('src')
      });
    }
    return { works: out, hasNextPage: page < 2 };
  },

  getLatestWorks: function (page) {
    var body = $.http.get('https://e2e.test/latest?page=' + page);
    var doc = $.html(body, 'https://e2e.test/latest');
    var items = doc.select('li.item');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      out.push({ key: items[i].selectFirst('a').attr('href'), title: items[i].selectFirst('a').text() });
    }
    return { works: out, hasNextPage: false };
  },

  getSearchWorks: function (page, query) {
    var body = $.http.get('https://e2e.test/search?q=' + encodeURIComponent(query));
    var doc = $.html(body, 'https://e2e.test/search');
    var items = doc.select('li.item');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      out.push({ key: items[i].selectFirst('a').attr('href'), title: items[i].selectFirst('a').text() });
    }
    return { works: out, hasNextPage: false };
  },

  getWorkDetail: function (workKey) {
    var body = $.http.get('https://e2e.test' + workKey);
    var doc = $.html(body, 'https://e2e.test' + workKey);
    return {
      key: workKey,
      title: doc.selectFirst('h1').text(),
      description: doc.selectFirst('p.desc').text()
    };
  },

  getChapterList: function (workKey) {
    var body = $.http.get('https://e2e.test' + workKey + '/chapters');
    var doc = $.html(body, 'https://e2e.test' + workKey + '/chapters');
    var items = doc.select('li.chapter');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      out.push({ key: items[i].selectFirst('a').attr('href'), name: items[i].selectFirst('a').text() });
    }
    return out;
  },

  getPageList: function (chapterKey) {
    var body = $.http.get('https://e2e.test' + chapterKey);
    var doc = $.html(body, 'https://e2e.test' + chapterKey);
    var items = doc.select('img.page');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      out.push({ index: i, imageUrl: items[i].attr('src') });
    }
    return out;
  }
};
