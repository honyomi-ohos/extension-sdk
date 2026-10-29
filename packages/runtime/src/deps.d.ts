// 三方依赖最小类型声明（四包均不自带 types；仅声明 runtime 用到的表面）。
// 运行时形态：均为 CommonJS，经 esbuild 打包进 shim bundle。

declare module 'fast-text-encoding' {
  import type { TextDecoderCtor, TextEncoderCtor } from './host';

  // 纯 IIFE 无 module.exports：安装目标在求值期决定——设备端 global 已设时
  // 自装到 realm 全局（此时默认导入为空对象）；否则 esbuild CJS 模拟下
  // top-level this = exports，TextEncoder/TextDecoder 挂在默认导入上
  const fte: { TextEncoder?: TextEncoderCtor; TextDecoder?: TextDecoderCtor };

  export default fte;
}

declare module 'whatwg-url' {
  import type { UrlCtor, UrlSearchParamsCtor } from './host';

  export const URL: UrlCtor;

  export const URLSearchParams: UrlSearchParamsCtor;
}

declare module 'js-md5' {
  type Md5Input = string | number[] | Uint8Array | ArrayBuffer;

  interface Md5Static {
    // 十六进制小写输出；字符串按 UTF-8 编码（与原手写实现逐位一致）
    (input: Md5Input): string;

    arrayBuffer(input: Md5Input): ArrayBuffer;
  }

  const md5: Md5Static;

  export default md5;
}

declare module 'aes-js' {
  interface CbcMode {
    encrypt(plaintext: Uint8Array): Uint8Array;

    decrypt(ciphertext: Uint8Array): Uint8Array;
  }

  const aesjs: { ModeOfOperation: { cbc: new (key: Uint8Array, iv: Uint8Array) => CbcMode } };

  export default aesjs;
}
