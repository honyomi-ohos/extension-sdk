// honyomi-plugin test / e2e / lint / skill。
// 这些命令都从 @honyomi/plugin-tools 出发，调用方不需要再安装 sdk、测试包或 runtime。
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { check } from './check.ts';
import { buildPlugin, buildPlugins, listPluginDirs, pluginMainJs, pluginRel } from './build.ts';
import { parseManifest, validateManifest } from './manifest.ts';
import type { Project } from './project.ts';

const require = createRequire(import.meta.url);

export function skillDir(): string {
  return path.resolve(import.meta.dirname, '..', 'skills', 'honyomi-plugin-debug');
}

export function installSkill(destRoot: string): string[] {
  const source = skillDir();
  const targets = [
    path.join(destRoot, '.cursor', 'skills', 'honyomi-plugin-debug'),
    path.join(destRoot, '.deveco', 'skills', 'honyomi-plugin-debug'),
  ];
  for (const dest of targets) {
    cpSync(source, dest, { recursive: true });
  }
  return targets;
}

function runtimeDir(): string {
  return path.dirname(require.resolve('@honyomi/plugin-runtime/package.json'));
}

function ensureRuntimeShim(): void {
  const dir = runtimeDir();
  const result = spawnSync(process.execPath, [path.join(dir, 'build.mjs')], {
    cwd: dir,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error('运行时 shim 构建失败');
  }
}

function registerUrl(): string {
  return pathToFileURL(path.resolve(import.meta.dirname, '..', 'register.mjs')).href;
}

function runNodeTest(cwd: string, globs: string[], extraEnv?: Record<string, string>): void {
  const result = spawnSync(process.execPath, [
    '--import', registerUrl(),
    '--test',
    ...globs,
  ], {
    cwd,
    stdio: 'inherit',
    env: extraEnv === undefined ? process.env : { ...process.env, ...extraEnv },
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function defaultTestGlobs(project: Project, e2e: boolean): string[] {
  const file = e2e ? '*.e2e.test.ts' : '*.test.ts';
  if (project.kind === 'plugin') {
    return [`test/${file}`];
  }
  const rels = listPluginDirs(project.root).map((dir) => pluginRel(project.root, dir));
  const key = project.pluginKey;
  const matched = key === undefined
    ? rels
    : rels.filter((rel) => rel === key || rel.startsWith(`${key}/`));
  if (key !== undefined && matched.length === 0) {
    return [`${key}/test/${file}`];
  }
  const shapes = new Set<string>();
  for (const rel of matched) {
    const depth = rel.split('/').length;
    shapes.add(`${Array.from({ length: depth }, () => '*').join('/')}/test/${file}`);
  }
  if (shapes.size === 0) {
    return [`*/test/${file}`];
  }
  return [...shapes];
}

export async function runTests(project: Project, args: string[]): Promise<void> {
  ensureRuntimeShim();
  const globs = args.length > 0 ? args : defaultTestGlobs(project, false);
  if (project.kind === 'plugin') {
    await buildPlugin(project.root, pluginMainJs(project.root));
  } else {
    await buildPlugins(project.root, project.pluginKey !== undefined ? [project.pluginKey] : []);
  }
  runNodeTest(project.root, globs);
}

export async function runE2e(project: Project, args: string[]): Promise<void> {
  const modes = new Set(['replay', 'record', 'live']);
  let mode = 'replay';
  const rest = [...args];
  if (rest.length > 0 && modes.has(rest[0])) {
    mode = rest.shift() ?? 'replay';
  }
  const globs = rest.filter((arg) => !arg.startsWith('-')).map((glob) => {
    const norm = glob.split(path.sep).join('/');
    if (/^(?:src\/)?[A-Za-z0-9_-]+(?:\/[a-z0-9_]+)?$/.test(norm)) {
      return `${norm}/test/*.e2e.test.ts`;
    }
    return norm;
  });
  ensureRuntimeShim();
  if (project.kind === 'plugin') {
    await buildPlugin(project.root, pluginMainJs(project.root));
  } else if (globs.length === 1 && globs[0].includes('/test/')) {
    const key = globs[0].slice(0, globs[0].indexOf('/test/'));
    await buildPlugins(project.root, [key]);
  } else {
    await buildPlugins(project.root, project.pluginKey !== undefined ? [project.pluginKey] : []);
  }
  runNodeTest(
    project.root,
    globs.length > 0 ? globs : defaultTestGlobs(project, true),
    { HONYOMI_E2E: mode },
  );
}

function newestSourceMtime(dir: string): number {
  let latest = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts') && name !== 'main.js') {
      continue;
    }
    const file = path.join(dir, name);
    if (!statSync(file).isFile()) {
      continue;
    }
    latest = Math.max(latest, statSync(file).mtimeMs);
  }
  return latest;
}

function checkStandalone(dir: string): void {
  const problems: string[] = [];
  const manifestPath = path.join(dir, 'manifest.json');
  const man = parseManifest(readFileSync(manifestPath, 'utf8'));
  const source = path.basename(dir);
  if (man === null) {
    problems.push(`${source}: manifest.json 解析失败`);
  } else {
    problems.push(...validateManifest(man, source));
  }
  const js = pluginMainJs(dir);
  if (!existsSync(js)) {
    problems.push(`${source}: dist/main.js 缺失（honyomi-plugin build）`);
  } else if (statSync(js).mtimeMs < newestSourceMtime(dir)) {
    problems.push(`${source}: 构建产物落后于源码（honyomi-plugin build）`);
  }
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`lint: ${problem}`);
    }
    throw new Error(`lint 发现 ${problems.length} 处问题`);
  }
}

function oxlintBin(): string {
  return path.join(path.dirname(require.resolve('oxlint/package.json')), 'bin', 'oxlint');
}

function oxlintConfig(): string {
  return path.resolve(import.meta.dirname, '..', 'oxlintrc.jsonc');
}

export interface LintOptions {
  fix?: boolean;
}

// 插件 TypeScript / JavaScript。规则在 oxlintrc.jsonc：沙箱里不存在的全局和 Node 内建，
// 以及 TypeScript 正确性。测试文件可以 import node:。
// fix 只传 oxlint 的安全修复（--fix），不传会删掉带副作用语句的 --fix-dangerously。
export function lintSources(root: string, options?: LintOptions): void {
  const args = [
    oxlintBin(),
    '--config', oxlintConfig(),
    '--disable-nested-config',
    '--no-error-on-unmatched-pattern',
  ];
  if (options?.fix === true) {
    args.push('--fix');
  }
  args.push(root);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error('oxlint 未通过');
  }
  console.log('oxlint: ok');
}

function typecheck(root: string): void {
  const tsconfig = path.join(root, 'tsconfig.json');
  if (!existsSync(tsconfig)) {
    console.log('lint: 无 tsconfig.json，跳过 tsc');
    return;
  }
  const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
  const result = spawnSync(process.execPath, [tsc, '-p', tsconfig, '--pretty', 'false'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error('tsc 未通过');
  }
  console.log('tsc: ok');
}

function stage(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function lint(project: Project, options?: LintOptions): void {
  const failures = [
    stage(() => {
      if (project.kind === 'catalog') {
        check(project.root);
      } else {
        checkStandalone(project.root);
      }
    }),
    stage(() => lintSources(project.root, options)),
    stage(() => typecheck(project.root)),
  ].filter((message): message is string => message !== undefined);
  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
  console.log('lint: ok');
}

export function typecheckProject(project: Project): void {
  typecheck(project.root);
}
