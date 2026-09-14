# 贡献指南

感谢你愿意让微Link变得更好。先从一个清楚的小改动开始：修一篇教程、补一个测试、改进一个 Skill，或者把一次真实部署中的坑写成 FAQ。

## 开始之前

- 阅读 [README](README.md)、[架构说明](docs/architecture.md) 和 [安全模型](docs/security-model.md)。
- 不要提交 `.env`、`storage/`、SQLite、二维码、通道登录态、模型 Key 或真实聊天截图。
- 如果改的是托管 Skill，请连同它依赖的 `references/`、`scripts/`、`assets/` 和许可证一起检查。
- 如果改的是第三方依赖、镜像或通道行为，请在 PR 中说明版本、来源、许可和验证方式。

## 本地开发

```bash
pnpm install
cp .env.example .env
pnpm db:generate
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm build
```

根据改动范围，也可以运行：

```bash
pnpm --filter @weiling-ai/web test
pnpm --filter @weiling-ai/supervisor test
pnpm --filter @weiling-ai/db test
pnpm test:fastagent-contract
```

如果当前 checkout 尚未完成包名迁移，上面的 `@weiling-ai/*` 过滤器可能仍暂时显示为旧包名；此时以工作区 `package.json` 的实际名称为准，并在 PR 中注明。

## 提交 Pull Request

PR 描述至少包含：

- 解决的问题和用户能感知的变化；
- 涉及的包、通道、Skill 或文档；
- 运行过的命令及结果；
- 是否需要迁移、环境变量、第三方许可或部署操作；
- 如果涉及 UI，提供脱敏截图；如果涉及安全，请不要公开漏洞细节。

保持提交小而独立，避免把无关格式化、重命名和行为改动混在一起。代码需要测试，文档需要可复制，错误信息需要能指导恢复。

## 文档与素材

文档以中文为主，使用真实但脱敏的命令、路径和界面名称。图片放在约定的 `assets/brand`、`assets/diagrams` 或 `assets/screenshots` 目录；生图只用于无文字的背景或装饰，产品文字、平台名称和架构标签使用确定性排版。

## 行为准则

参与项目即表示同意遵守 [行为准则](CODE_OF_CONDUCT.md)。
