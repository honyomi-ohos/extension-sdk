import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  REPO_CONTENT_WARNING_SAFE,
  REPO_INDEX_FILENAME,
  decodeRepoIndex,
  looksLikeRepoProto,
} from '@honyomi/plugin-sdk/repo';
import { collect, normalizeReleaseBase, publish } from '../src/publish.ts';

function writePlugin(root: string, dirName: string, manifestText: string): void {
  const dir = path.join(root, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), manifestText);
  writeFileSync(path.join(dir, 'main.ts'), 'export {};\n');
  const dist = path.join(root, 'dist', dirName);
  mkdirSync(dist, { recursive: true });
  writeFileSync(path.join(dist, 'main.js'), 'module.exports={};\n');
}

const SAME_KEY = '11111111-1111-4111-8111-111111111111';
const GOOD_KEY = '22222222-2222-4222-8222-222222222222';

function validManifest(key: string): string {
  return JSON.stringify({
    key,
    name: key,
    lang: 'zh',
    version: '1.0.0',
    versionCode: 1,
    engine: 'jsvm',
  });
}

test('collect throws when the only plugin has a broken manifest', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'honyomi-pub-'));
  try {
    writePlugin(root, 'badplug', '{');
    assert.throws(() => collect(root), /解析失败/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('collect skips a broken manifest when a valid plugin exists', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'honyomi-pub-'));
  try {
    writePlugin(root, 'badplug', '{');
    writePlugin(root, 'goodplug', validManifest(GOOD_KEY));
    const items = collect(root);
    assert.equal(items.length, 1);
    assert.equal(items[0].man.key, GOOD_KEY);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('collect throws when the only plugin key is not a UUID v4', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'honyomi-pub-'));
  try {
    writePlugin(root, 'slug', validManifest('goodplug'));
    assert.throws(() => collect(root), /UUID v4/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('collect skips duplicate plugin keys and keeps the first', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'honyomi-pub-'));
  try {
    writePlugin(root, 'one', validManifest(SAME_KEY));
    writePlugin(root, 'two', validManifest(SAME_KEY));
    const items = collect(root);
    assert.equal(items.length, 1);
    assert.equal(items[0].man.key, SAME_KEY);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('collect returns a valid plugin that has a build output', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'honyomi-pub-'));
  try {
    writePlugin(root, 'goodplug', validManifest(GOOD_KEY));
    const items = collect(root);
    assert.equal(items.length, 1);
    assert.equal(items[0].man.key, GOOD_KEY);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publish emits a protobuf index.bin with a sha256 checksum matching each pack', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'honyomi-pub-'));
  try {
    writePlugin(root, 'goodplug', validManifest(GOOD_KEY));
    const published = publish(root);
    assert.equal(published, 1);
    const bytes = new Uint8Array(readFileSync(path.join(root, 'dist', 'repo', REPO_INDEX_FILENAME)));
    // 首字节嗅探：protobuf 索引不得以 '{' / '[' 开头（否则客户端会误判为旧 JSON 索引）
    assert.equal(looksLikeRepoProto(bytes), true);
    const store = decodeRepoIndex(bytes);
    assert.equal(store.extensions.length, 1);
    const entry = store.extensions[0];
    assert.equal(entry.packageName, GOOD_KEY);
    assert.equal(entry.name, GOOD_KEY);
    assert.equal(entry.versionCode, 1);
    assert.equal(entry.versionName, '1.0.0');
    assert.equal(entry.contentWarning, REPO_CONTENT_WARNING_SAFE);
    assert.equal(entry.bt, false);
    assert.deepEqual(entry.contentTypes, ['manga']);
    assert.equal(entry.extensionLib, '1');
    assert.equal(entry.sources.length, 1);
    assert.equal(entry.sources[0].language, 'zh');
    // checksum 必填：64 位 hex，且与 packs/<key>.honyomiplug 实际内容一致
    assert.match(entry.checksum, /^[0-9a-f]{64}$/);
    const pack = readFileSync(path.join(root, 'dist', 'repo', entry.apkUrl));
    assert.equal(entry.checksum, createHash('sha256').update(pack).digest('hex'));
    // 旧 JSON 索引不再发布
    assert.equal(existsSync(path.join(root, 'dist', 'repo', 'index.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('normalizeReleaseBase accepts a GitHub release download prefix', () => {
  const tag = 'https://github.com/owner/repo/releases/download/v1.0.0';
  assert.equal(normalizeReleaseBase(`${tag}/`), tag);
  assert.equal(normalizeReleaseBase(`${tag}/index.bin`), tag);
  assert.equal(
    normalizeReleaseBase('https://github.com/owner/repo/releases/latest/download/'),
    'https://github.com/owner/repo/releases/latest/download',
  );
  assert.throws(() => normalizeReleaseBase('http://github.com/owner/repo/releases/download/v1'), /https:\/\/github.com/);
  assert.throws(() => normalizeReleaseBase('https://example.com/owner/repo/releases/download/v1'), /https:\/\/github.com/);
  assert.throws(() => normalizeReleaseBase(`${tag}?raw=1`), /https:\/\/github.com/);
});

test('publish --release writes absolute GitHub release urls for pack and icon', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'honyomi-pub-'));
  try {
    writePlugin(root, 'goodplug', JSON.stringify({
      key: GOOD_KEY,
      name: GOOD_KEY,
      lang: 'zh',
      version: '1.0.0',
      versionCode: 1,
      engine: 'jsvm',
      icon: 'icon.png',
    }));
    writeFileSync(path.join(root, 'goodplug', 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    const base = 'https://github.com/owner/repo/releases/download/v1.0.0';
    publish(root, { releaseBase: `${base}/` });
    const bytes = new Uint8Array(readFileSync(path.join(root, 'dist', 'repo', REPO_INDEX_FILENAME)));
    const entry = decodeRepoIndex(bytes).extensions[0];
    assert.equal(entry.apkUrl, `${base}/${GOOD_KEY}.honyomiplug`);
    const iconHash = createHash('sha1').update(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])).digest('hex').slice(0, 10);
    assert.equal(entry.iconUrl, `${base}/${GOOD_KEY}-${iconHash}.png`);
    const pack = readFileSync(path.join(root, 'dist', 'repo', 'packs', `${GOOD_KEY}.honyomiplug`));
    assert.equal(entry.checksum, createHash('sha256').update(pack).digest('hex'));
    assert.equal(existsSync(path.join(root, 'dist', 'repo', 'icons', `${GOOD_KEY}-${iconHash}.png`)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publish honors manifest contentTypes list (multi-type plugin)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'honyomi-pub-'));
  try {
    writePlugin(root, 'multitype', JSON.stringify({
      key: GOOD_KEY,
      name: GOOD_KEY,
      lang: 'zh',
      version: '1.0.0',
      versionCode: 1,
      engine: 'jsvm',
      contentTypes: ['novel', 'video'],
    }));
    publish(root);
    const bytes = new Uint8Array(readFileSync(path.join(root, 'dist', 'repo', REPO_INDEX_FILENAME)));
    const store = decodeRepoIndex(bytes);
    assert.equal(store.extensions.length, 1);
    assert.deepEqual(store.extensions[0].contentTypes, ['novel', 'video']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
