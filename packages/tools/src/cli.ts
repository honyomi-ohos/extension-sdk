// 插件工具链 CLI。用户只安装 @honyomi/plugin-tools。
//   honyomi-plugin build [key...]   构建 TS 插件（无参数 = 全部）
//   honyomi-plugin test [glob...]   构建运行时与插件，再跑 node:test
//   honyomi-plugin e2e [replay|record|live] [glob...]
//   honyomi-plugin lint             manifest / 产物陈旧检测 + oxlint + tsc
//   honyomi-plugin check            只做 manifest 与产物陈旧检测
//   honyomi-plugin init <dir>       从 template 初始化独立插件工程
//   honyomi-plugin skill [path|install]
//   honyomi-plugin publish [--release <url>]  构建全部 TS 插件并发布仓库
//   honyomi-plugin serve [dir] [--host 127.0.0.1|0.0.0.0]
import * as path from 'node:path';
import { buildPlugin, buildPlugins, pluginMainJs } from './build.ts';
import { check } from './check.ts';
import { normalizeReleaseBase, publish } from './publish.ts';
import { initProject } from './init.ts';
import { locateProject } from './project.ts';
import { installSkill, lint, runE2e, runTests, skillDir, typecheckProject } from './run.ts';
import { serve } from './serve.ts';

function usage(): void {
  console.log('用法: honyomi-plugin <command> [args]');
  console.log('在 catalog 工程（package.json name 为 honyomi-catalog）：');
  console.log('  build [key...]   构建插件到 dist/<key>/main.js（无参数 = 全部）');
  console.log('  test [glob...]   构建后运行测试（缺省 */test/*.test.ts）');
  console.log('  e2e [mode]       replay | record | live，缺省 replay');
  console.log('  lint             manifest、产物陈旧检测、oxlint，以及 tsc');
  console.log('  typecheck        只运行 tsc');
  console.log('  check            manifest 校验 + 构建产物陈旧检测');
  console.log('  publish          构建并发布仓库到 dist/repo/');
  console.log('                   --release <url>  索引、插件包、图标都指向该 GitHub Release');
  console.log('  serve [dir] [--host 127.0.0.1|0.0.0.0]');
  console.log('在独立插件目录（manifest.json + main.ts）：');
  console.log('  build            输出 dist/main.js');
  console.log('  test / lint      同 catalog，范围是当前插件');
  console.log('任意目录：');
  console.log('  init <dir> [--name 显示名] [--lang zh]');
  console.log('                   初始化 catalog 工程，插件放在 <lang>/<id>/');
  console.log('  skill path       打印随包分发的 SKILL.md 目录');
  console.log('  skill install    复制到 .cursor/skills 与 .deveco/skills');
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
    lint(project);
    return;
  }
  if (cmd === 'typecheck') {
    typecheckProject(project);
    return;
  }
  if (project.kind === 'plugin') {
    if (cmd === 'build') {
      await buildPlugin(project.root, pluginMainJs(project.root));
      console.log(`built ${path.relative(project.root, pluginMainJs(project.root))}`);
      return;
    }
    usage();
    process.exitCode = 1;
    return;
  }
  if (cmd === 'build') {
    await buildPlugins(project.root, project.pluginKey !== undefined ? [project.pluginKey] : args);
  } else if (cmd === 'publish') {
    await buildPlugins(project.root, []);
    publish(project.root, parsePublishArgs(args));
  } else if (cmd === 'check') {
    check(project.root);
  } else if (cmd === 'serve') {
    const parsed = parseServeArgs(args, project.root);
    serve(parsed.dir, parsed.host);
  } else {
    usage();
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
