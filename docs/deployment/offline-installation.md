# 离线与受限网络部署

首个公开版本以源码和可复现的构建路径为主，不把 1GB 级别的离线镜像包提交到 Git。真正的离线包应从公开 tag 构建，并附镜像 SHA-256、源码 commit、SBOM 和第三方许可清单。

## 什么时候适合做离线包

- 服务器无法访问 npm、GHCR 或模型网关；
- 安全团队要求先在中转机审计镜像和依赖；
- 需要固定 Node、系统包、FastAgent、sandbox-runtime 和浏览器版本。

## 构建机准备

在有网的构建机上：

```bash
git clone <your-repository-url> weiling-ai-assistant
cd weiling-ai-assistant
git checkout <release-tag>
docker compose -f infra/compose/docker-compose.yml build
docker image ls
```

不要从包含真实 `.env`、SQLite 或生产工作区的目录打包构建上下文。先执行密钥扫描和 `docker build` 上下文检查。

## 导出与校验

示例（镜像名称和 tag 以实际发布清单为准）：

```bash
docker save \
  <image-web>:<tag> \
  <image-supervisor>:<tag> \
  <image-sandbox-runtime>:<tag> \
  -o weiling-ai-assistant-images.tar
sha256sum weiling-ai-assistant-images.tar > SHA256SUMS
```

同时保存：

- 对应源码 tag 和 commit；
- `infra/compose/.env.example`；
- Compose 文件及其 SHA-256；
- SBOM 和漏洞扫描结果；
- `THIRD_PARTY_NOTICES.md`；
- 不含真实数据的迁移/初始化说明。

在离线服务器上导入：

```bash
sha256sum -c SHA256SUMS
docker load -i weiling-ai-assistant-images.tar
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml config
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml up -d
```

## 限制

- 没有模型网关和平台长连接，聊天与主动投递无法工作；
- 需要外部浏览器/资讯服务的 Skill 可能失败；
- Browserless、FastAgent 和托管 Skill 的分发许可必须单独核准；
- 不要把离线包与生产 SQLite/实例数据混在一起。
