# Honyomi extension SDK

插件作者工具链，用 npm workspace 管理，通过 npm 发布。

用户只依赖 `@honyomi/plugin-tools`。测试、SDK、lint、skill、template 和运行时 shim 都由这个包带上。说明见 `packages/tools/README.md`。

```bash
npx honyomi-plugin init my-sources --name "My Sources" --lang zh
```

生成的是 catalog 工程，示例插件在 `src/zh/example/`。`dist` 在工程根，不和语言目录并列。

| 目录 | 包 | 谁安装 |
| --- | --- | --- |
| `packages/tools` | `@honyomi/plugin-tools` | 插件作者，唯一直接依赖。命令与工程布局见该目录 README |
| `packages/sdk` | `@honyomi/plugin-sdk` | tools 的依赖。插件类型、助手和仓库索引见该目录 README |
| `packages/testing` | `@honyomi/plugin-test` | tools 的依赖。沙箱、fixture 和 e2e 见该目录 README |
| `packages/runtime` | `@honyomi/plugin-runtime` | tools 的依赖。shim 构建见该目录 README。宿主用 `node build.mjs --rawfile <outfile>` 写入应用 rawfile |

```bash
npm install
npm test
npm run typecheck
```

发布（需已登录 npm，scope `@honyomi`）：

```bash
node scripts/publish.mjs
```

脚本按 sdk、runtime、testing、tools 的顺序发布，并把 `file:` 依赖改写成版本号，结束后还原 `package.json`。
