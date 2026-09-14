# 企业邮箱管理

## 存储模型

公共 Skill 位于每个实例的 `data/skills/enterprise-mail`。每个 Bot 的凭据独立保存为：

```text
<该 Bot 的 data>/secrets/enterprise-mail.json
```

托管 Skill 同步只更新 `data/skills`，不会复制或覆盖 `data/secrets`。凭据文件包含客户端授权码，脚本在 Linux 上将目录权限设为 `700`、文件权限设为 `600`。

这是适合内部试运行的轻量方案。拥有该 Bot 运行账户或容器文件系统权限的管理员仍可读取凭据；生产环境如需抵御主机管理员或文件泄露，应改接 KMS 或独立密钥服务。

## 为单个 Bot 配置

从该 Bot 已安装的 Skill 目录执行：

```bash
cd <bot-data>/skills/enterprise-mail
python3 scripts/configure_credentials.py --email employee@example.com
```

脚本使用无回显输入读取客户端授权码，默认同时测试腾讯企业邮 IMAP 和 SMTP，测试成功后才保存。不要把授权码放在命令参数、Shell 历史或聊天中。

自动化部署可由密钥管理器把授权码通过标准输入传给 `--auth-code-stdin`；不要用 `echo 明文授权码`，避免明文出现在部署脚本或日志中。

如需显式指定 Bot 数据目录：

```bash
python3 scripts/configure_credentials.py \
  --data-dir /srv/weiling/data/storage/instances/<instance-id>/data \
  --email employee@example.com
```

## 查看状态、轮换和删除

```bash
python3 scripts/configure_credentials.py --status
python3 scripts/configure_credentials.py --email employee@example.com
python3 scripts/configure_credentials.py --remove
```

再次配置会替换当前 Bot 的旧授权码。`--remove` 只删除当前 Bot 的凭据文件，不影响公共 Skill 或其他 Bot。

## 默认服务

- SMTP：`smtp.exmail.qq.com`，SSL 端口 `465`。
- IMAP：`imap.exmail.qq.com`，SSL 端口 `993`。
- 允许的邮箱域名：`example.com`。

若公司管理员调整了域名、服务器或客户端协议策略，配置时使用对应参数覆盖默认值。

## 排错

- 认证失败：确认输入的是客户端授权码而不是网页登录密码，并确认管理员允许 IMAP/SMTP。
- 连接超时：检查服务器出站网络、防火墙和 DNS。
- 查询可用但发送失败：分别检查 IMAP 与 SMTP 状态和服务端策略。
- 不要在日志或报错截图中显示授权码；脚本不会输出该字段。
