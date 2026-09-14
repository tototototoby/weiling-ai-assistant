# 品牌与演示素材

本目录保存 `微Link · 微灵 AI 助手` 的可复现视觉资产。

## 品牌资产

- `brand/source-logo.png`：用户确认的粉蓝微Link原始视觉，仅作为来源锚点；应用运行时使用透明的 `weiling-mark.png`，不直接使用这张正方形源图。
- `brand/logo-mark.svg`：透明背景的主标志，优先用于网页、文档和矢量场景。
- `brand/logo-mark-{512,128,64,32}.png`：常用位图尺寸。
- `brand/wordmark-horizontal.svg`：横版品牌组合。
- `brand/hero-1600x600.*`：README 顶部主视觉。
- `brand/social-preview-1280x640.*`：GitHub Social Preview。

## 架构与流程图

- `diagrams/architecture.svg`：系统架构与安全边界。
- `diagrams/cross-channel-context.svg`：三端共享上下文流程。
- `diagrams/voice-to-poster.svg`：语音指令到海报成果的工作流。
- `demo/voice-to-poster.gif`：用于 README 和教程的确定性流程动画；它说明工作步骤，不冒充真实平台录屏。

SVG 是文字与图形的事实来源，PNG 只是用于不支持 SVG 的平台预览。所有文字、尺寸、Logo 几何和安全说明均通过确定性排版生成，没有让生图模型改写品牌或技术内容。

## 重新生成

生成器位于 `tools/brand/generate-assets.mjs`，依赖 `sharp`：

```bash
node tools/brand/generate-assets.mjs
```

生成结果和来源记录在 `manifest.json`。对外发布前请确认截图、GIF 和视频中不存在可扫描二维码、账号、邮箱、Token、Cookie、内网地址或真实用户数据。
