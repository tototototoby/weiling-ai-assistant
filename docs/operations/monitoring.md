# 监控与日常运维

微Link没有要求一定接入某个监控厂商；先把容器健康、进程状态、日志、磁盘和投递回执看清楚，再接 Prometheus、Grafana 或组织已有平台。

## 快速检查

```bash
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml ps
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml logs --since=10m web
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml logs --since=10m supervisor
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml logs --since=10m sandbox-runtime browserless
```

观察：

- Web 是否健康、是否反复重启；
- Supervisor 是否持续收敛同一个 Bot；
- FastAgent 是否正常输出事件；
- 沙箱池是否有 ready 进程；
- Browserless 是否超时或队列堆积；
- 通道连接是否 connecting/error；
- 主动投递是否出现 failed 或长期 processing。

## 建议指标

| 类别 | 指标/信号 | 发现异常时 |
| --- | --- | --- |
| 可用性 | Web /login 200、容器 health、重启次数 | 查 Web 日志、磁盘和数据库可写性。 |
| 运行时 | Bot desired/running 状态、子进程退出、重启退避 | 查 Supervisor 和 FastAgent 事件。 |
| 沙箱 | ready/used 池进程、初始化延迟、会话超时 | 查内存、端口范围、工作区和 sandbox-runtime。 |
| 浏览器 | 并发、排队、超时、异常退出 | 降低并发，检查 Browserless 许可/版本/资源。 |
| 通道 | connected/connecting/error、入站/出站数量 | 查凭据、网络、平台权限和回执。 |
| 数据 | SQLite 文件大小、磁盘余量、备份新鲜度 | 停止写入后备份；不要直接删除 SQLite。 |
| 安全 | 认证失败、异常出站、管理入口访问 | 轮换凭据，限制网络和访问来源。 |

## 常见告警处置

### Web 无法访问

1. docker compose ps 看容器状态和 health。
2. 查看 Web 最近日志，确认 APP_BASE_URL、数据库和密钥。
3. 检查反向代理、TLS、端口和防火墙。
4. 在服务器本机请求 /login，区分 Web 问题和代理问题。

### Bot 不工作

1. 看 Bot 的持久化 desired state 和页面状态。
2. 看 Supervisor 是否启动 FastAgent、是否进入退避。
3. 检查模型配置和通道授权。
4. 不要先删 Bot 或清 SQLite；保留日志和实例目录供排查。

### 任务卡住

- 查看 FastAgent JSONL、沙箱会话和 Browserless 超时；
- 确认电脑是否关机不影响服务端容器；
- 先从同一个入口询问状态，不要重复提交会产生副作用的任务；
- 超时后只在有幂等键/明确取消策略时重试。

### 主动投递失败

- 确认通道连接和用户/Bot 绑定；
- 检查平台主动消息窗口、权限和内容类型；
- 查看投递回执状态和错误；
- 对重要提醒配置补充入口，但不要把失败重复放大为多条消息。

## 日志处理

日志可能包含文件名、平台用户 ID、模型错误和任务文本。设置合理保留期，限制读取权限，向外发送前脱敏。不要把整段生产日志上传公开 Issue；安全问题按 SECURITY.md 私下报告。
