# honyomi-plugin-debug

调试 Honyomi 内容源插件的 skill。随 `@honyomi/plugin-tools` 发布。

```bash
npx honyomi-plugin skill path
npx honyomi-plugin skill install
```

`skill path` 打印包内的 `SKILL.md` 目录。`skill install` 复制到当前项目的
`.cursor/skills/honyomi-plugin-debug/` 和 `.deveco/skills/honyomi-plugin-debug/`。

不复制时，把 skill 搜索路径指到已安装的包：

```json
"skills": {
  "paths": ["node_modules/@honyomi/plugin-tools/skills"]
}
```

该路径会递归扫描 `**/SKILL.md`。改完配置后重启 DevEco Code、Cursor 或 opencode。
