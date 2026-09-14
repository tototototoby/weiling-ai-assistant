# Docker Compose 部署

这篇教程面向想把微Link放在一台 Linux 服务器上长期运行的部署者。目标是：Web 只暴露给用户，Supervisor、SQLite、Bot 实例和沙箱工作区留在内部网络和权限受限的持久化目录。

## 资源建议

最低建议从以下配置开始：

- 4 vCPU；
- 8 GB RAM；
- 20 GB 可用磁盘（浏览器、模型缓存和工作区会继续增长）；
- Docker Engine 24+ 与 Compose v2；
- 能访问模型服务和已配置通道的出站网络。

多用户、浏览器并发或文件任务较多时，按沙箱池和 Browserless 并发增加内存，不要只增加容器重启次数。

## 1. 准备目录与配置

在服务器上取得一个版本化源码 checkout：

```bash
git clone <your-repository-url> weiling-ai-assistant
cd weiling-ai-assistant
cp infra/compose/.env.example infra/compose/.env
```

编辑 `infra/compose/.env`：

```dotenv
APP_BASE_URL=https://assistant.example.com
BETTER_AUTH_SECRET=<random-64-byte-secret>
WEB_ADMIN_EMAILS=admin@example.com
WEILING_DATA_ROOT=/srv/weiling/data
```

Browserless 是可选 Profile。需要网页自动化、截图、PDF 或海报导出时，再设置 `BROWSERLESS_TOKEN=<random-browserless-token>`。

如果当前版本仍读取旧的 `WECLAWS_DATA_ROOT` 或 `WECLAWS_INTERNAL_*`，在迁移完成前按兼容提示临时保留旧变量；公开版目标变量以 `.env.example` 和版本说明为准。

创建持久化目录并收紧权限：

```bash
sudo install -d -m 700 /srv/weiling/data
sudo install -d -m 700 /srv/weiling/data/sqlite /srv/weiling/data/instances
sudo install -d -m 700 /srv/weiling/data/sandbox-user-workspaces
sudo install -d -m 700 /srv/weiling/data/sandbox-runtime-private
sudo install -d -m 700 /srv/weiling/data/lark /srv/weiling/data/secrets
```

不要把这些目录提交 Git，也不要与无关服务共享。

## 2. 先渲染 Compose 配置

在真正启动前检查变量替换和镜像/挂载结果：

```bash
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml config
```

检查重点：

- `APP_BASE_URL` 是用户实际访问的 HTTPS 地址；
- `BETTER_AUTH_SECRET` 不是占位值；启用 Browserless 时，其 Token 也不是占位值；
- 只有 Web 暴露宿主机端口；
- SQLite、instances、沙箱工作区和 secrets 都落到预期目录；
- 没有把 Docker socket、宿主机根目录或 SSH 目录挂进容器。

## 3. 启动

源码构建方式：

```bash
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml build
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml up -d
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml ps
```

需要 Browserless 的部署使用：

```bash
docker compose --profile browserless --env-file infra/compose/.env -f infra/compose/docker-compose.yml up -d
```

生产镜像方式（仅在项目已发布并完成依赖许可审计后使用）：

```bash
docker compose \
  --env-file infra/compose/.env \
  -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.prod.yml pull

docker compose \
  --env-file infra/compose/.env \
  -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.prod.yml up -d
```

不要在生产中无意使用 `latest`；优先使用与 Release、源码 commit 和镜像 digest 对应的版本标签。

## 4. 首次初始化

```bash
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml logs --tail=200 web supervisor
```

打开 `APP_BASE_URL`，完成首个管理员注册。然后按 [上手指南](../getting-started.md) 创建模型配置、Bot 和通道授权。

## 5. 健康检查

```bash
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml ps
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml logs --since=10m web supervisor sandbox-runtime
curl -fsS https://assistant.example.com/login > /dev/null
```

健康检查通过不代表模型、聊天通道或主动投递已经可用；需要用测试账号做一次端到端消息和文件验证。

## 停止与清理

暂停服务但保留数据：

```bash
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml stop
```

删除容器但保留 named volume：

```bash
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml down
```

不要使用 `down -v`，除非已经确认有加密备份且明确要删除 Docker volume。删除数据前先读 [备份与恢复](../operations/backup-and-restore.md)。

## 浏览器服务

Browserless 用于浏览器自动化和部分截图/PDF任务。基础 Compose 不启动它，只有显式传入 `--profile browserless` 才启用；它只在内部 Compose 网络提供服务，不映射宿主机端口。Browserless 的许可是 SSPL-1.0/商业双许可，公开镜像和商业部署见 [第三方许可](../../THIRD_PARTY_NOTICES.md)。
