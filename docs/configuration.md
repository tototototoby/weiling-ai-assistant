# 配置参考

微Link有两份常用环境文件：

- 仓库根 `.env`：本地开发时给 Web、Supervisor 和数据库使用；
- `infra/compose/.env`：Docker Compose 插值和容器运行配置。

两份文件都只应保存占位值或本机/服务器私密值，不提交 Git。公开版把数据根目录改为 `WEILING_DATA_ROOT`；Supervisor 内部桥接、Lark 和部分 FastAgent 运行时变量仍可能保留 `WECLAWS_*` 名称。迁移期间旧变量是否可用，以当前版本的兼容代码为准，看到兼容警告就按 [升级与回滚](operations/upgrade-and-rollback.md) 处理。

## 核心 Web 配置

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | SQLite URL，开发默认 `file:./storage/sqlite/db.sqlite`，Compose 容器默认位于 `/app/storage/sqlite/db.sqlite`。 |
| `APP_BASE_URL` | 是 | 用户实际访问的完整 URL；反向代理后必须使用外部 HTTPS 地址。 |
| `BETTER_AUTH_SECRET` | 是 | Better Auth 会话签名密钥；使用随机高熵字符串，不能使用 `replace-me`。 |
| `WEB_ADMIN_EMAILS` | 否 | 首个管理员自举和管理员白名单，多个邮箱用逗号分隔。 |
| `WEB_USER_BOT_LIMIT` | 否 | 每用户 Bot 数量上限；为空或 `0` 表示不限制。 |
| `WEB_PORT` | 否 | Compose 暴露的 Web 宿主机端口，默认 `3000`。 |

## 数据与实例路径

| 变量 | 说明 |
| --- | --- |
| `INSTANCES_ROOT` | Bot 实例根目录；开发默认 `./storage/instances`。 |
| `WEILING_DATA_ROOT` | 生产 Compose 绑定目录根；建议 `/srv/weiling/data`。包含 `sqlite`、`instances`、`lark`、`secrets` 和沙箱私有状态。 |
| `SRT_WORKSPACE_BASE_ROOT` | 沙箱工作区根目录；不要指向宿主机敏感路径。 |
| `SRT_WORKSPACE_MAP_DIR` | workspace 到真实 Bot 工作区的内部映射；应只对 Web/Supervisor 可见。 |

## Supervisor 与通道

| 变量 | 说明 |
| --- | --- |
| `FASTAGENT_SANDBOX_MODE` | `remote` 使用远程 sandbox-runtime；`disabled` 仅适合本地诊断。 |
| `RECONCILE_INTERVAL_MS` | Supervisor 收敛运行意图的间隔，必须为正整数。 |
| `RECONCILE_STALL_TIMEOUT_MS` | 判断 Bot 运行卡住的超时时间。 |
| `SUPERVISOR_INTERNAL_URL` | Web 容器访问 Supervisor 的内部 URL，Compose 默认 `http://supervisor:8790`。 |
| `WECLAWS_INTERNAL_API_TOKEN` | Web 与 Supervisor 内部桥接 Token；生产使用随机值并在两端保持一致。该名称属于当前运行时兼容项。 |
| `WECLAWS_INTERNAL_PORT` | Supervisor 内部端口；不直接映射公网。 |
| `WECLAWS_LARK_CLI_PATH` | 飞书/Lark CLI 路径，默认 `lark-cli`。 |
| `WECLAWS_LARK_CONFIG_ROOT` | 每个 Bot 的飞书授权配置根目录，生产落在 `lark` 持久化目录。 |

## Browserless 与沙箱默认值

| 变量 | 说明 |
| --- | --- |
| `BROWSERLESS_TOKEN` | Browserless sidecar 的访问 Token；不要放到截图、日志或前端。 |
| `BROWSERLESS_API_URL` | 可选 Browserless Profile 的内部地址，默认 `http://browserless:3000`；未启用时浏览器类任务应明确失败。 |
| `BROWSERLESS_CONCURRENT` | Browserless 并发上限；从低值开始，根据机器和任务调整。 |
| `BROWSERLESS_TIMEOUT` | 浏览器任务超时，单位毫秒。 |
| `SRT_DEFAULT_POOL_SIZE` | 新用户/Bot 的沙箱池默认规模。 |
| `SRT_DEFAULT_MIN_READY_PROCESSES` | 池中最少预热进程数。 |
| `SRT_DEFAULT_SESSION_TIMEOUT_MS` | 单个沙箱会话超时。 |
| `SRT_DEFAULT_DENIED_DOMAINS` | 出站域名黑名单；需要联网的 Skill 依赖实际白名单策略。 |
| `SRT_DEFAULT_DENY_READ` | 默认禁止读取路径；不要删除 `/root`、SSH、云凭据和敏感 `/proc` 入口保护。 |
| `SRT_DEFAULT_DENY_WRITE` | 默认禁止写入路径，至少保护 `.env`、SSH 和云凭据。 |

## 约定

- 变量名不代表凭据会自动加密。把密钥放在服务器的权限受限文件、Docker Secrets 或外部密钥服务中。
- Compose 变量替换发生在启动前；容器内变量注入以 Compose 文件为准。修改 `.env` 后重新执行 `config`/`up` 检查。
- 路径使用容器内路径时，以 Compose 文件挂载点为准，不要把 Windows 路径直接填进 Linux 容器配置。
- 若改变 `APP_BASE_URL`，要同步更新反向代理、OAuth 回调和二维码分享地址。
- 若启用 `FASTAGENT_SANDBOX_MODE=disabled`，在上线前恢复 `remote` 并重新做一次文件/网络边界验证。
