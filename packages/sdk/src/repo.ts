// 插件仓库索引 protobuf 编解码（schema 见 proto/repo_index.proto）。
// 字段布局对齐 mihon NetworkExtensionStore（字段 1-8 完全一致，9-11 为 Honyomi 扩展）：
// publish 输出 index.bin，宿主按首字节嗅探分流（'{'/'[' → 旧 JSON 索引，其余 → protobuf，
// 同 mihon ExtensionStoreService）。
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import protobuf from 'protobufjs';

// publish 输出的仓库索引文件名（serve 静态服务缺省文件）
export const REPO_INDEX_FILENAME = 'index.bin';

// 对齐 mihon ContentWarning 枚举值（kotlinx @ProtoNumber）
export const REPO_CONTENT_WARNING_UNSPECIFIED = 0;
export const REPO_CONTENT_WARNING_SAFE = 1;
export const REPO_CONTENT_WARNING_MIXED = 2;
export const REPO_CONTENT_WARNING_NSFW = 3;

// 对齐 repo_index.proto ContentType 枚举值
export const REPO_CONTENT_TYPE_MANGA = 1;
export const REPO_CONTENT_TYPE_NOVEL = 2;
export const REPO_CONTENT_TYPE_VIDEO = 3;

export interface RepoIndexSource {
  id: number;
  name: string;
  // 插件语言（manifest.lang，缺省 multi）
  language: string;
  // 站点首页（manifest.baseUrl）
  homeUrl: string;
  mirrorUrls: string[];
  message: string;
}

export interface RepoIndexExtension {
  name: string;
  // 插件 key（小写 UUID v4）
  packageName: string;
  // packs/<key>.honyomiplug（相对 index.bin），或 GitHub Release 绝对 https
  apkUrl: string;
  // icons/<key>-<hash>.png（相对 index.bin），或 GitHub Release 绝对 https
  iconUrl: string;
  // DSL 版本（manifest.dslVersion 的数字字符串）
  extensionLib: string;
  versionCode: number;
  versionName: string;
  contentWarning: number;
  // 单源：承载语言与站点首页
  sources: RepoIndexSource[];
  // BT 源标记（内容为种子/magnet 下载）
  bt: boolean;
  // 内容类型全量列表（manga | novel | video；可多选，[0] 为主类型）
  contentTypes: string[];
  // .honyomiplug sha256（hex）：release 安装强制校验
  checksum: string;
  // ACGN 内容源标记（宿主据此启用 Bangumi 相关系列匹配）
  acgn: boolean;
}

export interface RepoIndexStore {
  // 仓库展示名（缺省时宿主回退主机名）
  name: string;
  badgeLabel: string;
  signingKey: string;
  website: string;
  discord: string;
  extensions: RepoIndexExtension[];
  extensionListUrl: string;
}

// 首字节嗅探（对齐 mihon ExtensionStoreService）：'{'/'[' 开头按旧 JSON 索引，其余按 protobuf
export function looksLikeRepoProto(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return false;
  }
  const first = bytes[0];
  return first !== 0x5b && first !== 0x7b;
}

// schema 惰性加载（首次 encode/decode 时解析 .proto 并缓存）
let cachedType: protobuf.Type | undefined = undefined;

function repoIndexType(): protobuf.Type {
  if (cachedType === undefined) {
    const schema = readFileSync(
      path.join(import.meta.dirname, '..', 'proto', 'repo_index.proto'), 'utf8');
    cachedType = protobuf.parse(schema).root.lookupType('honyomi.repo.RepoIndex');
  }
  return cachedType;
}

export function encodeRepoIndex(store: RepoIndexStore): Uint8Array {
  const type = repoIndexType();
  // 空子消息不编码（proto3 缺省语义）
  const contact = store.website !== '' || store.discord !== ''
    ? { website: store.website, discord: store.discord }
    : undefined;
  const extensionList = store.extensions.length > 0
    ? {
      extensions: store.extensions.map((ext) => ({
        name: ext.name,
        packageName: ext.packageName,
        resources: { apkUrl: ext.apkUrl, iconUrl: ext.iconUrl },
        extensionLib: ext.extensionLib,
        versionCode: ext.versionCode,
        versionName: ext.versionName,
        contentWarning: ext.contentWarning,
        sources: ext.sources.map((src) => ({
          id: src.id,
          name: src.name,
          language: src.language,
          homeUrl: src.homeUrl,
          mirrorUrls: src.mirrorUrls,
          message: src.message,
        })),
        bt: ext.bt,
        contentTypes: ext.contentTypes.map((t) => contentTypeToProto(t)),
        checksum: ext.checksum,
        acgn: ext.acgn,
      })),
    }
    : undefined;
  const message = type.create({
    name: store.name,
    badgeLabel: store.badgeLabel,
    signingKey: store.signingKey,
    contact: contact,
    extensionList: extensionList,
    extensionListUrl: store.extensionListUrl,
  });
  return type.encode(message).finish();
}

// ---- decode 原始形态（protobufjs toObject 输出：缺省字段被省略） ----

interface RawSource {
  id?: number;
  name?: string;
  language?: string;
  homeUrl?: string;
  mirrorUrls?: string[];
  message?: string;
}

interface RawResources {
  apkUrl?: string;
  iconUrl?: string;
}

interface RawExtension {
  name?: string;
  packageName?: string;
  resources?: RawResources;
  extensionLib?: string;
  versionCode?: number;
  versionName?: string;
  contentWarning?: number;
  sources?: RawSource[];
  bt?: boolean;
  contentTypes?: number[];
  checksum?: string;
  acgn?: boolean;
}

interface RawStore {
  name?: string;
  badgeLabel?: string;
  signingKey?: string;
  contact?: { website?: string; discord?: string };
  extensionList?: { extensions?: RawExtension[] };
  extensionListUrl?: string;
}

function str(v: string | undefined): string {
  return typeof v === 'string' ? v : '';
}

function contentTypeToProto(v: string): number {
  if (v === 'novel') {
    return REPO_CONTENT_TYPE_NOVEL;
  }
  if (v === 'video') {
    return REPO_CONTENT_TYPE_VIDEO;
  }
  return REPO_CONTENT_TYPE_MANGA;
}

function contentTypeFromProto(v: number): string {
  if (v === REPO_CONTENT_TYPE_NOVEL) {
    return 'novel';
  }
  if (v === REPO_CONTENT_TYPE_VIDEO) {
    return 'video';
  }
  if (v === REPO_CONTENT_TYPE_MANGA) {
    return 'manga';
  }
  return '';
}

export function decodeRepoIndex(bytes: Uint8Array): RepoIndexStore {
  const type = repoIndexType();
  const raw = type.toObject(type.decode(bytes), { longs: Number, enums: Number }) as RawStore;
  const extensions: RepoIndexExtension[] = [];
  for (const item of raw.extensionList?.extensions ?? []) {
    const sources: RepoIndexSource[] = [];
    for (const src of item.sources ?? []) {
      sources.push({
        id: typeof src.id === 'number' ? src.id : 0,
        name: str(src.name),
        language: str(src.language),
        homeUrl: str(src.homeUrl),
        mirrorUrls: Array.isArray(src.mirrorUrls)
          ? src.mirrorUrls.filter((m): m is string => typeof m === 'string')
          : [],
        message: str(src.message),
      });
    }
    // 内容类型全量列表（主类型在前）；未声明回退 [manga]
    const contentTypes: string[] = [];
    for (const t of item.contentTypes ?? []) {
      const mapped = typeof t === 'number' ? contentTypeFromProto(t) : '';
      if (mapped !== '' && !contentTypes.includes(mapped)) {
        contentTypes.push(mapped);
      }
    }
    if (contentTypes.length === 0) {
      contentTypes.push('manga');
    }
    extensions.push({
      name: str(item.name),
      packageName: str(item.packageName),
      apkUrl: str(item.resources?.apkUrl),
      iconUrl: str(item.resources?.iconUrl),
      extensionLib: str(item.extensionLib),
      versionCode: typeof item.versionCode === 'number' ? item.versionCode : 0,
      versionName: str(item.versionName),
      contentWarning: typeof item.contentWarning === 'number' ? item.contentWarning : 0,
      sources: sources,
      bt: item.bt === true,
      contentTypes: contentTypes,
      checksum: str(item.checksum),
      acgn: item.acgn === true,
    });
  }
  return {
    name: str(raw.name),
    badgeLabel: str(raw.badgeLabel),
    signingKey: str(raw.signingKey),
    website: str(raw.contact?.website),
    discord: str(raw.contact?.discord),
    extensions: extensions,
    extensionListUrl: str(raw.extensionListUrl),
  };
}
