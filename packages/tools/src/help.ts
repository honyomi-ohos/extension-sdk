// honyomi-plugin --help / -h / help [command] 的说明文本。
import { SERVE_PORT } from './serve.ts';

const PLUGIN_SCOPE = [
  '插件路径写成 src/zh/example 或 zh/example。语言目录 src/zh 会带上该语言下的全部插件。',
  '在插件目录中执行且不写路径时，只处理当前插件。',
].join('\n');

const OVERVIEW = [
  '用法: honyomi-plugin <command> [args]',
  '       honyomi-plugin <command> --help',
  '在 catalog 工程（package.json name 为 honyomi-catalog）：',
  '  build [插件...]       构建到 dist/<key>/main.js（无参数 = 全部）',
  '  test [插件|glob...]   构建后运行测试',
  '  e2e [mode] [插件|glob...]',
  '                        replay | record | live，缺省 replay',
  '  lint [--fix] [插件...]',
  '                        manifest、产物陈旧检测、oxlint，以及 tsc',
  '  typecheck [插件...]   只运行 tsc',
  '  check [插件...]       manifest 校验 + 构建产物陈旧检测',
  '  publish [--release <url>]',
  '                        构建并发布整个仓库到 dist/repo/',
  '  serve [dir] [--host 127.0.0.1|0.0.0.0]',
  '                        托管整个 dist/repo',
  '在独立插件目录（manifest.json + main.ts）：',
  '  build / test / e2e / lint / typecheck / check',
  '                        只针对当前插件',
  '任意目录：',
  '  init <dir> [--name 显示名] [--lang zh]',
  '                        初始化 catalog 工程，插件放在 src/<lang>/<id>/',
  '  skill [path|install]  打印或安装调试 skill',
  PLUGIN_SCOPE,
  'publish 始终发布整个仓库。serve 始终托管整个 dist/repo。',
  '查看某一命令: honyomi-plugin <command> --help',
].join('\n');

const HELP: Record<string, string> = {
  '': OVERVIEW,
  build: [
    '用法: honyomi-plugin build [插件...]',
    '',
    '把插件编译成单文件。catalog 工程写到 dist/<key>/main.js，独立插件写到 dist/main.js。',
    '不写插件路径时：在插件目录里只构建当前插件，在 catalog 根目录构建全部。',
    'main.ts 会打包成自包含文件；手写 main.js 只压缩，不打包。',
    '',
    PLUGIN_SCOPE,
    '',
    '示例:',
    '  honyomi-plugin build',
    '  honyomi-plugin build src/zh/example',
    '  honyomi-plugin build zh/example src/en/other',
  ].join('\n'),
  test: [
    '用法: honyomi-plugin test [插件|glob...]',
    '',
    '先构建运行时 shim 和目标插件，再用 node:test 运行测试。',
    '插件路径会展开成 <插件>/test/*.test.ts，并且只构建这些插件。',
    '也可以直接传入测试文件或 glob。带 * 且对不上单个插件的 glob，会构建整个 catalog。',
    '不写参数时：在插件目录里只跑当前插件，在 catalog 根目录跑全部插件的测试。',
    '',
    PLUGIN_SCOPE,
    '',
    '示例:',
    '  honyomi-plugin test',
    '  honyomi-plugin test src/zh/example',
    '  honyomi-plugin test src/zh/example/test/example.test.ts',
  ].join('\n'),
  e2e: [
    '用法: honyomi-plugin e2e [replay|record|live] [插件|glob...]',
    '',
    '设置 HONYOMI_E2E 后运行 *.e2e.test.ts。缺省模式是 replay。',
    'record 与 live 会访问真站。',
    '插件路径会展开成 <插件>/test/*.e2e.test.ts，并且只构建这些插件。',
    '',
    PLUGIN_SCOPE,
    '',
    '示例:',
    '  honyomi-plugin e2e',
    '  honyomi-plugin e2e replay src/zh/example',
    '  honyomi-plugin e2e live zh/example',
  ].join('\n'),
  lint: [
    '用法: honyomi-plugin lint [--fix] [插件...]',
    '',
    '依次做 manifest 校验、构建产物陈旧检测、oxlint 和 tsc。',
    '前面的失败不会跳过后面的检查。',
    'oxlint 报告未使用变量等代码问题，并禁止插件文件使用沙箱里没有的全局',
    '（fetch、window、document、process 等）或 import Node 内建模块。test/ 里可以 import node:。',
    '',
    '--fix  应用 oxlint 的安全自动修复，不会删除带副作用的语句。',
    '',
    PLUGIN_SCOPE,
    '',
    '示例:',
    '  honyomi-plugin lint',
    '  honyomi-plugin lint src/zh/example',
    '  honyomi-plugin lint --fix zh/example',
  ].join('\n'),
  typecheck: [
    '用法: honyomi-plugin typecheck [插件...]',
    '',
    '只运行 tsc。写了插件路径时，只检查这些插件的 TypeScript。',
    '没有 tsconfig.json 时跳过。插件没有 .ts 源码时也跳过。',
    '',
    PLUGIN_SCOPE,
    '',
    '示例:',
    '  honyomi-plugin typecheck',
    '  honyomi-plugin typecheck src/zh/example',
  ].join('\n'),
  check: [
    '用法: honyomi-plugin check [插件...]',
    '',
    '校验 manifest，并检查构建产物是否缺失或落后于源码。',
    'catalog 工程看 dist/<key>/main.js。独立插件看该目录的 dist/main.js。',
    '',
    PLUGIN_SCOPE,
    '',
    '示例:',
    '  honyomi-plugin check',
    '  honyomi-plugin check src/zh/example',
  ].join('\n'),
  publish: [
    '用法: honyomi-plugin publish [--release <url>]',
    '',
    '构建全部插件，并写出整个仓库的 dist/repo/（.honyomiplug、图标、index.bin）。',
    '始终发布整个 catalog，不接受插件路径。在插件目录里执行也发布整个仓库。',
    '',
    '--release <url>',
    '  索引、插件包、图标都写成该 GitHub Release 的下载地址。',
    '  例如 https://github.com/owner/repo/releases/download/v1.0.0',
    '  也接受 .../releases/latest/download。末尾多写的 / 或 /index.bin 会去掉。',
    '  应用里的仓库地址是同一个前缀下的 index.bin。',
    '',
    '示例:',
    '  honyomi-plugin publish',
    '  honyomi-plugin publish --release https://github.com/owner/repo/releases/download/v1.0.0',
  ].join('\n'),
  serve: [
    '用法: honyomi-plugin serve [dir] [--host 127.0.0.1|0.0.0.0]',
    '',
    `静态托管仓库索引。缺省目录是 dist/repo，监听 0.0.0.0:${SERVE_PORT}。`,
    '请求 / 时返回 index.bin。',
    '--host 只接受 127.0.0.1、localhost 或 0.0.0.0。localhost 按 127.0.0.1 监听。',
    '在插件目录里执行时，托管的仍是 catalog 的 dist/repo。',
    '需要在 catalog 工程中运行。',
    '',
    '示例:',
    '  honyomi-plugin serve',
    '  honyomi-plugin serve --host 127.0.0.1',
    '  honyomi-plugin serve dist/repo',
  ].join('\n'),
  init: [
    '用法: honyomi-plugin init <目录> [--name 显示名] [--lang zh]',
    '',
    '在空目录（或尚不存在的目录）生成 catalog 工程。示例插件在 src/<lang>/example/。',
    '--name  示例插件的显示名，同时写入 package.json 的描述。缺省用目录名。',
    '--lang  src/ 下的语言目录名。缺省 zh。',
    '',
    '示例:',
    '  honyomi-plugin init my-sources --name "My Sources" --lang zh',
  ].join('\n'),
  skill: [
    '用法: honyomi-plugin skill [path|install]',
    '',
    'path     打印随包分发的 SKILL.md 目录。缺省就是 path。',
    'install  复制到当前目录的 .cursor/skills 与 .deveco/skills。',
    '',
    '示例:',
    '  honyomi-plugin skill',
    '  honyomi-plugin skill path',
    '  honyomi-plugin skill install',
  ].join('\n'),
};

export const HELP_COMMANDS = Object.keys(HELP).filter((name) => name !== '');

export function helpText(command: string): string | null {
  return HELP[command] ?? null;
}

function helpNames(args: string[]): string[] {
  return args.filter((arg) => arg !== '--help' && arg !== '-h');
}

// 是帮助请求时返回要说明的命令名，空字符串表示总览。不是帮助请求时返回 undefined。
export function requestedHelp(cmd: string | undefined, args: string[]): string | undefined {
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    const names = helpNames(args);
    if (names.length > 1) {
      throw new Error(`多余参数：${names[1]}`);
    }
    return names[0] ?? '';
  }
  if (cmd !== undefined && (args.includes('--help') || args.includes('-h'))) {
    return cmd;
  }
  return undefined;
}
