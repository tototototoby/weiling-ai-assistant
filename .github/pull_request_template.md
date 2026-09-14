## 这次改动解决什么问题

<!-- 用用户能感知的语言说明背景、预期和实际变化。 -->

## 改动范围

- [ ] Web / API
- [ ] Supervisor / 通道
- [ ] 数据库 / migration
- [ ] sandbox-runtime / Docker
- [ ] Skill / 工具
- [ ] 文档 / 素材
- [ ] 安全 / 依赖 / 许可证

## 验证

请列出实际运行过的命令及结果：

```text
pnpm test
pnpm typecheck
pnpm build
```

涉及通道、文件、主动消息或 Docker 时，请写明使用的测试账号、环境和 E2E 结果（不要放凭据）。

## 兼容性与发布影响

- [ ] 需要数据库迁移
- [ ] 需要环境变量或目录迁移
- [ ] 影响旧的 WECLAWS_* 兼容变量
- [ ] 影响第三方许可证或镜像发布
- [ ] 需要更新 README/教程/CHANGELOG
- [ ] 无上述影响

## 隐私与安全确认

- [ ] 没有提交 `.env`、SQLite、storage、登录态、二维码、Cookie、Token 或真实聊天内容。
- [ ] 新增的外部副作用有明确确认、幂等和失败处理。
- [ ] 新增依赖、Skill、镜像或素材的来源与许可证已核对。
- [ ] 如果这是安全问题，我没有在 PR 中公开利用细节，而是按 SECURITY.md 私下报告。
