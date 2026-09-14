# 上手指南：从空目录到第一个 Bot

这篇教程的目标是：在本地或 Docker 环境中打开微Link，创建第一个管理员、模型配置和 Bot，并完成一条真实消息验证。

## 你会得到什么

- 一个可登录的 Web 控制台；
- 一条用户级模型配置；
- 一个由 Supervisor 托管的 Bot；
- 至少一个已验证的聊天通道；
- 一次能在日志和页面上追踪的完整请求。

## 前置条件

本地开发需要：

- Node.js 20+（推荐 20.18.1 或更新的 20.x）；
- pnpm 9；
- 一个可用的模型服务 API Key；
- 可选：微信、企业微信或飞书的测试账号和应用权限。

Docker 部署还需要 Docker Engine 和 Compose v2。生产部署请使用 Linux 服务器或经验证的 Linux VM，并先读 [生产加固](deployment/production-hardening.md)。

## A. 本地开发

在仓库根目录执行：

```bash
pnpm install
pnpm prepare:fastagent
cp .env.example .env
pnpm db:generate
pnpm db:migrate
```

编辑 `.env`，至少把以下值替换掉：

```dotenv
APP_BASE_URL=http://localhost:3000
BETTER_AUTH_SECRET=<random-secret>
WEB_ADMIN_EMAILS=admin@example.com
```

开发环境可以暂时使用 `FASTAGENT_SANDBOX_MODE=remote` 的默认本地配置；只想验证控制台时可使用 `disabled`，但这会关闭远程沙箱，不能代表生产配置。

分别打开两个终端：

```bash
pnpm dev:web
```

```bash
pnpm dev:supervisor
```

打开 <http://localhost:3000>。

## B. Docker Compose

```bash
cp infra/compose/.env.example infra/compose/.env
```

编辑 `infra/compose/.env`：

```dotenv
APP_BASE_URL=http://localhost:3000
BETTER_AUTH_SECRET=<random-secret>
BROWSERLESS_TOKEN=<random-token>
WEB_ADMIN_EMAILS=admin@example.com
```

启动并检查服务：

```bash
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml up -d
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml ps
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml logs --tail=100 web supervisor
```

默认只把 Web 端口暴露到宿主机。沙箱管理端口、SQLite 和实例目录不应该直接映射到公网。生产绑定目录、版本化镜像和反向代理见 [Docker Compose 部署](deployment/docker-compose.md)。

## 创建第一个管理员

1. 打开登录页并进入注册。
2. 使用 `WEB_ADMIN_EMAILS` 中的邮箱完成首个注册。
3. 首个用户落库后，后续用户按邀请码流程加入；不要把管理员邮箱白名单当作公开注册开关。
4. 登录控制台，确认能看到 Bot、模型和管理入口。

如果首个管理员注册失败，先检查 `APP_BASE_URL`、`BETTER_AUTH_SECRET`、SQLite 可写权限和 Web 日志；不要反复提交注册请求。

## 创建模型配置和 Bot

1. 进入设置，创建模型服务配置。
2. 填写服务商、模型名、API Key；网关地址和接口类型只有在你的服务商要求时填写。
3. 创建 Bot，选择刚才的模型配置。
4. 启动 Bot，等待 Supervisor 创建实例并把状态流回传到页面。
5. 按通道教程完成授权： [微信](channels/wechat.md)、[企业微信](channels/wecom.md)、[飞书](channels/feishu.md)。

模型 Key 属于用户自己的运行时配置，不会从仓库样例或镜像中自动得到。若模型配置能保存但消息失败，请先检查模型服务商的 Key、模型名、接口类型和出站网络。

## 第一次消息验证

建议先发送一条无副作用的短消息：

```text
请回复“微Link已连接”，不要调用工具，也不要发送文件。
```

验收三件事：

- 聊天入口收到回复；
- Web 页面显示 Bot 仍在运行；
- Supervisor 日志没有持续重启、认证失败或 JSONL 解析错误。

然后再验证托管：交代一个需要等待的任务，关闭自己的电脑或让本地终端退出，稍后从 Web 或已授权通道查看状态。不要用“浏览器页面关掉了”推断服务是否停止；要看服务端容器和 Supervisor 状态。

## 上线前验收

- [ ] `pnpm test`、`pnpm typecheck`、`pnpm build` 已运行并记录结果。
- [ ] 至少一个模型配置使用专门的测试 Key，且没有写入 Git。
- [ ] 微信、企业微信、飞书分别用测试账号完成收发验证；未验证的通道不要写成“稳定可用”。
- [ ] 同一个 Bot 在两个已配置通道中发送带唯一短语的消息，确认上下文是否按预期延续。
- [ ] 关闭用户电脑后，服务端仍能看到任务进程或明确的失败状态。
- [ ] 主动提醒能收到、能记录投递结果；通道不允许主动消息时，页面/日志能解释原因。
- [ ] 两个测试用户无法看到对方的聊天上下文、实例文件和模型 Key。
- [ ] 已读 [安全模型](security-model.md)，并完成生产加固清单。

## 下一步

- 想理解“网页为什么不直接拉进程”，读 [架构说明](architecture.md)。
- 想让微信、企微和飞书围绕同一个 Bot 工作，读 [共享上下文](shared-context.md)。
- 想把语音变成一张海报，读 [语音做海报](tutorials/voice-to-poster.md)。
- 想长期运行，读 [备份恢复](operations/backup-and-restore.md)、[升级回滚](operations/upgrade-and-rollback.md) 和 [监控](operations/monitoring.md)。
