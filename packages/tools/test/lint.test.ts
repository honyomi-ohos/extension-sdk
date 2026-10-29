import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { lintSources } from '../src/run.ts';

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

test('plugin source cannot use ts-ignore', () => {
  withDir((dir) => {
    writeFileSync(path.join(dir, 'main.ts'), '// @ts-ignore\nconst n: number = \'x\';\n');
    assert.throws(() => lintSources(dir), /oxlint 未通过/);
  });
});
