// 插件偏好存取：SDK `createPrefs()` 是作者面唯一入口，
// 后端为宿主 $ DSL 的 `$.prefs`（shim 闭包私有存储）。
// 安全契约：每个引擎实例只承载一个扩展，`$.prefs` 只落在本扩展
// 自己的扁平偏好存储（k→v）内，插件无法借它寻址其它插件的偏好。

export interface Prefs {
  get(key: string, fallback?: string): string;

  set(key: string, value: string): void;

  has(key: string): boolean;

  remove(key: string): void;

  clear(): void;

  all(): Record<string, string>;

  isTrue(key: string, fallback?: boolean): boolean;

  num(key: string, fallback?: number): number;
}

export function createPrefs(): Prefs {
  const bridge = $.prefs;
  return {
    get(key: string, fallback = ''): string {
      const v = bridge.get(key);
      return v === undefined ? fallback : v;
    },
    set(key: string, value: string): void {
      bridge.set(key, value);
    },
    has(key: string): boolean {
      return bridge.get(key) !== undefined;
    },
    remove(key: string): void {
      bridge.remove(key);
    },
    clear(): void {
      bridge.clear();
    },
    all(): Record<string, string> {
      return bridge.all();
    },
    isTrue(key: string, fallback = false): boolean {
      const v = bridge.get(key);
      return v === undefined ? fallback : v === 'true' || v === '1';
    },
    num(key: string, fallback = 0): number {
      const v = bridge.get(key);
      if (v === undefined || v === '') {
        return fallback;
      }
      const n = Number(v);
      return Number.isNaN(n) ? fallback : n;
    },
  };
}
