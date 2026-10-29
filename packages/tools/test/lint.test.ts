import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { lint, lintSources } from '../src/run.ts';

function withDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'honyomi-lint-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('plugin source may use $ and a local document', () => {
  withDir((dir) => {
    writeFileSync(path.join(dir, 'main.ts'), [
      'const body = $.http.get(\'https://example.com\');',
      'const document = $.html(body, \'https://example.com/\');',
      'document.select(\'.item\');',
      'fetchBytes(\'https://example.com/a.bin\');',
      '',
    ].join('\n'));
    mkdirSync(path.join(dir, 'test'));
    writeFileSync(path.join(dir, 'test', 'main.test.ts'), [
      'import test from \'node:test\';',
      'import * as path from \'node:path\';',
      'test(\'path\', () => { path.join(\'a\', \'b\'); });',
      '',
    ].join('\n'));
    lintSources(dir);
  });
});

test('plugin source cannot call fetch, reach through globalThis, or import node builtins', () => {
  withDir((dir) => {
    writeFileSync(path.join(dir, 'main.ts'), 'fetch(\'https://example.com\');\n');
    assert.throws(() => lintSources(dir), /oxlint 未通过/);
  });
  withDir((dir) => {
    writeFileSync(path.join(dir, 'main.ts'), 'globalThis.fetch(\'https://example.com\');\n');
    assert.throws(() => lintSources(dir), /oxlint 未通过/);
  });
  withDir((dir) => {
    writeFileSync(path.join(dir, 'main.ts'), 'import fs from \'node:fs\';\nfs.readFileSync(\'x\');\n');
    assert.throws(() => lintSources(dir), /oxlint 未通过/);
  });
});

test('lint still reports oxlint when the manifest check fails', () => {
  withDir((dir) => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'honyomi-catalog' }));
    mkdirSync(path.join(dir, 'demo'));
    writeFileSync(path.join(dir, 'demo', 'manifest.json'), '{}');
    writeFileSync(path.join(dir, 'demo', 'main.ts'), 'const unused = 1;\nfetch(\'https://example.com\');\n');
    assert.throws(
      () => lint({ kind: 'catalog', root: dir }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /check 发现/);
        assert.match(err.message, /oxlint 未通过/);
        return true;
      },
    );
  });
});

test('lintSources --fix applies oxlint safe fixes', () => {
  withDir((dir) => {
    const file = path.join(dir, 'main.ts');
    writeFileSync(file, [
      'const opts = { headers: { a: \'1\' } };',
      'const headers = { ...(opts.headers ?? {}) };',
      'console.log(headers);',
      '',
    ].join('\n'));
    lintSources(dir, { fix: true });
    const text = readFileSync(file, 'utf8');
    assert.equal(text.includes('??'), false);
    assert.match(text, /\.\.\.opts\.headers/);
  });
});

test('plugin source cannot use ts-ignore', () => {
  withDir((dir) => {
    writeFileSync(path.join(dir, 'main.ts'), '// @ts-ignore\nconst n: number = \'x\';\n');
    assert.throws(() => lintSources(dir), /oxlint 未通过/);
  });
});
