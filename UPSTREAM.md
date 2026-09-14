# 上游与项目沿革

`微Link · 微灵 AI 助手` 基于公开的 [WeClaws](https://github.com/yokingma/weclaws) 项目演进。

## 保留的上游内容

- WeClaws 的 MIT 许可证文本和原始版权声明。
- Web 控制面、Supervisor、SQLite/Drizzle 数据层、共享契约和 Docker Compose 的整体架构思路。
- 通过 `@fastagent/cli` 与 `@fastagent/sandbox-runtime` 外部契约接入智能体运行时的设计。
- 原项目贡献者的有效 Git 历史（若公开发布时保留历史，则不改写作者信息）。

## 本项目的主要变化

- 产品名称、界面文案和公开文档改为 `微Link · 微灵 AI 助手`。
- 以“零门槛聊天入口、跨端上下文、服务端托管、主动跟进和轻量生活助手”为主要产品叙事。
- 补充企业微信、飞书通道说明、跨端共享上下文说明和中文部署教程。
- 增加面向公开仓库的安全边界、第三方许可证和素材脱敏说明。
- 使用 `WEILING_DATA_ROOT` 作为新的公开数据根目录变量；Supervisor 内部桥接、Lark 和部分 FastAgent 运行时变量在兼容期仍保留 `WECLAWS_*` 名称（以代码实际实现为准）。

## 许可证与致谢

上游 WeClaws 采用 MIT License。本仓库继续以 MIT License 发布应用代码，并在 [LICENSE](LICENSE) 中保留上游版权与授权文本。FastAgent、sandbox-runtime、Browserless、Lark CLI、企业微信 SDK、托管 Skills 和基础镜像不因本项目改名而改变其各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 独立项目声明

本项目与华为 WeLink、腾讯微信/企业微信、飞书/Lark 或其关联公司没有隶属、授权、赞助或官方合作关系。平台名称与商标归其各自权利人所有。
