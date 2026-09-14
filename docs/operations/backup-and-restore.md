# 备份与恢复

微Link的“备份”不是只复制一个 SQLite 文件。账号、Bot 实例、会话/登录态、Lark 配置、沙箱工作区和 secrets 共同决定服务能否恢复。

## 需要保护的目录

生产绑定目录（示例 /srv/weiling/data）通常包含：

- sqlite/：用户、Bot、配置、运行意图和投递记录；
- instances/：Bot 工作区、运行时配置和登录态；
- sandbox-user-workspaces/：远程沙箱用户工作区；
- sandbox-runtime-private/：池配置、状态和 workspace 映射；
- lark/：飞书/Lark 授权配置；
- secrets/：运行时注入的 Secret。

实际目录以 Compose 和 WEILING_DATA_ROOT 为准。备份文件本身和原目录一样敏感。

## 备份步骤

低流量或升级前先停止写入：

```bash
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml stop web supervisor sandbox-runtime
```

打包到权限受限的备份盘：

```bash
sudo tar --xattrs --acls -czf /secure-backups/weiling-$(date +%Y%m%d-%H%M%S).tar.gz -C /srv/weiling data
sudo chmod 600 /secure-backups/weiling-*.tar.gz
sha256sum /secure-backups/weiling-*.tar.gz
```

重新启动：

```bash
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml up -d
```

请把哈希、加密状态、源码 tag、Compose 文件版本和备份时间写进内部记录，不要把真实哈希和服务器路径贴到公开 Issue。

## 恢复演练

1. 在隔离服务器建立空目录，不要覆盖生产目录。
2. 校验备份哈希并解密（如使用了加密备份）。
3. 先启动数据库/应用，执行迁移检查，不要直接接受破坏性迁移。
4. 恢复 sqlite、instances、沙箱私有状态、Lark 和 secrets。
5. 启动 Web/Supervisor，确认账号、Bot、通道配置和工作区都存在。
6. 用测试账号收发一条消息、读取一份测试文件并检查主动投递状态。
7. 确认没有把恢复环境接到生产群、生产收件人或真实外部发送目标。

恢复命令示例：

```bash
sudo tar -xzf /secure-backups/weiling-<timestamp>.tar.gz -C /srv/weiling-restore
sudo chmod -R go-rwx /srv/weiling-restore/data
```

## 保留与删除

建议至少保留一份离线/异地加密备份和一份最近可恢复备份。按组织政策定义聊天、文件、登录态和日志的保留周期；删除前确认备份副本也按政策处理。
