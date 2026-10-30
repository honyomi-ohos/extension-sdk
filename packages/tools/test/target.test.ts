import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { matchPluginDirs } from '../src/build.ts';
import { check } from '../src/check.ts';
import { locateProject, pluginArgs } from '../src/project.ts';
import { lint, planTests, typecheckProject } from '../src/run.ts';

function withDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'honyomi-target-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writePlugin(root: string, rel: string, source: string): void {
  const dir = path.join(root, ...rel.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'main.ts'), source);
}

function catalog(root: string): void {
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'honyomi-catalog' }));
  writePlugin(root, 'src/zh/good', 'export const ready = true;\n');
  writePlugin(root, 'src/zh/bad', 'fetch(\'https://example.com\');\nexport const broken: number = \'x\';\n');
  writePlugin(root, 'src/en/other', 'export const other = true;\n');
  writePlugin(root, 'src/zh-Hans/iqiyi', 'export const hans = true;\n');
}

const GOOD_MANIFEST = {
  key: '33333333-3333-4333-8333-333333333333',
  name: 'Good',
  lang: 'zh',
  version: '1.0.0',
  versionCode: 1,
};

function readyCatalog(root: string): void {
  catalog(root);
  writeFileSync(path.join(root, 'src', 'zh', 'good', 'manifest.json'), JSON.stringify(GOOD_MANIFEST));
  writeFileSync(path.join(root, 'src', 'zh', 'bad', 'manifest.json'), '{}');
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'es2020',
      module: 'esnext',
      moduleResolution: 'bundler',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ['src/**/*.ts'],
  }));
  const js = path.join(root, 'dist', 'zh', 'good', 'main.js');
  mkdirSync(path.dirname(js), { recursive: true });
  writeFileSync(js, '/* built */\n');
}

function runCli(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const tools = path.resolve(import.meta.dirname, '..');
  const result = spawnSync(process.execPath, [
    '--import', pathToFileURL(path.join(tools, 'register.mjs')).href,
    path.join(tools, 'src', 'cli.ts'),
    ...args,
  ], { cwd, encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: `${result.stderr ?? ''}${result.error === undefined ? '' : result.error.message}`,
  };
}

test('plugin paths select one plugin, a language, and leave publish-sized globs alone', () => {
  withDir((root) => {
    catalog(root);
    const project = locateProject(root);
    assert.ok(project !== null);

    const one = planTests(project, ['zh/good'], false);
    assert.deepEqual(one.globs, ['src/zh/good/test/*.test.ts']);
    assert.deepEqual(one.buildKeys, ['zh/good']);

    const lang = planTests(project, ['zh'], false);
    assert.deepEqual(lang.buildKeys, ['zh']);
    assert.deepEqual(new Set(lang.globs), new Set([
      'src/zh/good/test/*.test.ts',
      'src/zh/bad/test/*.test.ts',
    ]));

    const hans = planTests(project, ['zh-Hans'], true);
    assert.deepEqual(hans.globs, ['src/zh-Hans/iqiyi/test/*.e2e.test.ts']);

    const file = planTests(project, ['./src/zh/good/test/good.test.ts'], false);
    assert.deepEqual(file.globs, ['src/zh/good/test/good.test.ts']);
    assert.deepEqual(file.buildKeys, ['src/zh/good']);

    const broad = planTests(project, ['src/zh/*/test/*.test.ts'], false);
    assert.deepEqual(broad.globs, ['src/zh/*/test/*.test.ts']);
    assert.deepEqual(broad.buildKeys, []);

    const here = locateProject(path.join(root, 'src', 'zh', 'good'));
    assert.ok(here !== null);
    assert.deepEqual(planTests(here, [], false).globs, ['src/zh/good/test/*.test.ts']);
    assert.deepEqual(pluginArgs(here, []), ['src/zh/good']);
    assert.deepEqual(pluginArgs(here, ['src/en/other']), ['src/en/other']);
    assert.deepEqual(pluginArgs(project, []), []);
  });
});

test('check, lint, and typecheck ignore sibling plugins', () => {
  withDir((root) => {
    readyCatalog(root);
    const good = locateProject(path.join(root, 'src', 'zh', 'good'));
    assert.ok(good !== null);
    check(root, pluginArgs(good, []));
    lint({ kind: 'catalog', root, pluginKey: 'src/zh/good' }, { keys: ['src/zh/good'] });
    typecheckProject({ kind: 'catalog', root }, ['zh/good']);
    assert.throws(() => check(root), /check 发现/);
    assert.throws(() => typecheckProject({ kind: 'catalog', root }, ['src/zh/bad']), /tsc 未通过/);
    assert.deepEqual(
      matchPluginDirs(root, ['zh']).map((dir) => path.basename(dir)).sort(),
      ['bad', 'good'],
    );
  });
});

test('cli check and lint target one plugin, and publish rejects a plugin path', () => {
  withDir((root) => {
    readyCatalog(root);
    const selected = runCli(root, ['check', 'src/zh/good']);
    assert.equal(selected.status, 0, selected.stderr);
    assert.match(selected.stdout, /check: ok/);

    const inside = runCli(path.join(root, 'src', 'zh', 'good'), ['lint']);
    assert.equal(inside.status, 0, inside.stderr);
    assert.match(inside.stdout, /lint: ok/);

    const all = runCli(root, ['check']);
    assert.equal(all.status, 1);
    assert.match(all.stderr, /check 发现/);

    const published = runCli(root, ['publish', 'src/zh/good']);
    assert.equal(published.status, 1);
    assert.match(published.stderr, /未知参数/);
    assert.equal(published.stdout.includes('built'), false);
    assert.equal(published.stdout.includes('no plugins'), false);
  });
});

test('a standalone plugin accepts check and rejects a plugin path', () => {
  withDir((dir) => {
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(GOOD_MANIFEST));
    writeFileSync(path.join(dir, 'main.ts'), 'export const ready = true;\n');
    mkdirSync(path.join(dir, 'dist'), { recursive: true });
    writeFileSync(path.join(dir, 'dist', 'main.js'), '/* built */\n');
    const ok = runCli(dir, ['check']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /check: ok/);
    const extra = runCli(dir, ['lint', 'src/zh/good']);
    assert.equal(extra.status, 1);
    assert.match(extra.stderr, /不接受插件路径/);
    const served = runCli(dir, ['serve']);
    assert.equal(served.status, 1);
    assert.match(served.stderr, /serve 托管/);
  });
});
