(function () {

  // 安全测试 fixture：攻击者插件 —— 模拟恶意扩展的越权探测向量。
  // 所有方法只返回观测结果，断言在 security.test.ts 侧完成
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
    // 向量 1：直接探测受害者键名（token）——经 $.prefs 任何途径应只见自身偏好
    probeStore: function () {
      return {
        viaGet: $.prefs.get('token'),
        viaAll: $.prefs.all(),
        viaDump: $.prefs.dump()
      };
    },
    // 向量 2：写入应只落入自身存储
    writePoison: function () {
      $.prefs.set('poison', 'pwned');
      return $.prefs.get('poison');
    },
    // 向量 2b：原型键被拒绝；dump 返回的是快照，改它不能写回存储
    poisonPrefs: function () {
      var thrown = '';
      try {
        $.prefs.set('__proto__', 'x');
        thrown = 'no';
      } catch (e) {
        thrown = String(e && e.message || e);
      }
      var snap = $.prefs.dump();
      snap.injected = 'nope';
      return {
        thrown: thrown,
        injected: String($.prefs.get('injected')),
        own: $.prefs.get('own')
      };
    },
    // 向量 3：raw prefs 桥不可见，$.prefs 是唯一访问口
    probePrefsBridge: function () {
      var p = $.prefs;
      return {
        rawStore: typeof __PREFS_STORE__,
        rawGet: typeof __prefs_get,
        rawSet: typeof __prefs_set,
        rawRemove: typeof __prefs_remove,
        rawClear: typeof __prefs_clear,
        rawGetAll: typeof __prefs_getAll,
        rawDump: typeof __prefsDump,
        dollarPrefsKeys: p ? Object.keys(p).sort() : []
      };
    },
    // 向量 4：探测宿主（Node vm 测试环境）全局是否暴露 + 构造器链逃逸
    probeHost: function () {
      var out = {
        process: typeof process,
        require: typeof require,
        Buffer: typeof Buffer
      };
      try {
        out.fnProcess = Function('return typeof process')();
      } catch (e) {
        out.fnProcess = 'threw';
      }
      try {
        out.ctorProcess = ({}).constructor.constructor('return typeof process')();
      } catch (e) {
        out.ctorProcess = 'threw';
      }
      return out;
    },
    // 向量 5：枚举插件可见全局自有属性名（暴露面收敛断言用）
    probeGlobalSurface: function () {
      return Object.getOwnPropertyNames(globalThis).sort();
    }
  };

})();
