---
name: feishu-setup
description: 飞书自助接入：在员工自己的 Bot 工作区内创建飞书应用、写入凭证并验证事件总线连接，使飞书与个人微信/企业微信共用同一会话与记忆。当用户说“接入飞书”“连接飞书”“开通飞书”“飞书怎么用”时使用。
---

# 飞书自助接入

本技能指导你在当前 Bot 的沙箱工作区内完成飞书应用创建，并把凭证交给平台网关，让这个 Bot 能够收发飞书消息。接入成功后，飞书、个人微信、企业微信共用同一个会话、记忆、工作区、工具和沙箱。

## 前置条件

- 沙箱镜像已预装 `lark-cli`（`lark-cli --version` 应可运行）。
- 用户持有可登录飞书开发者后台的账号（推荐员工本人账号）。

## 流程

### 1. 确认工作区

```bash
pwd
```

确认当前目录就是本 Bot 的工作区（与日常文件操作所在目录一致）。后续所有 lark-cli 命令都必须带 `HOME=$PWD`，确保配置写入本 Bot 工作区，平台的飞书网关才能读取到。

### 2. 发起应用创建（阻塞式）

用 background 方式执行：

```bash
HOME=$PWD lark-cli config init --new
```

从输出中提取形如 `https://open.feishu.cn/page/cli?user_code=...` 的链接，**原样**发送给用户（只放在包含原始 URL 的代码块中，不做 URL 编码/解码、不补空格、不改写为 Markdown 链接、不拼接参数）。告诉用户：请用本人飞书账号打开并完成应用创建；链接有有效期，过期需重新发起。

如果命令以“Agent 工作区内默认拒绝”为由失败（提示 `config bind` 或 `--force-init`），且用户已明确表示要为本 Bot 单独创建一个飞书应用，则带 `--force-init` 重试（这是用户请求范围内的一次性选择，不需要再询问）。

### 3. 等待完成并登记应用

当输出出现 `OK: 应用配置成功! App ID: cli_xxx` 时，说明应用已创建。lark-cli 会把应用配置写入 `$HOME/.lark-cli/config.json`，把 App Secret 加密保存到 `$HOME/.local/share/lark-cli/`（keychain），**config.json 里的 `appSecret` 只是 keychain 引用，不是明文**。请保留这两处文件（都在当前工作区内），不要删除或改写。

接着登记应用 ID 给平台网关：

```bash
mkdir -p "$PWD/.weiling-feishu"
app_id="$(jq -r '.apps[0].appId // empty' "$HOME/.lark-cli/config.json")"
if [ -z "$app_id" ]; then
  echo "应用 ID 读取失败，请检查 $HOME/.lark-cli/config.json" >&2
  exit 1
fi
umask 077
printf '{"appId":"%s"}\n' "$app_id" > "$PWD/.weiling-feishu/credentials.json"
chmod 600 "$PWD/.weiling-feishu/credentials.json"
```

平台网关会在下一轮 reconcile 读取 `credentials.json` 中的应用 ID，检测到工作区内已有的 lark 配置与 keychain 后直接启动事件总线（约 1 分钟），无需把 Secret 传给平台。

**绝对禁止**：读取、打印或尝试提取 keychain 中的明文 `appSecret`；`credentials.json` 与 lark-cli 自行生成的配置之外，不修改任何文件。

### 4. 告知用户并验证

告诉用户：“飞书应用已创建并提交接入，网关约 1 分钟内会自动启用事件总线。请稍后给我发一条消息测试。”

可选验证（不阻塞用户）：

```bash
HOME=$PWD lark-cli doctor
HOME=$PWD lark-cli event status
```

如果 `doctor` 或事件连接报权限/订阅错误，把 CLI 返回的 `console_url` **原样**发给用户，引导在飞书开发者后台开通以下配置：

- scope：`im:message.p2p_msg:readonly`
- 事件订阅：`im.message.receive_v1`（长连接模式，无需公网回调地址）

## 排障

- `lark-cli doctor` 的 `config_file` 检查失败：确认 `HOME=$PWD` 且 `$HOME/.lark-cli/config.json` 存在。
- 事件连接报 scope/权限错误：按上面的权限清单让用户在开发者后台开通，并把 `console_url` 原样转发。
- 遇到 `exit 10` + `confirmation_required`（高风险写操作门禁）：必须先把 CLI 给出的 `risk.action` 和关键参数展示给用户，得到明确同意后才能追加 `--yes` 重试；不得静默加 `--yes`。
- 用户反馈“飞书收不到回复”：查看管理后台 `/admin/feishu` 中该 Bot 的 `event_status` 与 `lastError`，或让管理员查看 Supervisor 日志。

## 禁止事项

- 不修改 `credentials.json` 以外的文件，不删除或改写 `$HOME/.lark-cli` 下的内容。
- 不输出 appSecret、access token 等敏感信息。
- 不擅自以用户身份调用写操作；所有写操作先确认用户意图。
