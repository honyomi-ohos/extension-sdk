// 发布：收集 catalog/ 全部插件（统一取 dist 构建产物），
// 产物 .honyomiplug（manifest.json + main.js [+ icon]）+ index.bin（protobuf）+ 内容哈希图标。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, } from 'node:fs';
import * as path from 'node:path';
import type { PluginManifest } from '@honyomi/plugin-sdk';
import {
  encodeRepoIndex, REPO_CONTENT_WARNING_NSFW, REPO_CONTENT_WARNING_SAFE, REPO_INDEX_FILENAME,
  type RepoIndexExtension, type RepoIndexSource, type RepoIndexStore,
} from '@honyomi/plugin-sdk/repo';
import { parseManifest, validateManifest, contentTypesOf } from './manifest.ts';
import { distMainJs, listPluginDirs, outputKey, pluginRel } from './build.ts';
import { zipFiles } from './zip.ts';

export interface PublishItem {
  dir: string;
  man: PluginManifest;
  origin: string;

  // 实际打包的 main.js：TS 插件 → dist 构建产物；手写插件 → 目录内 main.js
  mainJs: string;
}

export interface SkippedPlugin {
  plugin: string;
  reason: string;
}

export interface CollectResult {
  items: PublishItem[];
  skipped: SkippedPlugin[];
}

function resolveMainJs(root: string, dir: string): string {
  return distMainJs(root, outputKey(root, dir));
}

function skipReason(errors: string[], label: string): string {
  const prefix = `${label}: `;
  return errors.map((error) => error.startsWith(prefix) ? error.slice(prefix.length) : error).join('；');
}

function readManifest(dir: string): { text: string } | { reason: string } {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return { reason: '缺少 manifest.json' };
  }
  try {
    return { text: readFileSync(manifestPath, 'utf8') };
  } catch {
    return { reason: 'manifest.json 读取失败' };
  }
}

// 文件不全或校验不通过的插件记入 skipped，不中断其余插件。
export function collect(root: string): CollectResult {
  const byKey = new Map<string, PublishItem>();
  const skipped: SkippedPlugin[] = [];
  for (const dir of listPluginDirs(root)) {
    const label = pluginRel(root, dir);
    const manifest = readManifest(dir);
    if (!('text' in manifest)) {
      skipped.push({ plugin: label, reason: manifest.reason });
      continue;
    }
    const man = parseManifest(manifest.text);
    if (man === null) {
      skipped.push({ plugin: label, reason: 'manifest.json 解析失败' });
      continue;
    }
    const itemErrors = validateManifest(man, label);
    if (itemErrors.length > 0) {
      skipped.push({ plugin: label, reason: skipReason(itemErrors, label) });
      continue;
    }
    if (byKey.has(man.key)) {
      skipped.push({ plugin: label, reason: `key 重复 ${man.key}` });
      continue;
    }
    const mainJs = resolveMainJs(root, dir);
    if (!existsSync(mainJs)) {
      skipped.push({ plugin: label, reason: '缺少构建产物（honyomi-plugin build）' });
      continue;
    }
    byKey.set(man.key, {
      dir,
      man,
      origin: 'catalog',
      mainJs,
    });
  }
  return { items: [...byKey.values()], skipped };
}

export interface ValidateResult {
  item: PublishItem;
  errors: string[];
}

export function validateAll(items: PublishItem[]): ValidateResult[] {
  return items.map((item) => {
    const label = `${item.man.key} (${path.relative(process.cwd(), item.dir)})`;
    return { item, errors: validateManifest(item.man, label) };
  });
}

export interface PublishOptions {
  // GitHub Release 下载前缀。设置后 index.bin 里的插件包和图标都写成该前缀下的绝对地址，
  // 应用把仓库地址设为 <前缀>/index.bin 后，索引、插件包、图标都从这次 Release 的附件获取。
  releaseBase?: string;
}

// https://github.com/<owner>/<repo>/releases/download/<tag>
// https://github.com/<owner>/<repo>/releases/latest/download
const RELEASE_BASE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/releases\/(?:download\/([A-Za-z0-9._+-]+)|latest\/download)$/;

const RELEASE_USAGE = 'publish --release 需要 GitHub Release 下载前缀，例如 https://github.com/owner/repo/releases/download/v1.0.0 或 https://github.com/owner/repo/releases/latest/download';

function githubSlug(name: string): boolean {
  return !name.includes('..') && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(name);
}

export function normalizeReleaseBase(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(RELEASE_USAGE);
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' ||
    parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error(RELEASE_USAGE);
  }
  let pathname = parsed.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/index.bin')) {
    pathname = pathname.slice(0, -'/index.bin'.length);
  }
  const base = `https://github.com${pathname}`;
  const matched = RELEASE_BASE.exec(base);
  const tag = matched?.[3];
  const tagOk = tag === undefined || (!tag.includes('..') && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(tag));
  if (matched === null || !githubSlug(matched[1]) || !githubSlug(matched[2]) || !tagOk) {
    throw new Error(RELEASE_USAGE);
  }
  return base;
}

function releaseFileUrl(releaseBase: string, filename: string): string {
  return `${releaseBase}/${filename}`;
}

export function publish(root: string, options: PublishOptions = {}): number {
  const repo = path.join(root, 'dist', 'repo');
  const packs = path.join(repo, 'packs');
  mkdirSync(packs, { recursive: true });
  // 清空旧图标（含旧哈希命名），由 packOne 按内容哈希重新生成
  const iconsDir = path.join(repo, 'icons');
  if (existsSync(iconsDir)) {
    for (const name of readdirSync(iconsDir)) {
      unlinkSync(path.join(iconsDir, name));
    }
  }

  const collected = collect(root);
  const skipped = [...collected.skipped];
  // 二次校验失败的插件同样跳过，留到结尾和前面的跳过项一起通知。
  const validItems: PublishItem[] = [];
  for (const result of validateAll(collected.items)) {
    if (result.errors.length === 0) {
      validItems.push(result.item);
      continue;
    }
    skipped.push({
      plugin: pluginRel(root, result.item.dir),
      reason: result.errors.map((error) => {
        const at = error.indexOf(': ');
        return at === -1 ? error : error.slice(at + 2);
      }).join('；'),
    });
  }

  const releaseBase = options.releaseBase !== undefined ? normalizeReleaseBase(options.releaseBase) : undefined;
  const repoEntries: RepoIndexExtension[] = [];
  for (const item of validItems) {
    repoEntries.push(packOne(root, item, releaseBase));
  }
  repoEntries.sort((a, b) => {
    const la = a.sources.length > 0 ? a.sources[0].language : '';
    const lb = b.sources.length > 0 ? b.sources[0].language : '';
    if (la !== lb) {
      return la.localeCompare(lb);
    }
    return a.name.localeCompare(b.name);
  });

  // 仓库索引（protobuf index.bin，字段布局对齐 mihon NetworkExtensionStore）
  const store: RepoIndexStore = {
    name: '',
    badgeLabel: '',
    signingKey: '',
    website: '',
    discord: '',
    extensions: repoEntries,
    extensionListUrl: '',
  };
  writeFileSync(path.join(repo, REPO_INDEX_FILENAME), encodeRepoIndex(store));
  // 清理旧 JSON 索引（已切换 protobuf，避免 serve 双格式混淆）
  const legacyIndex = path.join(repo, 'index.json');
  if (existsSync(legacyIndex)) {
    unlinkSync(legacyIndex);
  }

  const byOrigin: Record<string, number> = {};
  for (const item of validItems) {
    byOrigin[item.origin] = (byOrigin[item.origin] ?? 0) + 1;
  }
  const summary: Record<string, unknown> = {
    published: repoEntries.length,
    byOrigin,
    index: `plugins/dist/repo/${REPO_INDEX_FILENAME}`,
    serve: `npm run serve  ->  http://127.0.0.1:8765/${REPO_INDEX_FILENAME}`,
  };
  if (releaseBase !== undefined) {
    summary.release = releaseBase;
    summary.repoUrl = releaseFileUrl(releaseBase, REPO_INDEX_FILENAME);
  }
  if (skipped.length > 0) {
    summary.skipped = skipped.map((item) => `${item.plugin}: ${item.reason}`);
  }
  console.log(JSON.stringify(summary, null, 2));
  if (skipped.length > 0) {
    console.log(`跳过 ${skipped.length} 个插件：`);
    for (const item of skipped) {
      console.log(`  ${item.plugin}: ${item.reason}`);
    }
  }
  return repoEntries.length;
}

function packOne(root: string, item: PublishItem, releaseBase?: string): RepoIndexExtension {
  const repo = path.join(root, 'dist', 'repo');
  const man = item.man;
  const files = [
    { name: 'manifest.json', data: readFileSync(path.join(item.dir, 'manifest.json')) },
    { name: 'main.js', data: readFileSync(item.mainJs) },
  ];
  const iconName = man.icon !== undefined ? String(man.icon) : '';
  let iconEntry: string | undefined;
  if (iconName && !iconName.includes('..') && !iconName.includes('/') && !iconName.includes('\\')) {
    const iconPath = path.join(item.dir, iconName);
    if (existsSync(iconPath) && statSync(iconPath).isFile()) {
      const iconData = readFileSync(iconPath);
      files.push({ name: iconName, data: iconData });
      // 按内容哈希命名：图标内容变化 → URL 变化，绕过客户端图片缓存
      const hash = createHash('sha1').update(iconData).digest('hex').slice(0, 10);
      const iconsDir = path.join(repo, 'icons');
      mkdirSync(iconsDir, { recursive: true });
      const iconFile = `${man.key}-${hash}.png`;
      writeFileSync(path.join(iconsDir, iconFile), iconData);
      iconEntry = releaseBase !== undefined
        ? releaseFileUrl(releaseBase, iconFile)
        : `icons/${iconFile}`;
    }
  }
  const packFile = `${man.key}.honyomiplug`;
  const dest = path.join(repo, 'packs', packFile);
  const packData = zipFiles(files);
  writeFileSync(dest, packData);
  // 插件对应站点首页（manifest.baseUrl）：供客户端“安装前预览网站”使用
  const site = man.baseUrl !== undefined && /^https?:\/\//.test(String(man.baseUrl))
    ? String(man.baseUrl)
    : '';
  const source: RepoIndexSource = {
    id: 0,
    name: man.name,
    language: man.lang || 'multi',
    homeUrl: site,
    mirrorUrls: [],
    message: '',
  };
  const entry: RepoIndexExtension = {
    name: man.name,
    packageName: man.key,
    apkUrl: releaseBase !== undefined ? releaseFileUrl(releaseBase, packFile) : `packs/${packFile}`,
    iconUrl: iconEntry ?? '',
    extensionLib: String(man.dslVersion ?? 1),
    versionCode: Number(man.versionCode) || 1,
    versionName: man.version || '1.0.0',
    contentWarning: man.nsfw === true ? REPO_CONTENT_WARNING_NSFW : REPO_CONTENT_WARNING_SAFE,
    sources: [source],
    bt: man.bt === true,
    contentTypes: contentTypesOf(man),
    checksum: createHash('sha256').update(packData).digest('hex'),
    acgn: man.acgn === true,
  };
  return entry;
}
