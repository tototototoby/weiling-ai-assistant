# v0.1.0-beta.1 开源发布检查单

本文件记录公开发布的真实状态。未勾选项目不是“以后再说”的装饰项；它们决定仓库、Release 或镜像是否可以对外开放。

## 已完成

- [x] 以 2026-09-14 脱敏源码包建立新的本地源码真源。
- [x] 建立独立 `weiling-ai-assistant` Git 工作区，并把原 WeClaws 仓库登记为只读 upstream。
- [x] 保留上游 MIT 版权与许可文本，新增 `UPSTREAM.md` 和第三方许可说明。
- [x] 移除自动推送 `latest` 镜像的旧 CNB/GitHub 工作流。
- [x] 建立源码 CI、密钥扫描、依赖/配置扫描、SBOM 和源码预发布工作流。
- [x] 建立中文 README、英文 README、部署/通道/教程/运维/安全文档。
- [x] 生成可复现的微Link Logo、Hero、社交预览、架构图和流程动画。
- [x] 将企业专属 PPT 模板与旧公司内部人格移出公开源码目录，保存在本地隔离备份中。
- [x] 将默认人格与知识查询 Skill 改写为不绑定公司、域名、城市和租户的通用版本。
- [x] 补齐默认同步清单中的 Lark Skills，保证展示清单与运行清单一致。

## 代码发布前必须完成

- [x] 安装锁定依赖并通过 `pnpm version:check`、`pnpm test`、`pnpm typecheck`、`pnpm lint` 和 `pnpm build`。
- [x] 完成源码树和 51 个上游 Git 提交的密钥扫描；Gitleaks 均为 0 命中。
- [x] 完成全仓品牌、公司名、内部域名、账号、二维码和绝对路径残留扫描。
- [x] 验证迁移脚本默认 dry-run，只有显式 `--apply` 才写入目标目录，且不会覆盖已有数据。
- [ ] 在有 Docker 的干净 Linux 环境验证 Compose 可从源码构建，不依赖尚未发布的私有镜像。
- [x] 确认默认 Compose 不向宿主机公开沙箱管理端口，并记录仍然需要的 Capability。
- [x] 核对 README、Issue 模板、包元数据和镜像注册表中的最终 GitHub owner：`tototototoby`。
- [x] 创建私有 GitHub 仓库 `tototototoby/weiling-ai-assistant`，并推送审计后的首个提交。
- [x] 推送最终品牌提交，并让 GitHub CI 与 Security and supply chain 工作流全部通过。
- [ ] 在仓库设置中上传 `assets/brand/social-preview-1280x640.png` 作为 Social Preview。

## 对外宣称前必须完成

- [ ] 用专门测试账号完成微信扫码、消息收发和二维码分享验收。
- [ ] 用专门测试应用完成企业微信连接、首次绑定、收发和允许范围内的主动投递验收。
- [ ] 用专门测试应用完成飞书私聊、群聊、附件和权限验收；确认群聊上下文保持群边界。
- [ ] 完成“同一 Bot 从微信切换到飞书/Web 继续任务”的真实跨端测试。
- [ ] 完成“客户端离开后，服务端任务继续并返回结果”的真实托管测试。
- [ ] 完成主动提醒的真实投递测试；飞书未接入中央主动投递前不得写成默认提醒渠道。
- [ ] 使用脱敏测试账号录制真实产品截图或演示视频，不含有效二维码、Token、Cookie、邮箱和用户数据。

## 镜像与离线包发布前必须完成

- [ ] 获得或记录 FastAgent 对“应用镜像内嵌依赖”的再分发许可判断。
- [x] 固定 Browserless 版本和 digest，并重新核对 SSPL-1.0/商业许可边界。
- [ ] 为源码和每个镜像生成 SBOM、漏洞扫描报告、不可变 digest 与来源证明。
- [ ] 镜像只发布语义版本和 commit SHA 标签，不把 `latest` 作为唯一部署入口。
- [ ] 离线包从公开 tag 构建，附 SHA-256、源码 commit、镜像 digest 和第三方许可清单。

## 当前明确限制

- 源码包没有携带私有开发仓库的 `.git`；当前工作区接入了公开 WeClaws 的 51 个上游提交，私有阶段的后续改动会作为新的开源提交，不能声称保留了全部私有开发历史。
- 当前 Windows 环境没有 Docker，Compose 的真实构建和运行需要在 GitHub Ubuntu Runner、WSL2 或另一台 Linux 主机验证。
- FastAgent 和 Browserless 使用各自许可；根目录 MIT 许可证不覆盖第三方组件。
- 容器沙箱面向可信宿主机和受控用户，不是抵御恶意租户的强隔离边界。
