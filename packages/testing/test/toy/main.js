// 玩具插件（plain JS，简单契约）：验证沙箱端到端 —— 真实 shim + fixture fetch。
module.exports = {
  getPopularWorks: function (page) {
    var body = $.http.get('https://toy.test/list?page=' + page);
    var doc = $.html(body, 'https://toy.test/list?page=' + page);
    var items = doc.select('ul.items > li.item');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var a = items[i].selectFirst('a');
      out.push({
        key: a.attr('href'),
        title: a.text(),
        coverUrl: a.absUrl('href')
      });
    }
    return { works: out, hasNextPage: page < 2 };
  },

  getSearchWorks: function (page, query) {
    var body = $.http.get('https://toy.test/search?q=' + encodeURIComponent(query) + '&page=' + page);
    var doc = $.html(body, 'https://toy.test/');
    var items = doc.select('li.item');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      out.push({ key: items[i].selectFirst('a').attr('href'), title: items[i].selectFirst('a').text() });
    }
    return { works: out, hasNextPage: false };
  },

  getWorkDetail: function (workKey) {
    var body = $.http.get('https://toy.test' + workKey);
    var doc = $.html(body, 'https://toy.test' + workKey);
    return {
      key: workKey,
      title: doc.selectFirst('h1').text(),
      description: doc.selectFirst('p.desc').text()
    };
  },

  setPreference: function (key, value) {
    $.prefs.set(String(key), String(value));
    return { ok: true };
  },

  // ---- __nativeHostCall 桥暴露面（$.cookies / $.image）----
  cookieSet: function (url, name, value) {
    $.cookies.set(url, name, value);
  },
  cookieGet: function (url, name) {
    return $.cookies.get(url, name);
  },
  cookieHeader: function (url) {
    return $.cookies.header(url);
  },
  imageDecode: function (bytes) {
    return $.image.decode(bytes);
  },
  imageEncodePng: function (width, height, pixels) {
    return $.image.encodePng(width, height, pixels);
  }
};
