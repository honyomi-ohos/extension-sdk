import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPO_CONTENT_WARNING_NSFW,
  REPO_CONTENT_WARNING_SAFE,
  decodeRepoIndex,
  encodeRepoIndex,
  looksLikeRepoProto,
  type RepoIndexExtension,
  type RepoIndexStore,
} from '../src/repo.ts';

function sampleStore(): RepoIndexStore {
  const ext: RepoIndexExtension = {
    name: '示例插件',
    packageName: '22222222-2222-4222-8222-222222222222',
    apkUrl: 'packs/22222222-2222-4222-8222-222222222222.honyomiplug',
    iconUrl: 'icons/22222222-2222-4222-8222-222222222222-ab12cd34ef.png',
    extensionLib: '2',
    versionCode: 7,
    versionName: '1.2.3',
    contentWarning: REPO_CONTENT_WARNING_NSFW,
    sources: [{
      id: 0,
      name: '示例插件',
      language: 'zh',
      homeUrl: 'https://example.com',
      mirrorUrls: ['https://mirror.example.com'],
      message: '',
    }],
    bt: true,
    // repeated 字段：多类型 + 顺序保持
    contentTypes: ['video', 'manga'],
    checksum: 'a'.repeat(64),
  };
  return {
    name: '示例仓库',
    badgeLabel: 'OFFICIAL',
    signingKey: '',
    website: 'https://repo.example.com',
    discord: '',
    extensions: [ext],
    extensionListUrl: '',
  };
}

test('repo index protobuf round-trips every field', () => {
  const store = sampleStore();
  const decoded = decodeRepoIndex(encodeRepoIndex(store));
  assert.deepEqual(decoded, store);
});

test('encoded index is binary (not sniffed as legacy JSON)', () => {
  const bytes = encodeRepoIndex(sampleStore());
  assert.equal(looksLikeRepoProto(bytes), true);
  assert.equal(looksLikeRepoProto(new TextEncoder().encode('{"plugins":[]}')), false);
  assert.equal(looksLikeRepoProto(new TextEncoder().encode('[1,2]')), false);
  assert.equal(looksLikeRepoProto(new Uint8Array(0)), false);
});

test('encode is deterministic', () => {
  const store = sampleStore();
  const a = encodeRepoIndex(store);
  const b = encodeRepoIndex(sampleStore());
  assert.deepEqual(Buffer.from(a), Buffer.from(b));
});

test('defaults decode to a valid empty store', () => {
  const store = sampleStore();
  store.name = '';
  store.website = '';
  store.discord = '';
  store.badgeLabel = '';
  store.extensions = [];
  const decoded = decodeRepoIndex(encodeRepoIndex(store));
  assert.equal(decoded.name, '');
  assert.equal(decoded.website, '');
  assert.deepEqual(decoded.extensions, []);
});

test('decode tolerates unknown fields (protobuf forward compatibility)', () => {
  const bytes = Array.from(encodeRepoIndex(sampleStore()));
  // 追加未知字段：field 15 varint（tag 0x78）、field 14 length-delimited（tag 0x72）
  const textBytes = Array.from(new TextEncoder().encode('x'));
  const unknown: number[] = [];
  unknown.push(0x78, 1);
  unknown.push(0x72, textBytes.length, ...textBytes);
  const decoded = decodeRepoIndex(new Uint8Array([...bytes, ...unknown]));
  assert.equal(decoded.extensions.length, 1);
  assert.equal(decoded.extensions[0].checksum, 'a'.repeat(64));
});

test('default content warning constants match mihon enum', () => {
  assert.equal(REPO_CONTENT_WARNING_SAFE, 1);
  assert.equal(REPO_CONTENT_WARNING_NSFW, 3);
});

test('repeated contentTypes round-trip preserves order and multiplicity', () => {
  const store = sampleStore();
  store.extensions[0].contentTypes = ['manga', 'novel', 'video'];
  const decoded = decodeRepoIndex(encodeRepoIndex(store));
  assert.deepEqual(decoded.extensions[0].contentTypes, ['manga', 'novel', 'video']);
});

test('omitted contentTypes decode to [manga]', () => {
  const store = sampleStore();
  store.extensions[0].contentTypes = [];
  const decoded = decodeRepoIndex(encodeRepoIndex(store));
  assert.deepEqual(decoded.extensions[0].contentTypes, ['manga']);
});
