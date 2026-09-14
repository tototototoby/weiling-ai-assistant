# 文档索引

微Link的文档以“先跑起来，再理解，再加固”为顺序。第一次部署建议依次阅读：

1. [上手指南](getting-started.md)
2. [配置参考](configuration.md)
3. [选择一个通道](channels/wechat.md)
4. [安全模型](security-model.md)

## 按任务查找

| 任务 | 文档 |
| --- | --- |
| 本地开发、首个管理员、创建 Bot | [getting-started.md](getting-started.md) |
| 了解 Web、Supervisor、FastAgent、沙箱 | [architecture.md](architecture.md) |
| 让多个聊天入口共享一件事 | [shared-context.md](shared-context.md) |
| 管理 Skills 和工具 | [skills-and-tools.md](skills-and-tools.md) |
| 环境变量、目录、密钥 | [configuration.md](configuration.md) |
| 微信接入 | [channels/wechat.md](channels/wechat.md) |
| 企业微信接入 | [channels/wecom.md](channels/wecom.md) |
| 飞书接入 | [channels/feishu.md](channels/feishu.md) |
| 本地或服务器部署 | [deployment/docker-compose.md](deployment/docker-compose.md) |
| 生产安全 | [deployment/production-hardening.md](deployment/production-hardening.md)、[security-model.md](security-model.md) |
| 反向代理、TLS、SSE | [deployment/reverse-proxy-and-tls.md](deployment/reverse-proxy-and-tls.md) |
| 离线或受限网络 | [deployment/offline-installation.md](deployment/offline-installation.md) |
| 扫码领取微Link | [tutorials/claim-your-assistant-by-qr.md](tutorials/claim-your-assistant-by-qr.md) |
| 语音生成海报 | [tutorials/voice-to-poster.md](tutorials/voice-to-poster.md) |
| 主动提醒 | [tutorials/proactive-reminders.md](tutorials/proactive-reminders.md) |
| 接入飞书工具 | [tutorials/connect-feishu-tools.md](tutorials/connect-feishu-tools.md) |
| 备份、升级、监控 | [operations/backup-and-restore.md](operations/backup-and-restore.md)、[operations/upgrade-and-rollback.md](operations/upgrade-and-rollback.md)、[operations/monitoring.md](operations/monitoring.md) |
| 常见错误 | [troubleshooting.md](troubleshooting.md)、[faq.md](faq.md) |

## 文档约定

- 命令默认在仓库根目录执行；生产命令会明确标出服务器路径。
- `<placeholder>` 形式的内容需要替换，不能原样复制到生产环境。
- 看到旧的 `WECLAWS_*` 名称时，先看 [升级与迁移](operations/upgrade-and-rollback.md)；公开版目标名称为 `WEILING_*`，兼容期以实际代码为准。
- “支持”表示项目提供接入路径；能否使用仍取决于平台账号、版本、权限、网络和真实端到端验证。
- 文档中的二维码、域名、邮箱、Token 和聊天内容都应该是占位值。

## 公开素材清单

发布前由维护者补齐并脱敏以下素材；文档先固定文件名，避免图片替换时改动大量链接：

```text
assets/brand/wordmark-horizontal.svg
assets/brand/hero-1600x600.png
assets/brand/social-preview-1280x640.png
assets/brand/logo-mark-512.png
assets/brand/logo-mark-128.png
assets/brand/logo-mark-64.png
assets/brand/logo-mark-32.png
assets/diagrams/cross-channel-context.svg
assets/diagrams/architecture.svg
assets/diagrams/voice-to-poster.svg
```

图片应使用浅色、清爽、可读的确定性排版；生图模型只生成无文字的背景或装饰，不生成产品文字、平台 Logo、架构标签或可扫码二维码。
