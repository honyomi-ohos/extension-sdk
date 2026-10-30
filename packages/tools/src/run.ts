// honyomi-plugin test / e2e / lint / skill。
// 这些命令都从 @honyomi/plugin-tools 出发，调用方不需要再安装 sdk、测试包或 runtime。
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { check, checkStandalone } from './check.ts';
import {
  buildPlugin, buildPlugins, isPluginDirKey, listPluginDirs, matchPluginDirs, normalizeKey, pluginMainJs, pluginRel,
} from './build.ts';
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
  const shapes = new Set<string>();
  for (const rel of rels) {
    const depth = rel.split('/').length;
    shapes.add(`${Array.from({ length: depth }, () => '*').join('/')}/test/${file}`);
  }
  if (shapes.size === 0) {
    return [`*/test/${file}`];
  }
  return [...shapes];
}

export interface TestPlan {
  globs: string[];
  buildKeys: string[];
}

// 插件路径展开成该目录下的测试文件，并只构建这些插件。
// 带 * 的宽 glob 无法对应到单个插件，构建范围保持整个 catalog。
export function planTests(project: Project, args: string[], e2e: boolean): TestPlan {
  const file = e2e ? '*.e2e.test.ts' : '*.test.ts';
  if (project.kind === 'plugin') {
    return { globs: args.length > 0 ? args : [`test/${file}`], buildKeys: [] };
  }
  const requested = args.length > 0 ? args : (project.pluginKey === undefined ? [] : [project.pluginKey]);
  if (requested.length === 0) {
    return { globs: defaultTestGlobs(project, e2e), buildKeys: [] };
  }
  const globs: string[] = [];
  const buildKeys: string[] = [];
  let broad = false;
  for (const arg of requested) {
    const norm = normalizeKey(arg);
    if (isPluginDirKey(norm)) {
      for (const dir of matchPluginDirs(project.root, [norm])) {
        globs.push(`${pluginRel(project.root, dir)}/test/${file}`);
      }
      buildKeys.push(norm);
      continue;
    }
    const testAt = norm.indexOf('/test/');
    if (testAt > 0 && isPluginDirKey(norm.slice(0, testAt))) {
      globs.push(norm);
      buildKeys.push(norm.slice(0, testAt));
      continue;
    }
    globs.push(norm);
    broad = true;
  }
  return {
    globs: [...new Set(globs)],
    buildKeys: broad ? [] : [...new Set(buildKeys)],
  };
}

async function buildForTests(project: Project, buildKeys: string[]): Promise<void> {
  if (project.kind === 'plugin') {
    await buildPlugin(project.root, pluginMainJs(project.root));
    return;
  }
  await buildPlugins(project.root, buildKeys);
}

export async function runTests(project: Project, args: string[]): Promise<void> {
  ensureRuntimeShim();
  const plan = planTests(project, args, false);
  await buildForTests(project, plan.buildKeys);
  runNodeTest(project.root, plan.globs);
}

export async function runE2e(project: Project, args: string[]): Promise<void> {
  const modes = new Set(['replay', 'record', 'live']);
  const rest = [...args];
  let mode = 'replay';
  if (rest.length > 0 && modes.has(rest[0])) {
    mode = rest.shift() ?? 'replay';
  }
  for (const arg of rest) {
    if (arg.startsWith('-')) {
      throw new Error(`未知参数：${arg}`);
    }
  }
  const plan = planTests(project, rest, true);
  ensureRuntimeShim();
  await buildForTests(project, plan.buildKeys);
  runNodeTest(project.root, plan.globs, { HONYOMI_E2E: mode });
}

function oxlintBin(): string {
  return path.join(path.dirname(require.resolve('oxlint/package.json')), 'bin', 'oxlint');
}

function oxlintConfig(): string {
  return path.resolve(import.meta.dirname, '..', 'oxlintrc.jsonc');
}

export interface LintOptions {
  fix?: boolean;
  keys?: string[];
  paths?: string[];
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
  const paths = options?.paths !== undefined && options.paths.length > 0 ? options.paths : [root];
  args.push(...paths);
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

function hasTypeScript(dir: string): boolean {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) {
      continue;
    }
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) {
      if (hasTypeScript(file)) {
        return true;
      }
      continue;
    }
    if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      return true;
    }
  }
  return false;
}

function typecheckInclude(root: string, keys: string[]): string[] {
  const include: string[] = [];
  for (const dir of matchPluginDirs(root, keys)) {
    if (hasTypeScript(dir)) {
      include.push(`${pluginRel(root, dir)}/**/*.ts`);
    }
  }
  if (include.length === 0) {
    return [];
  }
  if (existsSync(path.join(root, 'globals.d.ts'))) {
    include.unshift('globals.d.ts');
  }
  return include;
}

function typecheck(root: string, include?: string[]): void {
  const tsconfig = path.join(root, 'tsconfig.json');
  if (!existsSync(tsconfig)) {
    console.log('lint: 无 tsconfig.json，跳过 tsc');
    return;
  }
  if (include !== undefined && include.length === 0) {
    console.log('tsc: 插件没有 TypeScript 源码，跳过');
    return;
  }
  const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
  const args = [tsc, '--pretty', 'false'];
  let temp: string | undefined;
  if (include !== undefined) {
    temp = path.join(root, `.honyomi-tsconfig-${process.pid}.json`);
    writeFileSync(temp, `${JSON.stringify({
      extends: './tsconfig.json',
      include,
      exclude: ['dist', 'node_modules'],
    }, null, 2)}\n`);
    args.push('-p', temp);
  } else {
    args.push('-p', tsconfig);
  }
  try {
    const result = spawnSync(process.execPath, args, {
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
  } finally {
    if (temp !== undefined) {
      rmSync(temp, { force: true });
    }
  }
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
  const keys = options?.keys ?? [];
  if (project.kind === 'plugin' && keys.length > 0) {
    throw new Error('独立插件目录不接受插件路径');
  }
  const scoped = project.kind === 'catalog' && keys.length > 0;
  const dirs = scoped ? matchPluginDirs(project.root, keys) : undefined;
  const failures = [
    stage(() => {
      if (project.kind === 'catalog') {
        check(project.root, keys);
      } else {
        checkStandalone(project.root);
      }
    }),
    stage(() => lintSources(project.root, {
      fix: options?.fix,
      paths: dirs,
    })),
    stage(() => typecheck(project.root, dirs === undefined ? undefined : typecheckInclude(project.root, keys))),
  ].filter((message): message is string => message !== undefined);
  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
  console.log('lint: ok');
}

export function typecheckProject(project: Project, keys: string[] = []): void {
  if (project.kind === 'plugin' || keys.length === 0) {
    typecheck(project.root);
    return;
  }
  typecheck(project.root, typecheckInclude(project.root, keys));
}
