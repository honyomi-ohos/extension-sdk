import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { zipFiles } from '../src/zip.ts';

test('zipFiles packs entries with valid structure', () => {
  const files = [
    { name: 'manifest.json', data: Buffer.from('{"key":"a"}', 'utf8') },
    { name: 'main.js', data: Buffer.from('module.exports={};', 'utf8') },
  ];
  const buf = zipFiles(files);
  // local header
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const nameLen = buf.readUInt16LE(26);
  const compSize = buf.readUInt32LE(18);
  const rawSize = buf.readUInt32LE(22);
  assert.equal(nameLen, 'manifest.json'.length);
  assert.equal(rawSize, 11);
  const name = buf.subarray(30, 30 + nameLen).toString('utf8');
  assert.equal(name, 'manifest.json');
  const data = inflateRawSync(buf.subarray(30 + nameLen, 30 + nameLen + compSize));
  assert.equal(data.toString('utf8'), '{"key":"a"}');
  // EOCD
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50);
  assert.equal(buf.readUInt16LE(eocd + 8), 2);
  assert.equal(buf.readUInt16LE(eocd + 10), 2);
});

test('zipFiles rejects path traversal entry names', () => {
  const data = Buffer.from('x');
  assert.throws(() => zipFiles([{ name: '../x', data }]), /unsafe zip entry name/);
  assert.throws(() => zipFiles([{ name: 'a/../../b', data }]), /unsafe zip entry name/);
  assert.throws(() => zipFiles([{ name: 'a\\b', data }]), /unsafe zip entry name/);
});

test('zipFiles handles empty and binary entries', () => {
  const binary = new Uint8Array([0, 1, 2, 255, 254]);
  const files = [
    { name: 'icon.png', data: Buffer.from(binary) },
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ];
  const buf = zipFiles(files);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.equal(buf.readUInt16LE(buf.length - 22 + 8), 2);
  // second entry: walk past first local record
  const n1 = buf.readUInt16LE(26);
  const c1 = buf.readUInt32LE(18);
  const off2 = 30 + n1 + c1;
  assert.equal(buf.readUInt32LE(off2), 0x04034b50);
  const n2 = buf.readUInt16LE(off2 + 26);
  assert.equal(buf.subarray(off2 + 30, off2 + 30 + n2).toString('utf8'), 'empty.txt');
  const c2 = buf.readUInt32LE(off2 + 18);
  const r2 = buf.readUInt32LE(off2 + 22);
  assert.equal(r2, 0);
  const emptyData = inflateRawSync(buf.subarray(off2 + 30 + n2, off2 + 30 + n2 + c2));
  assert.equal(emptyData.length, 0);
  // first entry roundtrip
  const first = inflateRawSync(buf.subarray(30 + n1, 30 + n1 + c1));
  assert.deepEqual([...first], [0, 1, 2, 255, 254]);
});
