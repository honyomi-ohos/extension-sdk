(function () {

  // 安全测试 fixture：受害者插件 —— 种子携带敏感 token，
  // 暴露正控读取（readSecret）与偏好存储视图（dumpStore，经 $.prefs.dump），
  // 供跨插件隔离断言使用
  function emptyPage() {
    return { works: [], hasNextPage: false };
  }

  module.exports = {
    getPopularWorks: function () {
      return emptyPage();
    },
    getSearchWorks: function () {
      return emptyPage();
    },
    readSecret: function () {
      return $.prefs.get('token');
    },
    dumpStore: function () {
      return $.prefs.dump();
    }
  };

})();
