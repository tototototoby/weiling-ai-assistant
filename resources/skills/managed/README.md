# Managed Skills Bundle

这个目录保存 weiling 已纳入官方托管同步体系的 skills。

当前目录里的 skill 分两类：

- 已进入 `manifest.json` 的默认同步 skill
- 已收编但暂不默认同步的官方托管 skill

当前默认同步：

- `agent-browser`
- `editorial-card-screenshot`
- `weather`
- `github`
- `skill-creator`
- `video-frames`
- `personal-planner`
- 官方公开的 Feishu/Lark bundle（24 个 `lark-*` skills）：
  `lark-shared`、`lark-calendar`、`lark-im`、`lark-doc`、`lark-drive`、`lark-markdown`、`lark-sheets`、`lark-slides`、`lark-base`、`lark-task`、`lark-mail`、`lark-contact`、`lark-wiki`、`lark-event`、`lark-vc`、`lark-whiteboard`、`lark-minutes`、`lark-openapi-explorer`、`lark-skill-maker`、`lark-attendance`、`lark-approval`、`lark-workflow-meeting-summary`、`lark-workflow-standup-report`、`lark-okr`

当前已收编但暂不默认同步：

- 当前无
- `lark-vc-agent` 当前未收编到 weiling bundle，因为它不在官方公开的 24-skill catalog 中

当前约束：

- `manifest.json` 是默认同步清单的唯一权威来源
- `index.json` 是 weiling 自己的展示、依赖与安装提示清单；它不参与默认同步决策
- 只同步 manifest 中声明的 skill
- 默认目标目录是每个实例的 `data/skills`
- 如果目标目录已有同名且未被 weiling 托管的 skill，则跳过，不覆盖用户内容
- `workspace/.fastagent/skills` 不在 weiling 托管范围内
- weiling 自建/手工维护的 skill，`SKILL.md` frontmatter 继续只保留 `name`、`description`
- upstream-vendored 的官方 Feishu/Lark `lark-*` skills 为降低同步漂移，保留其上游 `version` / `metadata` frontmatter，以及 `references/`、`scripts/`、`assets/` 等同级目录；平台展示、依赖与安装提示仍以 `index.json` 为准

运维约束：

- 是否真正可用，仍取决于 runtime 是否具备对应 CLI 和所需环境变量
- `agent-browser` 已进入默认同步清单；默认 Compose 部署下，weiling 只支持通过 `sandbox-runtime` 内的 `agent-browser -p browserless` 或显式远程 `--cdp` 执行浏览器自动化；少量一次性截图/PDF/scrape 场景可以直接调用 Browserless，但不单独拆 skill
- 官方公开的 Feishu/Lark bundle 已进入默认同步清单；默认 Compose 部署会在 `sandbox-runtime` 镜像内预装 `lark-cli`，并依赖每个 bot 自己的持久化 `HOME` / `XDG_*` 保存配置与授权态
- 首个开源版本不内置原 `ppt-skill`，因为本地内容无法与上游 MIT/AGPL 许可切换点准确对应；需要 PPT 能力时请在核对目标版本许可证后从外部安装
- `editorial-card-screenshot` 已进入默认同步清单；截图路径收口为 Browserless direct，一次性 PNG 导出通过 `curl + python3` 调用远程 `/screenshot` API，不支持本地 Chrome / Chromium 或 `file://` 预览回退；输入 HTML 必须尽量自包含，或仅引用远程可访问资源
- 用户级 secrets 不进入镜像层
