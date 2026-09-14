# 升级与回滚

微Link的升级同时涉及源码、npm 依赖、Docker 镜像、SQLite migration、Bot 实例目录和通道状态。每次升级都先做可恢复的备份，再处理版本变更。

## 升级前

- 阅读目标 Release Notes、UPSTREAM 变化和第三方许可说明；
- 确认目标 tag、源码 commit、镜像 digest 和 Compose 文件匹配；
- 运行一次 [备份与恢复](backup-and-restore.md)；
- 确认可以进入维护窗口，通知用户暂停长任务和外部发送；
- 检查旧的 WECLAWS_* 变量是否需要迁移到 WEILING_*；
- 预留磁盘，尤其是镜像、浏览器缓存和沙箱工作区。

## 源码部署升级

```bash
git fetch --tags --prune
git checkout <release-tag>
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm build
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml build
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml up -d
```

先用测试账号验证 Web 登录、一个 Bot、一个通道、一个文件任务和一条提醒，再恢复正常流量。

## 镜像部署升级

```bash
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml pull
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml up -d
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml ps
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml logs --since=10m web supervisor
```

如果项目提供版本化镜像，使用 Release 对应 tag，不要用浮动 latest。镜像发布受 FastAgent、Browserless 和其他第三方许可审计约束。

## 品牌/目录迁移

从旧 WeClaws 目录迁移时：

1. 停止 Web、Supervisor 和 sandbox-runtime；
2. 备份整个数据根；
3. 运行迁移脚本的预览/检查模式；
4. 确认数据库、实例和沙箱工作区映射；
5. 只有明确传入 apply 后才执行目录/变量迁移；
6. 启动新版本并验证 Bot、通道和工作区；
7. 保留旧备份，直到至少一次完整恢复演练成功。

迁移脚本默认只做预览，源目录和目标目录必须是不同且互不包含的目录：

```bash
node scripts/migrate-weclaws-data.mjs --from /srv/weclaws/data --to /srv/weiling/data
node scripts/migrate-weclaws-data.mjs --from /srv/weclaws/data --to /srv/weiling/data --apply
```

`--apply` 只会复制到空的目标路径，不覆盖已有文件，源目录保持不变。迁移不应该清空数据库或生成一套新用户。若看到新空库、Bot 数量变成 0 或工作区消失，立即停止新版本并回滚。

## 回滚

优先回滚到上一份源码 tag/镜像 tag，保留故障日志：

```bash
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml stop
# 恢复经过验证的数据库/实例/工作区备份（不要覆盖未确认的生产目录）
# 将 Compose 或 checkout 指回 <previous-tag>
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml up -d
```

如果已经执行了不可逆数据库 migration，不能只换镜像就宣称回滚成功；应按 migration 说明恢复数据库快照或执行官方向后兼容路径。回滚后用测试账号验证登录、消息、文件和投递记录。

## 版本记录

每次升级记录：旧/新版本、commit、镜像 digest、migration、备份文件哈希、执行人、验证结果和未解决风险。
