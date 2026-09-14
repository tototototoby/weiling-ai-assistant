# Skills 与工具

微Link把“会做什么”放在可维护的 Skill 和工具契约里，而不是把所有能力硬编码在聊天入口。这样可以预置工作技能，也允许部署者按自己的模型、平台权限和风险边界增删。

## 托管 Skill 的来源

默认托管 Skill 位于 `resources/skills/managed`，同步到 Bot 实例的 `data/skills`。同步清单的唯一来源是该目录下的 manifest 文件。Supervisor 启动 Bot 前会尝试同步；同步失败不应悄悄覆盖用户自己维护的同名 Skill。

当前仓库中可以看到这些能力类别：

- 天气和晨报；
- GitHub、Issue、PR 和 CI；
- 文件、PDF、Office、视频帧和网页任务；
- 飞书/Lark 的 IM、日历、文档、Drive、Sheets、Base、Task、Mail、Wiki、会议、OKR 和审批；
- 海报、截图和视觉相关工作流；
- 个人规划、群任务、组织知识查询和通用微Link助手。

PPT 等额外能力可以从外部 Skill 安装，但部署者必须先核对来源、版本与许可证。首个开源版本不内置许可版本无法准确对应的 PPT Skill。

具体 Skill 是否可用，取决于容器内命令、模型能力、授权和第三方服务。README 中的能力列表不能替代每个 Skill 的 `SKILL.md` 和许可证。

## 第一个 Skill 验证

先用低风险任务：

```text
请列出当前可用的 Skills，不要执行外部写入，也不要发送消息。
```

如果 Skill 缺失：

1. 检查 `resources/skills/managed/manifest.json` 是否包含它；
2. 在 Bot 详情页执行同步；
3. 查看 Supervisor 日志和 Bot 实例的 `data/skills`；
4. 检查它要求的命令、模型 Key 或平台授权。

## 工具调用的安全规则

- 读文件、搜索和生成草稿可以先执行；发送消息、写外部文档、改仓库、删除文件等副作用操作应要求明确确认。
- Skill 不能绕过当前通道的发送能力或身份权限。
- 任何外部 API Key、OAuth Token、Cookie 和登录态都通过运行时注入，不能写进 Skill、截图、日志或镜像。
- 浏览器任务默认走远程 Browserless；不要在沙箱里启动未受控的本地浏览器，也不要把宿主机浏览器登录态挂进去。
- 长任务需要写清中间状态、超时和重试语义，避免用户重复提交导致重复副作用。

## 编写一个新的 Skill

最小结构：

```text
resources/skills/managed/my-skill/
  SKILL.md
  scripts/       # 可选
  references/    # 可选
  assets/        # 可选
  LICENSE        # 如果含第三方内容，必须提供
```

`SKILL.md` 至少写清：适用场景、输入、输出、依赖命令、权限、失败方式、是否产生外部副作用和验证方法。脚本需对缺少环境变量给出明确错误，不要猜测 Token 或绕过鉴权。

在 PR 中补充：

- 来源、版本和许可证；
- 是否调用第三方服务；
- 需要哪些环境变量/授权；
- 一个不包含真实账号的测试样例；
- 运行过的校验命令。
