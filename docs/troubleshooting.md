# 排障指南

先保存版本、运行模式、最近日志和失败时间；不要一上来删库、删 Bot、删实例目录或重复提交会产生外部副作用的任务。

## 快速诊断

```bash
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml ps
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml logs --since=15m web supervisor
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml logs --since=15m sandbox-runtime browserless
```

本地开发则分别检查 Web、Supervisor 终端和 SQLite 路径。

## 启动失败

| 症状 | 可能原因 | 处理 |
| --- | --- | --- |
| Web 报 DATABASE_URL 缺失 | 根 .env 未加载或容器未注入 | 检查 .env、Compose env-file 和 DATABASE_URL。 |
| Web 报 APP_BASE_URL 无效 | URL 不是完整地址或代理地址不一致 | 使用实际访问的 http/https URL。 |
| 认证/注册异常 | BETTER_AUTH_SECRET 为空、仍是占位值或 SQLite 不可写 | 替换随机密钥，检查数据目录权限和日志。 |
| Supervisor 找不到 FastAgent | 依赖未安装、包版本不一致或 binary override 错误 | pnpm install --frozen-lockfile，检查 supervisor 依赖和运行时版本。 |
| sandbox-runtime 不健康 | 端口、权限、内存或高权限安全选项冲突 | 看容器日志、healthcheck、端口占用和宿主机策略。 |

## 消息不回复

按顺序排查：

1. Web 页面上 Bot 是否为 running/connected；
2. Supervisor 是否持续重启子进程；
3. 模型配置是否有 Key、模型名、接口类型和正确网关；
4. 通道凭据、事件订阅、网络和平台权限；
5. FastAgent 是否收到入站消息并输出 JSONL；
6. 文件/语音任务是否超过通道或沙箱限制。

先发一个“只回复固定短语、不要调用工具”的测试消息，避免把真实任务继续放大。

## 电脑关机后任务暂停

如果使用本地进程或 FASTAGENT_SANDBOX_MODE=disabled，任务可能依赖当前机器；服务端托管要求 Web、Supervisor 和 sandbox-runtime 都在服务器上运行。验证方式是关掉用户电脑后，从另一台设备查看服务器容器、Bot 状态和任务日志。

## 二维码失败

- 等待二维码重新生成，不要重复转发旧码；
- 检查二维码 URL 是否仍在有效期；
- 检查手机网络和平台登录确认；
- 检查实例目录是否持久化；
- 如果分享页跨域/跳转，确认 APP_BASE_URL 与代理地址一致。

## 跨端上下文不一致

检查 Bot ID、用户/员工绑定、通道授权、数据库挂载和实例目录。改名迁移后尤其注意是否误启动了新空数据库。参考 [共享上下文](shared-context.md)。

## 主动投递失败

主动消息可能被平台策略、绑定、连接状态、scope、内容类型或投递队列阻止。查看投递回执、通道日志和服务器时区；不要把“任务仍在后台运行”与“消息一定已送达”混为一谈。

## 文件和浏览器任务失败

- 检查沙箱工作区、磁盘、文件大小和相对路径；
- 检查 Browserless URL/Token、并发和超时；
- 检查对应 Skill 是否同步和命令是否存在；
- 不要把绝对路径、Cookie 或模型 Key贴到公开 Issue。

## 需要进一步帮助时

请提供：版本/tag、操作系统、运行方式、脱敏 Compose config、失败时间、相关服务最近日志和最小复现步骤。安全问题请走 SECURITY.md 私密通道。
