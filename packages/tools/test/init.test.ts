import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { initProject } from '../src/init.ts';

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('init writes a catalog project with a sample plugin under the lang directory', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'honyomi-init-'));
  const dir = path.join(parent, 'my-sources');
  try {
    const created = initProject({ dir, name: 'My "Sources"', lang: 'zh' });
    assert.equal(created.dir, dir);
    assert.match(created.key, KEY);

    const manifestPath = path.join(dir, 'src', 'zh', 'example', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      key: string;
      name: string;
      lang: string;
      baseUrl: string;
    };
    assert.equal(manifest.key, created.key);
    assert.equal(manifest.name, 'My "Sources"');
    assert.equal(manifest.lang, 'zh');
    assert.equal(manifest.baseUrl, 'https://example.com');
    assert.equal(readFileSync(path.join(dir, 'src', 'zh', 'example', 'main.ts'), 'utf8').includes('__BASE__'), false);

    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      name: string;
      devDependencies: Record<string, string>;
    };
    assert.equal(pkg.name, 'honyomi-catalog');
    const spec = pkg.devDependencies['@honyomi/plugin-tools'] ?? '';
    assert.match(spec, /^file:/);
    const linked = path.resolve(dir, spec.slice('file:'.length));
    const linkedPkg = JSON.parse(readFileSync(path.join(linked, 'package.json'), 'utf8')) as { name?: string };
    assert.equal(linkedPkg.name, '@honyomi/plugin-tools');
    assert.throws(() => initProject({ dir, name: 'Again', lang: 'zh' }), /不是空的/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
