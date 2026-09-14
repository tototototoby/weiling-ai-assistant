import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const brandDir = path.join(root, "assets", "brand");
const diagramDir = path.join(root, "assets", "diagrams");
const demoDir = path.join(root, "assets", "demo");
fs.mkdirSync(brandDir, { recursive: true });
fs.mkdirSync(diagramDir, { recursive: true });
fs.mkdirSync(demoDir, { recursive: true });

const colors = {
  ink: "#19323C",
  muted: "#56717A",
  pale: "#E7F5F8",
  paper: "#F9FCFD",
  white: "#FFFFFF",
  blue: "#B3E1F6",
  blueDeep: "#77C9EC",
  pink: "#FCABA7",
  pinkPale: "#FFD9D6",
  mint: "#DDF5EB",
  line: "#D9E9ED",
};

const font = "'Microsoft YaHei','Noto Sans CJK SC','PingFang SC',Arial,sans-serif";

function normalizeSvgMarkup(content) {
  return `${content
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()}\n`;
}

function svg(width, height, body, defs = "") {
  return normalizeSvgMarkup(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EAF8FC"/></linearGradient>
    <linearGradient id="pink" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD0CD"/><stop offset="1" stop-color="#F7A5A2"/></linearGradient>
    <linearGradient id="blue" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C6EDFA"/><stop offset="1" stop-color="#9EDAF4"/></linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#5C9DB8" flood-opacity="0.18"/></filter>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="28"/></filter>
    ${defs}
  </defs>
  ${body}
</svg>`);
}

function logoMark(size = 512) {
  return svg(size, size, `
  <g filter="url(#shadow)">
    <circle cx="256" cy="256" r="228" fill="url(#pink)"/>
    <circle cx="256" cy="256" r="171" fill="url(#blue)"/>
    <circle cx="191" cy="252" r="24" fill="${colors.pink}"/>
    <circle cx="321" cy="252" r="24" fill="${colors.pink}"/>
    <path d="M226 306 C232 330 280 330 286 306" fill="none" stroke="${colors.pink}" stroke-width="15" stroke-linecap="round"/>
    <ellipse cx="210" cy="183" rx="66" ry="34" fill="#FFFFFF" opacity="0.18" transform="rotate(-20 210 183)"/>
  </g>`);
}

function pill(x, y, w, label, fill = colors.white) {
  return `<g><rect x="${x}" y="${y}" width="${w}" height="46" rx="23" fill="${fill}" stroke="${colors.line}"/><circle cx="${x + 24}" cy="${y + 23}" r="6" fill="${colors.pink}"/><text x="${x + 40}" y="${y + 30}" font-family="${font}" font-size="18" font-weight="600" fill="${colors.ink}">${label}</text></g>`;
}

function hero(width = 1600, height = 600) {
  const mark = logoMark().replace(/^<svg[^>]*>\s*|\s*<\/svg>\s*$/g, "");
  return svg(width, height, `
  <rect width="${width}" height="${height}" rx="40" fill="url(#bg)"/>
  <circle cx="1420" cy="90" r="210" fill="${colors.pinkPale}" opacity="0.42" filter="url(#soft)"/>
  <circle cx="1260" cy="520" r="260" fill="${colors.blue}" opacity="0.34" filter="url(#soft)"/>
  <g transform="translate(1018 44) scale(.94)">${mark}</g>
  <g transform="translate(1135 112)">
    <rect x="0" y="0" width="98" height="44" rx="22" fill="#FFFFFF" opacity="0.92"/>
    <text x="49" y="29" text-anchor="middle" font-family="${font}" font-size="18" font-weight="700" fill="${colors.ink}">微信</text>
  </g>
  <g transform="translate(1394 250)">
    <rect x="0" y="0" width="98" height="44" rx="22" fill="#FFFFFF" opacity="0.92"/>
    <text x="49" y="29" text-anchor="middle" font-family="${font}" font-size="18" font-weight="700" fill="${colors.ink}">飞书</text>
  </g>
  <g transform="translate(1092 452)">
    <rect x="0" y="0" width="98" height="44" rx="22" fill="#FFFFFF" opacity="0.92"/>
    <text x="49" y="29" text-anchor="middle" font-family="${font}" font-size="18" font-weight="700" fill="${colors.ink}">企微</text>
  </g>
  <text x="104" y="132" font-family="${font}" font-size="24" font-weight="700" letter-spacing="3" fill="${colors.blueDeep}">OPEN-SOURCE PERSONAL AI ASSISTANT</text>
  <text x="104" y="226" font-family="${font}" font-size="66" font-weight="800" fill="${colors.ink}">微Link · 微灵 AI 助手</text>
  <text x="104" y="292" font-family="${font}" font-size="28" font-weight="500" fill="${colors.muted}">不用多学一个软件，在熟悉的聊天窗口里，把事情交给微Link。</text>
  ${pill(104, 354, 154, "扫码即用")}
  ${pill(274, 354, 174, "跨端记忆")}
  ${pill(464, 354, 226, "服务端持续办事")}
  ${pill(706, 354, 174, "主动跟进")}
  <text x="104" y="474" font-family="${font}" font-size="20" fill="${colors.muted}">微信 · 企业微信 · 飞书 · Web</text>
  <text x="104" y="520" font-family="${font}" font-size="17" fill="#78939C">独立开源项目 · 与各平台官方无隶属或授权关系</text>`);
}

function socialPreview() {
  const mark = logoMark().replace(/^<svg[^>]*>\s*|\s*<\/svg>\s*$/g, "");
  return svg(1280, 640, `
  <rect width="1280" height="640" fill="url(#bg)"/>
  <circle cx="1130" cy="90" r="260" fill="${colors.pinkPale}" opacity=".5" filter="url(#soft)"/>
  <circle cx="980" cy="630" r="300" fill="${colors.blue}" opacity=".38" filter="url(#soft)"/>
  <g transform="translate(790 72) scale(.88)">${mark}</g>
  <text x="86" y="150" font-family="${font}" font-size="22" font-weight="700" letter-spacing="3" fill="${colors.blueDeep}">OPEN SOURCE</text>
  <text x="86" y="246" font-family="${font}" font-size="62" font-weight="800" fill="${colors.ink}">微Link ·</text>
  <text x="86" y="320" font-family="${font}" font-size="48" font-weight="800" fill="${colors.ink}">微灵 AI 助手</text>
  <text x="86" y="388" font-family="${font}" font-size="25" fill="${colors.muted}">零门槛接入 · 跨端记忆 · 服务端持续办事</text>
  ${pill(86, 452, 150, "微信")}
  ${pill(252, 452, 170, "企业微信")}
  ${pill(438, 452, 150, "飞书")}
  <text x="86" y="564" font-family="${font}" font-size="19" fill="#78939C">github.com/tototototoby/weiling-ai-assistant</text>`);
}

function wordmark() {
  const mark = logoMark().replace(/^<svg[^>]*>\s*|\s*<\/svg>\s*$/g, "");
  return svg(1080, 240, `
  <g transform="translate(18 18) scale(.40)">${mark}</g>
  <text x="255" y="112" font-family="${font}" font-size="68" font-weight="800" fill="${colors.ink}">微Link</text>
  <circle cx="498" cy="92" r="6" fill="${colors.pink}"/>
  <text x="528" y="112" font-family="${font}" font-size="58" font-weight="750" fill="${colors.ink}">微灵 AI 助手</text>
  <text x="258" y="160" font-family="${font}" font-size="22" font-weight="500" fill="${colors.muted}">在熟悉的聊天窗口里，把事情交给微Link</text>`);
}

function card(x, y, w, h, title, detail, accent = colors.blueDeep) {
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="#FFFFFF" stroke="${colors.line}"/><rect x="${x}" y="${y}" width="7" height="${h}" rx="4" fill="${accent}"/><text x="${x + 30}" y="${y + 44}" font-family="${font}" font-size="22" font-weight="750" fill="${colors.ink}">${title}</text><text x="${x + 30}" y="${y + 78}" font-family="${font}" font-size="16" fill="${colors.muted}">${detail}</text></g>`;
}

function arrow(x1, y1, x2, y2) {
  return `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="#A7C7D0" stroke-width="3" marker-end="url(#arrow)"/>`;
}

const arrowDef = `<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#A7C7D0"/></marker>`;

function architecture() {
  return svg(1500, 900, `
  <rect width="1500" height="900" rx="32" fill="${colors.paper}"/>
  <text x="72" y="84" font-family="${font}" font-size="38" font-weight="800" fill="${colors.ink}">微Link 系统架构</text>
  <text x="72" y="122" font-family="${font}" font-size="19" fill="${colors.muted}">控制面写入持久化意图，Supervisor 收敛运行状态，FastAgent 与独立沙箱执行任务</text>
  ${card(72, 202, 250, 104, "微信 / 企微 / 飞书", "用户在熟悉的聊天工具中发起任务", colors.pink)}
  ${card(72, 344, 250, 104, "Web 控制台", "注册、领取、配置与查看状态", colors.pink)}
  ${card(430, 272, 260, 122, "统一身份与会话", "关联用户、通道与同一套上下文", colors.blueDeep)}
  ${card(798, 196, 260, 104, "SQLite", "用户配置、运行意图与状态事实", "#81D1B2")}
  ${card(798, 344, 260, 104, "Supervisor", "调度、恢复、事件消费与状态收敛", colors.blueDeep)}
  ${card(1166, 272, 260, 122, "FastAgent Runtime", "模型、工具、Skills、MCP 与任务执行", colors.pink)}
  ${card(430, 590, 260, 122, "用户 A 沙箱", "独立工作区、进程池与任务状态", colors.blueDeep)}
  ${card(798, 590, 260, 122, "用户 B 沙箱", "文件和上下文互不混用", colors.blueDeep)}
  ${card(1166, 590, 260, 122, "浏览器与外部工具", "Browserless、飞书能力与其他 MCP", "#81D1B2")}
  ${arrow(322, 254, 430, 318)}${arrow(322, 396, 430, 340)}
  ${arrow(690, 318, 798, 248)}${arrow(690, 348, 798, 396)}
  ${arrow(1058, 248, 1166, 318)}${arrow(1058, 396, 1166, 348)}
  ${arrow(1296, 394, 1296, 590)}${arrow(1166, 650, 1058, 650)}${arrow(798, 650, 690, 650)}
  <rect x="72" y="792" width="1354" height="54" rx="16" fill="${colors.pale}"/>
  <text x="98" y="826" font-family="${font}" font-size="17" fill="${colors.muted}">安全边界：默认面向可信宿主机与受控用户；高权限容器不是抵御恶意租户的强隔离边界。</text>`, arrowDef);
}

function crossChannel() {
  return svg(1500, 720, `
  <rect width="1500" height="720" rx="32" fill="${colors.paper}"/>
  <text x="72" y="82" font-family="${font}" font-size="38" font-weight="800" fill="${colors.ink}">一个用户，多个入口，同一件事</text>
  <text x="72" y="120" font-family="${font}" font-size="19" fill="${colors.muted}">通道只是入口；目标、对话和任务状态跟着用户走</text>
  ${card(72, 192, 220, 92, "微信", "路上发语音", colors.pink)}
  ${card(72, 314, 220, 92, "企业微信", "工作中回一句", colors.blueDeep)}
  ${card(72, 436, 220, 92, "飞书", "继续调用办公能力", "#81D1B2")}
  ${card(390, 288, 280, 142, "身份绑定", "把不同通道账号关联到同一位用户", colors.blueDeep)}
  ${card(770, 258, 310, 202, "共享上下文", "目标 · 消息 · 文件 · 进度\n提醒 · 下一步 · 任务状态", colors.pink)}
  ${card(1180, 288, 250, 142, "任一端继续", "无需重复交代，选择方便的入口接着做", "#81D1B2")}
  ${arrow(292, 238, 390, 325)}${arrow(292, 360, 390, 360)}${arrow(292, 482, 390, 393)}
  ${arrow(670, 360, 770, 360)}${arrow(1080, 360, 1180, 360)}
  <text x="750" y="610" text-anchor="middle" font-family="${font}" font-size="25" font-weight="700" fill="${colors.ink}">刚才在微信里交代到一半，换到飞书，它也记得。</text>`, arrowDef);
}

function voiceToPoster() {
  return svg(1500, 720, `
  <rect width="1500" height="720" rx="32" fill="${colors.paper}"/>
  <text x="72" y="82" font-family="${font}" font-size="38" font-weight="800" fill="${colors.ink}">一条语音，到工位拿回一张海报</text>
  <text x="72" y="120" font-family="${font}" font-size="19" fill="${colors.muted}">用户离开电脑，服务端仍在独立沙箱中完成工作</text>
  ${card(72, 256, 230, 134, "① 发条语音", "说清目标、主题和时间", colors.pink)}
  ${card(370, 256, 230, 134, "② 理解任务", "识别意图并补齐必要信息", colors.blueDeep)}
  ${card(668, 256, 230, 134, "③ 调用技能", "选择海报与办公文件能力", "#81D1B2")}
  ${card(966, 256, 230, 134, "④ 沙箱执行", "素材处理、排版与导出", colors.blueDeep)}
  ${card(1264, 256, 166, 134, "⑤ 发回成果", "直接查看或下载", colors.pink)}
  ${arrow(302, 323, 370, 323)}${arrow(600, 323, 668, 323)}${arrow(898, 323, 966, 323)}${arrow(1196, 323, 1264, 323)}
  <rect x="72" y="492" width="1358" height="92" rx="24" fill="${colors.pale}"/>
  <text x="105" y="530" font-family="${font}" font-size="18" font-weight="700" fill="${colors.ink}">核心差异</text>
  <text x="105" y="561" font-family="${font}" font-size="17" fill="${colors.muted}">技能已经预配置；任务不依赖用户工作电脑保持开机；每个用户拥有独立工作区。</text>`, arrowDef);
}

async function writeSvg(name, content, dir = brandDir) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, "utf8");
  return file;
}

async function render(svgFile, output, width) {
  await sharp(svgFile, { density: 192 }).resize({ width }).png({ compressionLevel: 9 }).toFile(output);
}

async function renderVoiceWorkflowGif(svgFile, output) {
  const width = 1000;
  const base = await sharp(svgFile, { density: 144 })
    .resize({ width })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const height = base.info.height;
  const cardCenters = [125, 324, 523, 722, 898];
  const frames = [];

  for (let index = 0; index < cardCenters.length; index += 1) {
    const x = Math.max(28, cardCenters[index] - 90);
    const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="${x}" y="166" width="180" height="104" rx="20" fill="none" stroke="#FCABA7" stroke-width="6"/>
      <rect x="48" y="420" width="904" height="8" rx="4" fill="#D9E9ED"/>
      <rect x="48" y="420" width="${(904 * (index + 1)) / cardCenters.length}" height="8" rx="4" fill="#77C9EC"/>
    </svg>`);
    const frame = await sharp(base.data, {
      raw: { width: base.info.width, height, channels: 4 },
    })
      .composite([{ input: overlay, top: 0, left: 0 }])
      .raw()
      .toBuffer();
    frames.push(frame);
  }

  await sharp(Buffer.concat(frames), {
    raw: {
      width: base.info.width,
      height: height * frames.length,
      channels: 4,
      pageHeight: height,
    },
  })
    .gif({ loop: 0, delay: [900, 900, 900, 1100, 1500], effort: 6 })
    .toFile(output);
}

const sourceLogo = path.join(brandDir, "source-logo.png");
if (!fs.existsSync(sourceLogo)) {
  throw new Error(`Missing confirmed source logo: ${sourceLogo}`);
}

const markSvg = await writeSvg("logo-mark.svg", logoMark());
const wordmarkSvg = await writeSvg("wordmark-horizontal.svg", wordmark());
const heroSvg = await writeSvg("hero-1600x600.svg", hero());
const socialSvg = await writeSvg("social-preview-1280x640.svg", socialPreview());
const architectureSvg = await writeSvg("architecture.svg", architecture(), diagramDir);
const contextSvg = await writeSvg("cross-channel-context.svg", crossChannel(), diagramDir);
const posterSvg = await writeSvg("voice-to-poster.svg", voiceToPoster(), diagramDir);

for (const size of [512, 128, 64, 32]) {
  await render(markSvg, path.join(brandDir, `logo-mark-${size}.png`), size);
}
await render(heroSvg, path.join(brandDir, "hero-1600x600.png"), 1600);
await render(socialSvg, path.join(brandDir, "social-preview-1280x640.png"), 1280);
await render(wordmarkSvg, path.join(brandDir, "wordmark-horizontal.png"), 1080);
await render(architectureSvg, path.join(diagramDir, "architecture.png"), 1500);
await render(contextSvg, path.join(diagramDir, "cross-channel-context.png"), 1500);
await render(posterSvg, path.join(diagramDir, "voice-to-poster.png"), 1500);
await renderVoiceWorkflowGif(posterSvg, path.join(demoDir, "voice-to-poster.gif"));

const manifest = {
  version: 1,
  generatedAt: "2026-09-14",
  source: "assets/brand/source-logo.png",
  palette: colors,
  outputs: [
    "assets/brand/logo-mark.svg",
    "assets/brand/logo-mark-512.png",
    "assets/brand/logo-mark-128.png",
    "assets/brand/logo-mark-64.png",
    "assets/brand/logo-mark-32.png",
    "assets/brand/wordmark-horizontal.svg",
    "assets/brand/wordmark-horizontal.png",
    "assets/brand/hero-1600x600.svg",
    "assets/brand/hero-1600x600.png",
    "assets/brand/social-preview-1280x640.svg",
    "assets/brand/social-preview-1280x640.png",
    "assets/diagrams/architecture.svg",
    "assets/diagrams/architecture.png",
    "assets/diagrams/cross-channel-context.svg",
    "assets/diagrams/cross-channel-context.png",
    "assets/diagrams/voice-to-poster.svg",
    "assets/diagrams/voice-to-poster.png",
    "assets/demo/voice-to-poster.gif"
  ],
  notes: [
    "The supplied pink-and-blue mascot is the only identity anchor.",
    "All copy, labels, sizes, and logo geometry are deterministically composed.",
    "No generated asset contains real account data, QR tokens, credentials, or platform logos."
  ]
};
fs.writeFileSync(path.join(root, "assets", "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log(`Generated ${manifest.outputs.length} brand and diagram assets.`);
