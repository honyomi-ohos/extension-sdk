import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { locateProject } from '../src/project.ts';
import { buildPlugin, pluginMainJs } from '../src/build.ts';

test('locateProject distinguishes a catalog project, one of its plugins, and a standalone plugin', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'honyomi-proj-'));
  try {
    mkdirSync(path.join(root, 'demo'), { recursive: true });
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'honyomi-catalog' }));
    writeFileSync(path.join(root, 'demo', 'manifest.json'), '{}');
    writeFileSync(path.join(root, 'demo', 'main.ts'), 'export {};\n');

    assert.deepEqual(locateProject(root), { kind: 'catalog', root });
    assert.deepEqual(locateProject(path.join(root, 'demo')), {
      kind: 'catalog',
      root,
      pluginKey: 'demo',
    });

    mkdirSync(path.join(root, 'zh', 'example', 'test'), { recursive: true });
    writeFileSync(path.join(root, 'zh', 'example', 'manifest.json'), '{}');
    writeFileSync(path.join(root, 'zh', 'example', 'main.ts'), 'export {};\n');
    assert.deepEqual(locateProject(path.join(root, 'zh', 'example', 'test')), {
      kind: 'catalog',
      root,
      pluginKey: 'zh/example',
    });
    assert.deepEqual(locateProject(path.join(root, 'zh')), {
      kind: 'catalog',
      root,
      pluginKey: 'zh',
    });

    const alone = mkdtempSync(path.join(tmpdir(), 'honyomi-alone-'));
    try {
      writeFileSync(path.join(alone, 'manifest.json'), '{}');
      writeFileSync(path.join(alone, 'main.ts'), 'export {};\n');
      assert.deepEqual(locateProject(alone), { kind: 'plugin', root: alone });
    } finally {
      rmSync(alone, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a standalone plugin builds to dist/main.js', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'honyomi-plug-'));
  try {
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      key: '33333333-3333-4333-8333-333333333333',
      name: 'Example',
      lang: 'zh',
      version: '1.0.0',
      versionCode: 1,
      engine: 'jsvm',
    }));
    writeFileSync(path.join(dir, 'main.ts'), [
      'const ext = {',
      '  getPopularWorks() { return { works: [], hasNextPage: false }; },',
      '  getSearchWorks() { return { works: [], hasNextPage: false }; },',
      '};',
      'globalThis.module.exports = ext;',
      '',
    ].join('\n'));
    await buildPlugin(dir, pluginMainJs(dir));
    assert.equal(pluginMainJs(dir), path.join(dir, 'dist', 'main.js'));
    assert.equal(existsSync(pluginMainJs(dir)), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
