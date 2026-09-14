# 标准报告数据结构

构建脚本接受一个 UTF-8 JSON 对象。只有 `title` 必填；其他字段可以省略。

```json
{
  "title": "2026年第二季度招聘运营报告",
  "subtitle": "管理层简报",
  "company": "部署组织",
  "period": "2026-04-01 至 2026-06-30",
  "prepared_by": "微Link",
  "generated_at": "2026-07-20",
  "classification": "内部资料",
  "executive_summary": [
    "本季度招聘需求总体按计划推进。",
    "关键岗位平均招聘周期仍需改善。"
  ],
  "metrics": [
    {"label": "新增需求", "value": "128", "change": "+12%", "tone": "positive"},
    {"label": "平均招聘周期", "value": "21天", "change": "较目标多3天", "tone": "warning"}
  ],
  "sections": [
    {
      "title": "渠道表现",
      "eyebrow": "核心分析",
      "paragraphs": ["校园渠道贡献了最多有效简历。"],
      "bullets": ["技能人才岗位转化率提升", "部分岗位样本量较小"],
      "table": {
        "columns": ["渠道", "有效简历", "录用人数", "转化率"],
        "rows": [["校园招聘", "320", "28", "8.8%"]]
      },
      "bars": [
        {"label": "校园招聘", "value": 72, "display": "72%"}
      ],
      "callout": {
        "title": "建议",
        "body": "继续优化重点院校合作和岗位说明。",
        "tone": "info"
      }
    }
  ],
  "actions": [
    {"item": "更新重点岗位画像", "owner": "招聘组", "due": "2026-07-31", "status": "进行中"}
  ],
  "sources": [
    {"label": "招聘系统导出数据", "note": "提取于2026-07-18"},
    {"label": "公司官网", "url": "https://example.com/"}
  ],
  "limitations": ["部分渠道数据仍在补录。"],
  "footer": "本报告仅供内部工作参考。",
  "theme": {
    "primary": "#124E66",
    "accent": "#159A9C"
  }
}
```

## 字段约定

- `tone`：允许 `positive`、`warning`、`negative`、`neutral`、`info`。
- `bars[].value`：0 到 100 的数值，用于条形长度；`display` 是展示文本。
- `table.rows`：每行单元格数应与 `columns` 相同。
- `sources[].url`：只允许 `http://` 或 `https://`；它只生成普通链接，不会在报告中加载远程资源。
- `theme`：只接受 6 位十六进制颜色；未提供时使用中性的深蓝绿色主题。
- 所有文本都会进行 HTML 转义；该结构不接受原始 HTML 或 JavaScript。
