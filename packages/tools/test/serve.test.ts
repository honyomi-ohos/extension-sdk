import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { resolveServedPath } from '../src/serve.ts';

test('serve path stays inside the root', () => {
  const root = path.resolve(path.sep, 'honyomi-serve-root', 'repo');
  const ok = resolveServedPath(root, '/packs/demo.honyomiplug');
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.file, path.join(root, 'packs', 'demo.honyomiplug'));
  }

  const sibling = resolveServedPath(root, '/../repo-evil/secret.txt');
  assert.deepEqual(sibling, { ok: false, status: 400 });

  const encoded = resolveServedPath(root, '/%2e%2e/%2e%2e/windows/win.ini');
  assert.deepEqual(encoded, { ok: false, status: 400 });

  const broken = resolveServedPath(root, '/%');
  assert.deepEqual(broken, { ok: false, status: 400 });

  const slash = resolveServedPath(root, '/');
  assert.equal(slash.ok, true);
  if (slash.ok) {
    assert.equal(slash.file, path.join(root, 'index.bin'));
  }
});
