// manifest.json 解析与校验。校验规则与宿主 PluginService.ets 的宽松解析对齐，
// 在发布前拦截非法字段（宿主只做防御性跳过，仓库侧应保证源头干净）。
import type { ManifestSetting, PluginManifest } from '@honyomi/plugin-sdk';

export const CONTENT_TYPES = ['manga', 'novel', 'video'];

export const SETTING_TYPES = ['switch', 'select', 'edit', 'password'];

// 插件身份只认 UUID v4（小写）。同一站点可以有多份插件，安装目录和偏好都按这个 id 区分。
export const PLUGIN_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function parseManifest(text: string): PluginManifest | null {
  try {
    const parsed = JSON.parse(text) as PluginManifest;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function validateSetting(s: ManifestSetting, source: string, errors: string[]): void {
  const at = (msg: string): void => {
    errors.push(`${source}: settings[${s.key ?? s.title ?? '?'}] ${msg}`);
  };
  if (typeof s.key !== 'string' || s.key === '') {
    at('key 不能为空');
    return;
  }
  if (typeof s.title !== 'string' || s.title === '') {
    at('title 不能为空');
  }
  if (typeof s.type !== 'string' || !SETTING_TYPES.includes(s.type)) {
    at(`type 必须是 ${SETTING_TYPES.join(' | ')}`);
  }
  if (s.type === 'select') {
    if (!Array.isArray(s.options) || s.options.length === 0) {
      at('select 必须提供非空 options');
    } else {
      for (const o of s.options) {
        if (typeof o.value !== 'string' || o.value === '') {
          at('options[].value 不能为空');
          break;
        }
      }
    }
  }
  if (s.sensitive !== undefined && typeof s.sensitive !== 'boolean') {
    at('sensitive 必须是 boolean');
  }
  if (s.hidden !== undefined && typeof s.hidden !== 'boolean') {
    at('hidden 必须是 boolean');
  }
  if (s.default !== undefined && typeof s.default !== 'string') {
    at('default 必须是 string');
  }
}

// 返回错误消息列表；空数组 = 通过
export function validateManifest(man: PluginManifest, source: string): string[] {
  const errors: string[] = [];
  const at = (msg: string): void => {
    errors.push(`${source}: ${msg}`);
  };
  if (typeof man.key !== 'string' || !PLUGIN_KEY.test(man.key)) {
    at('key 必须是小写 UUID v4');
  }
  if (typeof man.name !== 'string' || man.name === '') {
    at('name 不能为空');
  }
  if (typeof man.lang !== 'string' || man.lang === '') {
    at('lang 不能为空');
  }
  if (typeof man.version !== 'string' || man.version === '') {
    at('version 不能为空');
  }
  if (!Number.isInteger(man.versionCode) || (man.versionCode ?? 0) < 1) {
    at('versionCode 必须是 >= 1 的整数');
  }
  if (man.contentType !== undefined && !CONTENT_TYPES.includes(man.contentType)) {
    at(`contentType 必须是 ${CONTENT_TYPES.join(' | ')}`);
  }
  if (man.contentTypes !== undefined) {
    if (!Array.isArray(man.contentTypes) || man.contentTypes.length === 0) {
      at('contentTypes 必须是非空数组');
    } else {
      for (const t of man.contentTypes) {
        if (typeof t !== 'string' || !CONTENT_TYPES.includes(t)) {
          at(`contentTypes 每项必须是 ${CONTENT_TYPES.join(' | ')}`);
          break;
        }
      }
      // 同时声明单值主类型时，主类型必须包含在全量列表内
      if (Array.isArray(man.contentTypes) && man.contentType !== undefined &&
        !man.contentTypes.includes(man.contentType)) {
        at('contentType 必须包含在 contentTypes 中');
      }
    }
  }
  if (man.nsfw !== undefined && typeof man.nsfw !== 'boolean') {
    at('nsfw 必须是 boolean');
  }
  if (man.acgn !== undefined && typeof man.acgn !== 'boolean') {
    at('acgn 必须是 boolean');
  }
  if (man.bt !== undefined && typeof man.bt !== 'boolean') {
    at('bt 必须是 boolean');
  }
  if (man.supportsLatest !== undefined && typeof man.supportsLatest !== 'boolean') {
    at('supportsLatest 必须是 boolean');
  }
  if (man.minAppVersion !== undefined &&
    (!Number.isInteger(man.minAppVersion) || (man.minAppVersion ?? 0) < 1)) {
    at('minAppVersion 必须是 >= 1 的整数');
  }
  if (man.dslVersion !== undefined &&
    (!Number.isInteger(man.dslVersion) || (man.dslVersion ?? 0) < 1)) {
    at('dslVersion 必须是 >= 1 的整数');
  }
  if (man.baseUrl !== undefined && !/^https?:\/\//.test(man.baseUrl)) {
    at('baseUrl 必须是 http(s):// 地址');
  }
  if (man.icon !== undefined &&
    (man.icon.includes('..') || man.icon.includes('/') || man.icon.includes('\\'))) {
    at('icon 不能包含路径分隔符或 ..');
  }
  if (man.runtime !== undefined && (typeof man.runtime !== 'string' || man.runtime === '')) {
    at('runtime 必须是非空 string');
  }
  if (man.settings !== undefined) {
    if (!Array.isArray(man.settings)) {
      at('settings 必须是数组');
    } else {
      const seen = new Set<string>();
      for (const s of man.settings) {
        validateSetting(s, source, errors);
        if (typeof s.key === 'string') {
          if (seen.has(s.key)) {
            errors.push(`${source}: settings[${s.key}] key 重复`);
          }
          seen.add(s.key);
        }
      }
    }
  }
  return errors;
}

// manifest → 内容类型全量列表（主类型在前）：
// contentTypes 全量声明优先；未声明回退单值 contentType / manga。
// 宿主与发布链路共用同一语义，保证索引、安装、过滤一致。
export function contentTypesOf(man: PluginManifest): string[] {
  const list: string[] = [];
  if (Array.isArray(man.contentTypes)) {
    for (const t of man.contentTypes) {
      if (typeof t === 'string' && CONTENT_TYPES.includes(t) && !list.includes(t)) {
        list.push(t);
      }
    }
  }
  const primary = typeof man.contentType === 'string' && CONTENT_TYPES.includes(man.contentType)
    ? man.contentType
    : (list[0] ?? 'manga');
  if (!list.includes(primary)) {
    list.unshift(primary);
  }
  return list;
}
