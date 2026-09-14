# 第三方许可与分发说明

本文件只说明项目当前已识别的第三方边界，不替代各依赖发布包内的 LICENSE、NOTICE 或官方许可文本。发布新版本前，请根据锁文件和镜像构建结果重新生成完整的依赖与 SBOM 清单。

## 应用与运行时依赖

| 组件 | 用途 | 许可/来源 | 发布注意 |
| --- | --- | --- | --- |
| WeClaws 上游代码 | 控制面与多用户架构来源 | MIT；副本见 [THIRD_PARTY_LICENSES/WeClaws-MIT.txt](THIRD_PARTY_LICENSES/WeClaws-MIT.txt) | 保留上游版权和授权文本；见 [UPSTREAM.md](UPSTREAM.md)。 |
| `@fastagent/cli@0.8.4` | 智能体运行时、微信通道、工具、Skills、MCP、记忆和定时任务 | 上游自定义许可：[本地副本](THIRD_PARTY_LICENSES/FastAgent-CLI-0.8.4.txt)、[原文](https://unpkg.com/@fastagent/cli@0.8.4/LICENSE.md) | 该许可不等于可把 FastAgent 单独重新打包成 CLI/SDK/服务分发；公开镜像前必须核准应用镜像内嵌依赖的许可边界。 |
| `@fastagent/sandbox-runtime@0.5.7` | 远程沙箱和进程池 | MIT：[本地副本](THIRD_PARTY_LICENSES/FastAgent-Sandbox-Runtime-0.5.7-MIT.txt) | 不在本仓库复制其独立源码；升级版本时重新核对随包许可。 |
| `@anthropic-ai/sandbox-runtime@0.0.42` | FastAgent sandbox-runtime 的底层隔离依赖 | Apache-2.0：[本地副本](THIRD_PARTY_LICENSES/Anthropic-Sandbox-Runtime-0.0.42.txt) | Linux 隔离依赖 bubblewrap 等宿主能力；不能把包名或沙箱描述当作绝对安全保证。 |
| `@wecom/aibot-node-sdk@1.0.7` | 企业微信 Bot WebSocket 通道 | npm 元数据声明 MIT：[元数据快照](THIRD_PARTY_LICENSES/WeCom-AIBot-SDK-1.0.7-package.json) | 该 npm 包没有随包附带独立 LICENSE 文件；镜像或离线包发布前应向上游补充核准依据。 |
| `@larksuite/cli` / `lark-cli` | 飞书/Lark 应用和资源操作 | MIT 副本：[THIRD_PARTY_LICENSES/Lark-CLI-MIT.txt](THIRD_PARTY_LICENSES/Lark-CLI-MIT.txt) | 用户需要自行创建应用并授权；本项目不提供官方凭据。版本更新时重新核对上游仓库声明。 |
| `agent-browser` | 远程浏览器操作 Skill 的 CLI | Apache-2.0：[THIRD_PARTY_LICENSES/Agent-Browser-Apache-2.0.txt](THIRD_PARTY_LICENSES/Agent-Browser-Apache-2.0.txt) | 微Link只支持连接受控的远程 Browserless；不要把宿主机浏览器登录态挂进沙箱。 |
| `clawdis` 收编内容 | 部分托管 Skill 的来源 | MIT：[THIRD_PARTY_LICENSES/OpenClaw-Clawdis-MIT.txt](THIRD_PARTY_LICENSES/OpenClaw-Clawdis-MIT.txt) | 保留来源和版权；各 Skill 的 scripts/references/assets 仍需逐项核对。 |
| `sharp@0.35.4` 与 `@img/sharp-*` 预编译依赖 | 生成 Logo、Hero、社交预览和流程图 PNG/GIF | Sharp 为 Apache-2.0；预编译图像库包含 LGPL-3.0-or-later 等第三方组件，完整清单以 `sharp-libvips` 上游 THIRD-PARTY-NOTICES 为准 | 这些库仅作为未修改的构建依赖使用；分发构建产物或离线依赖包时必须一并保留相应许可和第三方声明。 |
| Next.js、React、Drizzle、Better Auth、Zod 等 npm 依赖 | Web、数据层和运行时 | 各自上游许可证 | 锁文件和构建产物更新时重新生成依赖许可证清单。 |

## 可选服务与基础镜像

| 组件 | 用途 | 许可/来源 | 发布注意 |
| --- | --- | --- | --- |
| Browserless Chromium | 浏览器自动化 sidecar | SSPL-1.0 / 商业许可：[本地说明](THIRD_PARTY_LICENSES/Browserless.txt)、[原文](https://github.com/browserless/browserless/blob/main/LICENSE) | 作为可选服务使用；不要把它的许可误写成 MIT。公开镜像或商业部署请自行核对版本和许可。 |
| Node.js / Debian 基础镜像 | 应用与沙箱镜像基础 | 各自上游许可 | 镜像发布时记录 digest 和 SBOM。 |
| `gh`、`ffmpeg`、`pandoc`、`poppler-utils`、`ripgrep` 等系统包 | 沙箱中的文件、媒体、文本和 Git 工具 | 各自发行版/上游许可 | 具体版本随基础镜像变化；以构建日志和 SBOM 为准。 |

## 托管 Skills

`resources/skills/managed` 中的 Skill 可能包含脚本、参考文档、模板、图片或来自上游仓库的收编内容。每个 Skill 应保留原始 frontmatter、LICENSE/NOTICE 和来源地址；不确定可再分发的内容不得进入公开 Release。

`index.json` 中 `source.kind=weiling-curated` 的 Skill 是本项目维护的通用代码，随根目录 MIT 许可证发布；`upstream-vendored` 和 `upstream-curated` 条目必须继续遵循其记录的上游许可证。来源条目需要同时记录路径，后续收编更新应补充 commit 或 tag。

特别注意：

- `lark-*` Skills 依赖飞书/Lark CLI 和平台权限，不代表本项目获得飞书官方授权。
- 首个开源版本不内置原 `ppt-skill`：本地内容无法与上游 MIT/AGPL 许可切换点准确对应，已从公开源码目录移出。部署者可在核对目标版本许可证后自行安装外部 PPT Skill。
- `editorial-card-screenshot`、`qwen-vision`、浏览器相关 Skill 需要外部服务或模型密钥，密钥不会被打进仓库或镜像。

## 发布检查

每次发布前至少完成：

1. 根据 `pnpm-lock.yaml` 生成生产依赖许可证清单和 SBOM。
2. 对 `resources/skills/managed` 逐项核对来源、版本和再分发许可。
3. 对 Docker 镜像记录基础镜像 digest、系统包清单和镜像扫描结果。
4. 检查 Release、README、截图和教程没有复制第三方的商标、凭据、登录态或受限素材。
5. 对 FastAgent、Browserless 和 Lark CLI 的版本更新重新做许可审计。
