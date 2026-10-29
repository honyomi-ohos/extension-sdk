// crypto：AES-CBC（aes-js，MIT）+ SHA/HMAC/PBKDF2/AES-GCM（@noble，MIT，
// 审计过的现代实现）+ md5（js-md5，MIT）+ subtle 手写适配 +
// getRandomValues（libohcrypto 硬件熵原生桥优先，Math.random 兜底——
// JSVM 无原生 CSPRNG，兜底仅弱随机，插件侧不应依赖其生成安全令牌）。
// 行为约束（对齐原实现 / 既有插件依赖）：
//   - pkcs7 宽松 unpad：末字节 0 或 >16 时原样返回（非法 padding 不抛错，
//     chapter-protector 类插件依赖该宽松边界）
//   - CBC 的 IV 先截断 16 字节再补零；GCM 走标准 nonce/tag（默认 12/16），
//     GCM 认证失败抛错（非宽松——认证加密的篡改必须暴露）
//   - subtle Promise 形状 {_k,_a}（importKey 返回轻量 key 句柄）
//   - md5 十六进制小写输出，字符串按 UTF-8 编码（逐位一致）
//   - 字符串输入统一经 realm TextEncoder 按 UTF-8 编码
import aesjs from 'aes-js';
import md5 from 'js-md5';
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { gcm } from '@noble/ciphers/aes.js';
import type { HostGlobal, SubtleAlgo, SubtleKeyShape } from '../host';
import { g, natives } from '../host';
import type { CHash } from '@noble/hashes/utils.js';

export type BytesInput = string | Uint8Array | ArrayBuffer;

// noble 的哈希函数是带属性的 callable（outputLen/blockLen 等），
// 用其泛型 CHash 保留完整类型（hmac/pbkdf2 的参数需要）
type HashFn = CHash;

export function toU8(x: Uint8Array | ArrayBuffer): Uint8Array {
  if (x instanceof Uint8Array) {
    return x;
  }
  return new Uint8Array(x);
}

// 字符串按 UTF-8 编码（realm TextEncoder，text.ts 已安装），bytes 原样
function toBytes(x: BytesInput): Uint8Array {
  if (typeof x === 'string') {
    const TE = g.TextEncoder;
    if (typeof TE !== 'function') {
      throw new Error('TextEncoder not available');
    }
    return new TE().encode(x);
  }
  return toU8(x);
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function md5hex(s: string | Uint8Array | ArrayBuffer): string {
  return md5(typeof s === 'string' ? s : toU8(s));
}

export function md5bin(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  return new Uint8Array(md5.arrayBuffer(toU8(bytes)));
}

export function pkcs7Pad(data: Uint8Array): Uint8Array {
  const n = 16 - (data.length % 16);
  const out = new Uint8Array(data.length + n);
  out.set(data);
  for (let i = data.length; i < out.length; i++) {
    out[i] = n;
  }
  return out;
}

export function pkcs7Unpad(data: Uint8Array): Uint8Array {
  if (data.length === 0) {
    return data;
  }
  const n = data[data.length - 1];
  if (n === 0 || n > 16) {
    return data;
  }
  // slice（拷贝）而非 subarray（视图）：subtle.decrypt 以 .buffer 返回
  // ArrayBuffer，视图的 .buffer 是整个底层缓冲（含 padding），拷贝才能保证
  // 字节长度精确等于去 pad 后的明文。
  return data.slice(0, data.length - n);
}

export function aesCbc(
  data: Uint8Array | ArrayBuffer,
  key: Uint8Array | ArrayBuffer,
  iv: Uint8Array | ArrayBuffer,
  decrypt: boolean,
): Uint8Array {
  const keyU8 = toU8(key);
  requireAesKey(keyU8);
  let prev = toU8(iv).slice(0, 16);
  if (prev.length < 16) {
    const padded = new Uint8Array(16);
    padded.set(prev);
    prev = padded;
  }
  const cbc = new aesjs.ModeOfOperation.cbc(keyU8, prev);
  if (decrypt) {
    return pkcs7Unpad(cbc.decrypt(toU8(data)));
  }
  return cbc.encrypt(pkcs7Pad(toU8(data)));
}

// ---- SHA / HMAC / PBKDF2 / AES-GCM（@noble） ----

// 摘要路由：'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'（大小写/连字符宽松）
export function hashByName(algo: string): HashFn {
  const name = String(algo).toUpperCase().replace(/-/g, '');
  if (name === 'SHA1') {
    return sha1;
  }
  if (name === 'SHA256') {
    return sha256;
  }
  if (name === 'SHA384') {
    return sha384;
  }
  if (name === 'SHA512') {
    return sha512;
  }
  throw new Error(`unsupported hash: ${String(algo)}`);
}

export function digestBytes(algo: string, data: BytesInput): Uint8Array {
  return hashByName(algo)(toBytes(data));
}

export function hmacBytes(algo: string, key: BytesInput, data: BytesInput): Uint8Array {
  return hmac(hashByName(algo), toBytes(key), toBytes(data));
}

// 工作因子上限：插件跑在有超时的 JS 引擎里，无上限的迭代次数会把 worker 拖到被强杀。
// 2_000_000 覆盖常见口令学建议（SHA-256 约 60 万次）并留出余量。
export const PBKDF2_MAX_ITERS = 2_000_000;

export const PBKDF2_MAX_DKLEN = 1024;

export const RANDOM_MAX_BYTES = 65536;

const AES_KEY_LENGTHS = new Set([16, 24, 32]);

function requireAesKey(key: Uint8Array): void {
  if (!AES_KEY_LENGTHS.has(key.length)) {
    throw new Error(`aes: key length must be 16, 24, or 32, got ${key.length}`);
  }
}

// NIST SP 800-38D：只有 12 字节 nonce 走快速路径；其它长度要经 GHASH 派生 J0，
// 短 nonce 更容易碰撞。插件侧锁死 12 字节。
function requireGcmNonce(iv: Uint8Array): void {
  if (iv.length !== 12) {
    throw new Error(`aes-gcm: nonce length must be 12, got ${iv.length}`);
  }
}

export function pbkdf2Bytes(
  hashAlgo: string,
  password: BytesInput,
  salt: BytesInput,
  iterations: number,
  dkLen: number,
): Uint8Array {
  const iters = Math.floor(iterations);
  const len = Math.floor(dkLen);
  if (!Number.isFinite(iters) || iters < 1 || iters > PBKDF2_MAX_ITERS) {
    throw new Error(`pbkdf2: iterations must be 1..${PBKDF2_MAX_ITERS}`);
  }
  if (!Number.isFinite(len) || len < 1 || len > PBKDF2_MAX_DKLEN) {
    throw new Error(`pbkdf2: dkLen must be 1..${PBKDF2_MAX_DKLEN}`);
  }
  return pbkdf2(hashByName(hashAlgo), toBytes(password), toBytes(salt), { c: iters, dkLen: len });
}

// AES-GCM：encrypt 输出 ct||tag（tag 16 字节），decrypt 校验失败抛错
export function aesGcm(
  data: Uint8Array | ArrayBuffer,
  key: Uint8Array | ArrayBuffer,
  iv: Uint8Array | ArrayBuffer,
  aad: Uint8Array | ArrayBuffer | undefined,
  decrypt: boolean,
): Uint8Array {
  const keyU8 = toU8(key);
  const ivU8 = toU8(iv);
  requireAesKey(keyU8);
  requireGcmNonce(ivU8);
  const cipher = gcm(keyU8, ivU8, aad === undefined ? undefined : toU8(aad));
  const input = toU8(data);
  return decrypt ? cipher.decrypt(input) : cipher.encrypt(input);
}

// ---- subtle 适配 ----

// 算法名归一化（'aes-cbc' / {name: 'AES-CBC'} → 'AES-CBC'）
function algoName(algorithm: string | SubtleAlgo): string {
  const raw = typeof algorithm === 'string' ? algorithm : algorithm.name;
  if (typeof raw !== 'string' || raw === '') {
    throw new Error('subtle: missing algorithm name');
  }
  return raw.toUpperCase();
}

// 摘要参数解析：algorithm.hash ?? key._a.hash → 'SHA-256' 等
function algoHashName(algorithm: SubtleAlgo, key: SubtleKeyShape): string {
  let raw: unknown = algorithm.hash;
  if (raw === undefined && key._a !== undefined && key._a !== null) {
    raw = (key._a as SubtleAlgo).hash;
  }
  if (raw !== undefined && raw !== null && typeof raw === 'object') {
    raw = (raw as SubtleAlgo).name;
  }
  if (typeof raw !== 'string' || raw === '') {
    throw new Error('subtle: missing hash algorithm');
  }
  return raw;
}

// 常数时间比较（verify 后端；长度不同直接 false）
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function installCrypto(host: HostGlobal): void {
  let c = host.crypto;
  if (c === undefined) {
    c = {};
    host.crypto = c;
  }
  if (c.subtle === undefined) {
    c.subtle = {
      importKey: (_format: string, keyData: Uint8Array | ArrayBuffer, algorithm: unknown): Promise<SubtleKeyShape> =>
      Promise.resolve({ _k: toU8(keyData), _a: algorithm }),
      encrypt: (algorithm: SubtleAlgo, key: SubtleKeyShape, data: Uint8Array | ArrayBuffer): Promise<ArrayBuffer> => {
        const name = algoName(algorithm);
        const keyBytes = key._k as Uint8Array;
        if (algorithm.iv == null) {
          throw new Error('subtle: missing iv');
        }
        let out: Uint8Array;
        if (name === 'AES-GCM') {
          out = aesGcm(data, keyBytes, algorithm.iv, algorithm.additionalData, false);
        } else if (name === 'AES-CBC') {
          out = aesCbc(data, keyBytes, algorithm.iv, false);
        } else {
          throw new Error(`subtle.encrypt: unsupported algorithm ${name}`);
        }
        return Promise.resolve(out.slice().buffer as ArrayBuffer);
      },
      decrypt: (algorithm: SubtleAlgo, key: SubtleKeyShape, data: Uint8Array | ArrayBuffer): Promise<ArrayBuffer> => {
        const name = algoName(algorithm);
        const keyBytes = key._k as Uint8Array;
        if (algorithm.iv == null) {
          throw new Error('subtle: missing iv');
        }
        let out: Uint8Array;
        if (name === 'AES-GCM') {
          out = aesGcm(data, keyBytes, algorithm.iv, algorithm.additionalData, true);
        } else if (name === 'AES-CBC') {
          out = aesCbc(data, keyBytes, algorithm.iv, true);
        } else {
          throw new Error(`subtle.decrypt: unsupported algorithm ${name}`);
        }
        return Promise.resolve(out.slice().buffer as ArrayBuffer);
      },
      digest: (algorithm: string | SubtleAlgo, data: Uint8Array | ArrayBuffer): Promise<ArrayBuffer> =>
      Promise.resolve(digestBytes(algoName(algorithm), data).slice().buffer as ArrayBuffer),
      sign: (algorithm: SubtleAlgo, key: SubtleKeyShape, data: Uint8Array | ArrayBuffer): Promise<ArrayBuffer> => {
        const name = algoName(algorithm);
        if (name !== 'HMAC') {
          throw new Error(`subtle.sign: unsupported algorithm ${name}`);
        }
        const out = hmacBytes(algoHashName(algorithm, key), key._k as Uint8Array, data);
        return Promise.resolve(out.slice().buffer as ArrayBuffer);
      },
      verify: (algorithm: SubtleAlgo, key: SubtleKeyShape, signature: Uint8Array | ArrayBuffer,
        data: Uint8Array | ArrayBuffer): Promise<boolean> => {
        const name = algoName(algorithm);
        if (name !== 'HMAC') {
          throw new Error(`subtle.verify: unsupported algorithm ${name}`);
        }
        const expected = hmacBytes(algoHashName(algorithm, key), key._k as Uint8Array, data);
        return Promise.resolve(timingSafeEqual(toU8(signature), expected));
      },
      deriveBits: (algorithm: SubtleAlgo, key: SubtleKeyShape, length: number): Promise<ArrayBuffer> => {
        const name = algoName(algorithm);
        if (name !== 'PBKDF2') {
          throw new Error(`subtle.deriveBits: unsupported algorithm ${name}`);
        }
        const bits = Math.floor(length);
        if (!Number.isFinite(bits) || bits < 8 || bits % 8 !== 0) {
          throw new Error('deriveBits: length must be a positive multiple of 8');
        }
        const iterations = algorithm.iterations;
        if (typeof iterations !== 'number' || !Number.isFinite(iterations) || iterations < 1) {
          throw new Error('deriveBits: invalid iterations');
        }
        if (algorithm.salt == null) {
          throw new Error('deriveBits: missing salt');
        }
        const out = pbkdf2Bytes(
          algoHashName(algorithm, key),
          key._k as Uint8Array,
          algorithm.salt as Uint8Array,
          iterations,
          bits / 8,
        );
        return Promise.resolve(out.slice().buffer as ArrayBuffer);
      },
    };
  }
  if (typeof c.getRandomValues !== 'function') {
    c.getRandomValues = (array: Uint8Array): Uint8Array => {
      if (array == null || typeof array.length !== 'number') {
        throw new Error('getRandomValues: expected an array');
      }
      const len = array.length;
      if (!Number.isFinite(len) || len < 0 || len > RANDOM_MAX_BYTES) {
        throw new Error(`getRandomValues: length must be 0..${RANDOM_MAX_BYTES}`);
      }
      // 原生桥（设备 libohcrypto / 沙箱 node:crypto）要么填满，要么抛错。
      // 不把硬件熵和 Math.random 拼进同一块缓冲区。
      const nativeRandom = natives.randomBytes;
      if (typeof nativeRandom === 'function') {
        const bytes = nativeRandom(len);
        if (bytes == null || typeof bytes.length !== 'number' || bytes.length !== len) {
          throw new Error('getRandomValues: native random bridge returned a short buffer');
        }
        for (let i = 0; i < len; i++) {
          array[i] = bytes[i];
        }
        return array;
      }
      for (let i = 0; i < len; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    };
  }
}
