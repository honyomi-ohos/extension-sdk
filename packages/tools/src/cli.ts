// 插件工具链 CLI。用户只安装 @honyomi/plugin-tools。
// 除 publish 外，catalog 命令都接受插件路径（src/zh/example 或 zh/example）。
// 在插件目录里执行且不写路径时，同样只处理当前插件。publish 始终覆盖整个仓库。
//   honyomi-plugin build [插件...]
//   honyomi-plugin test [插件|glob...]
//   honyomi-plugin e2e [replay|record|live] [插件|glob...]
//   honyomi-plugin lint [--fix] [插件...]
//   honyomi-plugin typecheck [插件...]
//   honyomi-plugin check [插件...]
//   honyomi-plugin init <dir>
//   honyomi-plugin skill [path|install]
//   honyomi-plugin publish [--release <url>]
//   honyomi-plugin serve [dir] [--host 127.0.0.1|0.0.0.0]
//   honyomi-plugin --help
//   honyomi-plugin <command> --help
import * as path from 'node:path';
import { buildPlugin, buildPlugins, pluginMainJs } from './build.ts';
import { check, checkStandalone } from './check.ts';
import { helpText, requestedHelp } from './help.ts';
import { normalizeReleaseBase, publish } from './publish.ts';
import { initProject } from './init.ts';
import { locateProject, pluginArgs } from './project.ts';
import { installSkill, lint, runE2e, runTests, skillDir, typecheckProject } from './run.ts';
import { serve } from './serve.ts';

function usage(): void {
  const text = helpText('');
  if (text !== null) {
    console.log(text);
  }
}

function showHelp(command: string): void {
  const text = helpText(command);
  if (text === null) {
    console.error(`未知命令：${command}`);
    usage();
    process.exitCode = 1;
    return;
  }
  console.log(text);
}

function parseServeArgs(args: string[], root: string): { dir: string; host: string } {
  let dir: string | undefined;
  let host = '0.0.0.0';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--host') {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error('serve --host 需要 127.0.0.1 或 0.0.0.0');
      }
      if (value !== '127.0.0.1' && value !== '0.0.0.0' && value !== 'localhost') {
        throw new Error('serve --host 只允许 127.0.0.1、localhost 或 0.0.0.0');
      }
      host = value === 'localhost' ? '127.0.0.1' : value;
      i++;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`未知参数：${arg}`);
    }
    if (dir !== undefined) {
      throw new Error(`多余参数：${arg}`);
    }
    dir = arg;
  }
  return {
    dir: dir !== undefined ? path.resolve(dir) : path.join(root, 'dist', 'repo'),
    host,
  };
}

function parseInitArgs(args: string[]): { dir: string; name?: string; lang: string } {
  let dir: string | undefined;
  let name: string | undefined;
  let lang = 'zh';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--name' || arg === '--lang') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error(`init ${arg} 需要一个值`);
      }
      if (arg === '--name') {
        name = value;
      } else {
        lang = value;
      }
      i++;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`未知参数：${arg}`);
    }
    if (dir !== undefined) {
      throw new Error(`多余参数：${arg}`);
    }
    dir = arg;
  }
  if (dir === undefined) {
    throw new Error('用法: honyomi-plugin init <目录> [--name 显示名] [--lang zh]');
  }
  return { dir: path.resolve(dir), name, lang };
}

function parseLintArgs(args: string[]): { fix: boolean; keys: string[] } {
  let fix = false;
  const keys: string[] = [];
  for (const arg of args) {
    if (arg === '--fix') {
      fix = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`未知参数：${arg}`);
    }
    keys.push(arg);
  }
  return { fix, keys };
}

function positional(args: string[]): string[] {
  for (const arg of args) {
    if (arg.startsWith('-')) {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

function parsePublishArgs(args: string[]): { releaseBase?: string } {
  let releaseBase: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--release') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('publish --release 需要 GitHub Release 下载前缀');
      }
      releaseBase = normalizeReleaseBase(value);
      i++;
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }
  return { releaseBase };
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const topic = requestedHelp(cmd, args);
  if (topic !== undefined) {
    showHelp(topic);
    return;
  }
  if (cmd === 'init') {
    const parsed = parseInitArgs(args);
    const created = initProject({
      dir: parsed.dir,
      name: parsed.name ?? path.basename(parsed.dir),
      lang: parsed.lang,
    });
    console.log(`created ${created.dir}`);
    console.log(`key ${created.key}`);
    console.log('下一步: cd 进该目录，执行 npm install && npm test');
    console.log(`示例插件在 src/${parsed.lang}/example/`);
    return;
  }
  if (cmd === 'skill') {
    const action = args[0] ?? 'path';
    if (action === 'path') {
      console.log(skillDir());
      return;
    }
    if (action === 'install') {
      for (const dest of installSkill(process.cwd())) {
        console.log(`skill installed ${dest}`);
      }
      return;
    }
    usage();
    process.exitCode = 1;
    return;
  }
  const project = locateProject(process.cwd());
  if (project === null) {
    usage();
    throw new Error('请在插件目录（manifest.json + main.ts）或 catalog 工程中运行');
  }
  if (cmd === 'test') {
    await runTests(project, args);
    return;
  }
  if (cmd === 'e2e') {
    await runE2e(project, args);
    return;
  }
  if (cmd === 'lint') {
    const parsed = parseLintArgs(args);
    lint(project, { fix: parsed.fix, keys: pluginArgs(project, parsed.keys) });
    return;
  }
  if (cmd === 'typecheck') {
    typecheckProject(project, pluginArgs(project, positional(args)));
    return;
  }
  if (cmd === 'check') {
    if (project.kind === 'plugin') {
      pluginArgs(project, positional(args));
      checkStandalone(project.root, 'check');
      console.log('check: ok');
      return;
    }
    check(project.root, pluginArgs(project, positional(args)));
    return;
  }
  if (cmd === 'build') {
    if (project.kind === 'plugin') {
      pluginArgs(project, positional(args));
      await buildPlugin(project.root, pluginMainJs(project.root));
      console.log(`built ${path.relative(project.root, pluginMainJs(project.root))}`);
      return;
    }
    await buildPlugins(project.root, pluginArgs(project, positional(args)));
    return;
  }
  if (cmd === 'publish') {
    // 始终发布整个 catalog。插件路径会在这里被拒绝，不会先去构建。
    const options = parsePublishArgs(args);
    await buildPlugins(project.root, []);
    publish(project.root, options);
    return;
  }
  if (cmd === 'serve') {
    if (project.kind === 'plugin') {
      usage();
      throw new Error('serve 托管 catalog 的 dist/repo，请在 catalog 工程中运行');
    }
    const parsed = parseServeArgs(args, project.root);
    serve(parsed.dir, parsed.host);
    return;
  }
  usage();
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
