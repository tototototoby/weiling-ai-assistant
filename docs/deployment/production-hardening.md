# 生产加固清单

这份清单用于把“能启动”提升到“可以在受控团队里长期使用”。它不是渗透测试报告，也不能把当前沙箱配置描述成恶意多租户隔离。

## 身份与密钥

- [ ] `BETTER_AUTH_SECRET` 是随机高熵值，且不在日志、截图、Git 历史和聊天中出现。
- [ ] `BROWSERLESS_TOKEN` 和 Web/Supervisor 内部 Token 使用不同的随机值。
- [ ] 管理员邮箱白名单和邀请码只给实际管理员/成员。
- [ ] 模型 API Key、微信登录态、企业微信 Secret、飞书 App Secret 放在权限受限目录或 Docker Secrets。
- [ ] 只为演示账号使用临时 Key；发布截图前已经撤销。

## 网络

- [ ] 只对外暴露反向代理和 Web 端口；SQLite、instances、sandbox-runtime、Supervisor 内部端口不暴露公网。
- [ ] Browserless 管理接口只在 Compose 内网可见；调试映射只绑定 `127.0.0.1`。
- [ ] 反向代理开启 HTTPS、SSE/长连接支持和合理的上传/超时限制。
- [ ] 出站网络只放行模型、聊天平台、浏览器和必要的 Skill 域名。

## 容器与沙箱

- [ ] 固定 Node、npm、系统包、FastAgent、sandbox-runtime 和 Browserless 版本；Release 记录 digest。
- [ ] 定期扫描镜像、依赖和 Dockerfile。
- [ ] 删除不需要的 capability；确认为什么 sandbox-runtime 仍需要 `SYS_ADMIN`/`NET_ADMIN`。
- [ ] 评估 `seccomp=unconfined`、`apparmor=unconfined` 的影响；不受信任代码使用独立 VM、gVisor 或 Kata Containers。
- [ ] 不挂载 `/var/run/docker.sock`、宿主机根目录、SSH、云凭据和无关用户目录。
- [ ] 限制 CPU、内存、进程数、磁盘和 Browserless 并发，避免一个任务耗尽整台机器。

## 数据

- [ ] `/srv/weiling/data` 只有部署用户/服务用户可读写，备份使用加密存储。
- [ ] 明确 SQLite、工作区、通道配置、日志和聊天记录的留存周期。
- [ ] 每次升级前备份；定期演练恢复，不只检查“备份命令返回 0”。
- [ ] 删除用户或 Bot 时检查实例文件、沙箱工作区、会话记录和通道绑定是否一并处理。

## 通道

- [ ] 微信、企业微信、飞书使用专门测试/生产账号分开验证。
- [ ] 明确哪个通道允许主动消息、文件和群聊；不把平台策略写成项目保证。
- [ ] 公开二维码设置最短合理有效期，用完撤销，并检查分享页不会泄露 Bot 名称之外的内部信息。

## 观察与响应

- [ ] 监控 Web、Supervisor、sandbox-runtime、Browserless 的健康、重启、日志和磁盘。
- [ ] 为通道投递失败、长任务卡住、沙箱池耗尽、数据库空间不足设置告警。
- [ ] 预先写好轮换密钥、隔离实例、暂停外部发送和恢复数据库的操作手册。
- [ ] 安全问题按 [SECURITY.md](../../SECURITY.md) 私下报告，不在 Issue 中公开可利用细节。
