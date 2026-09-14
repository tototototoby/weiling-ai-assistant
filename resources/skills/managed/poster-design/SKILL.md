---
name: poster-design
description: 将一段文案或主题制作成微Link品牌海报 PNG。使用于“做海报”“生成宣传图”“微Link主题视觉”“9:16/16:9/1:1/3:4 海报”等场景，输出品牌化固定尺寸 PNG。
---

# 微Link品牌海报

本技能把主题和文案排版成粉蓝品牌配色的固定尺寸海报，再通过 Browserless 截图输出 PNG。海报对外品牌为 微Link · 微灵 AI 助手，AI 自称微Link。

## 流程

1. 与用户确认主题、文案要点和尺寸比例。仅支持：

   - `9:16`：900x1600
   - `16:9`：1600x900
   - `1:1`：1200x1200
   - `3:4`：1200x1600

2. 按主题选择模板（assets/templates/ 内为固定画布结构，直接复制并按内容修改）：

   - [assets/templates/activity.html](assets/templates/activity.html)：活动 / 会议 / 培训通知（时间、地点、报名信息行）
   - [assets/templates/recruitment.html](assets/templates/recruitment.html)：招聘（岗位清单、任职要求、联系方式）
   - [assets/templates/holiday.html](assets/templates/holiday.html)：节日 / 祝福（大字问候居中）
   - [assets/poster-template.html](assets/poster-template.html)：通用公告基线

   画布必须使用精确 px 尺寸并内嵌 CSS；标题区放“微Link”文字或 logo 占位；底部放品牌署名 `微Link · 微灵 AI 助手` / `微Link`。

3. 背景图优先使用技能内置素材（快、稳、不依赖外部 API）：截图时给脚本传 `--background auto`，脚本会按比例自动嵌入 `assets/backgrounds/` 下的品牌素材：

   ```bash
   python3 scripts/render_poster.py \
     --html <海报.html> \
     --output <海报.png> \
     --ratio <9:16|16:9|1:1|3:4> \
     --background auto
   ```

   如需 AI 定制背景（当前 Bot 的 `data/secrets/imagegen.json` 存在且包含 `endpoint`、`apiKey`、`model` 时），再改用 `--imagegen --prompt "<背景描述>"`；未配置时明确告知用户本次未使用 AI 背景图。

4. 运行截图并加校验（`--verify` 会检测空白横带与尺寸偏差）：

   ```bash
   python3 scripts/render_poster.py \
     --html <海报.html> \
     --output <海报.png> \
     --ratio <9:16|16:9|1:1|3:4> \
     --background auto \
     --verify
   ```

   若 `--verify` 报告空白横带或尺寸不一致，先修正 HTML 布局再重新截图，不要交付明显留白异常的海报。

5. 向用户交付 PNG 路径，并说明使用的比例、是否生成 AI 背景图以及任何降级或错误。

## HTML 约束

- 设计画布固定 px，不使用 `100vw` / `100vh` 作为主画布尺寸。
- 页面必须自包含，内嵌 CSS；若引用背景图，使用脚本的 `__POSTER_BACKGROUND_URL__` 占位符嵌入，不要依赖本地相对资源路径。
- 字体使用本地 fallback 栈；即使远端字体加载失败，布局也不得塌陷或裁剪。
- 标题、副标题、正文、底部署名区域之间必须留出明确间距，不允许重叠。
- 每次截图前按目标比例修改 `.canvas` 的 `width` / `height`，并让 HTML 与截图比例一致。
- `.canvas` 使用 `position: fixed; top: 0; left: 0`，避免出现顶部偏移；不要使用 `max-width` 媒体查询或 `min-height: 100vh` 之类会破坏固定画布的响应式写法。

## 截图环境

脚本复用 Browserless direct，依赖：

- `BROWSERLESS_API_URL`
- `BROWSERLESS_API_KEY`

不要回退到本地 Chrome、本地 Chromium 或交互式浏览器。若 Browserless 环境变量缺失或截图失败，停止并报告截图步骤被阻塞。
