# __NAME__

插件放在 `src/<lang>/<id>/`。`dist` 在工程根目录，不和语言目录并列。

```
src/
  __LANG__/
    example/
      manifest.json
      main.ts
      test/
dist/
  __LANG__/
    example/
      main.js
```

同一语言下继续加插件，就是再放一个目录，例如 `src/__LANG__/another/`。换语言就再加一层，例如 `src/en/example/`。

```bash
npm install
npm test
```

`npm run publish` 打成仓库索引。
