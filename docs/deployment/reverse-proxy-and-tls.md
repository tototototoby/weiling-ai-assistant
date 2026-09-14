# 反向代理与 TLS

生产环境建议只让反向代理暴露公网，微Link Web 监听内网端口。SSE、文件上传和长任务需要较长的读取/发送超时；通道长连接由 Supervisor 在 Compose 内部处理，不要把 Supervisor 管理端口直接代理给公网。

## Nginx 示例

以下配置只是假设模板，请替换域名、证书路径、上游地址和上传限制：

```nginx
server {
    listen 443 ssl http2;
    server_name assistant.example.com;

    ssl_certificate     /etc/letsencrypt/live/assistant.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/assistant.example.com/privkey.pem;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_read_timeout 1200s;
        proxy_send_timeout 1200s;
    }
}
```

HTTP 到 HTTPS 的 301 跳转、HSTS、TLS 版本和证书续期按组织标准配置。不要在反向代理日志中记录 Authorization、Cookie、二维码 query 或上传正文。

## Caddy 示例

```caddyfile
assistant.example.com {
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1
    }
}
```

Caddy 会处理证书，但仍需检查访问控制、上传大小、日志脱敏和服务器防火墙。

## 检查清单

- `APP_BASE_URL` 与外部 HTTPS 地址完全一致；
- OAuth/登录回调、二维码分享和邮件链接使用同一域名；
- SSE 连接没有被代理缓存或过早关闭；
- Web 端口仅绑定到反向代理可访问的接口；
- Supervisor、sandbox-runtime、Browserless、SQLite 和数据目录不在公网；
- 证书续期成功，系统时间准确；
- 使用测试账号验证登录、SSE、文件上传和长任务状态流。
