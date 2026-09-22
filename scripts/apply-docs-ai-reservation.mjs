/**
 * Apply a public-docs AI reservation to each product docs site.
 * Idempotent. Does not commit or push.
 *
 * Run from LuminaryWorks: node scripts/apply-docs-ai-reservation.mjs
 */
import fs from "node:fs";
import path from "node:path";

const workspace = path.resolve(import.meta.dirname, "..", "..");

const PREAMBLE = `# As a condition of accessing this website, you agree to abide by the following
# content signals:

# (a)  If a content-signal = yes, you may collect content for the corresponding
#      use.
# (b)  If a content-signal = no, you may not collect content for the
#      corresponding use.
# (c)  If the website operator does not include a content signal for a
#      corresponding use, the website operator neither grants nor restricts
#      permission via content signal with respect to the corresponding use.

# The content signals and their meanings are:

# search:   building a search index and providing search results (e.g., returning
#           hyperlinks and short excerpts from your website's contents). Search does not
#           include providing AI-generated search summaries.
# ai-input: inputting content into one or more AI models (e.g., retrieval
#           augmented generation, grounding, or other real-time taking of content for
#           generative AI search answers).
# ai-train: training or fine-tuning AI models.

# ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS RESERVATIONS OF
# RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790 ON COPYRIGHT
# AND RELATED RIGHTS IN THE DIGITAL SINGLE MARKET.

# Search indexing is allowed. AI training and AI input are not.
User-agent: *
Content-Signal: search=yes, ai-train=no, ai-input=no
Allow: /

# Crawlers that collect content for training or for model input.
# Search crawlers (Googlebot, bingbot, Applebot) are intentionally not listed.
User-agent: Amazonbot
User-agent: Applebot-Extended
User-agent: Bytespider
User-agent: CCBot
User-agent: ClaudeBot
User-agent: Claude-SearchBot
User-agent: Claude-User
User-agent: Claude-Web
User-agent: anthropic-ai
User-agent: cohere-ai
User-agent: cohere-training-data-crawler
User-agent: Diffbot
User-agent: DuckAssistBot
User-agent: FacebookBot
User-agent: Google-CloudVertexBot
User-agent: Google-Extended
User-agent: GPTBot
User-agent: ChatGPT-User
User-agent: OAI-SearchBot
User-agent: ImagesiftBot
User-agent: Meta-ExternalAgent
User-agent: meta-externalagent
User-agent: Meta-ExternalFetcher
User-agent: meta-externalfetcher
User-agent: PerplexityBot
User-agent: Perplexity-User
User-agent: PetalBot
User-agent: Timpibot
User-agent: YouBot
User-agent: AI2Bot
User-agent: omgili
User-agent: omgilibot
Disallow: /

`;

const PUBLISH_SCRIPT = `import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'doc_build');
if (!fs.existsSync(outDir)) {
  console.error('doc_build is missing; rspress build did not produce output');
  process.exit(1);
}

const publicDir = fs.existsSync(path.join(root, 'docs/public/robots.txt'))
  ? path.join(root, 'docs/public')
  : path.join(root, 'public');

fs.copyFileSync(path.join(publicDir, 'robots.txt'), path.join(outDir, 'robots.txt'));
fs.cpSync(path.join(publicDir, '.well-known'), path.join(outDir, '.well-known'), {
  recursive: true,
});
`;

const sites = [
  {
    root: path.join(workspace, "LuminaryWorks/docs"),
    product: "LuminaryWorks（启明工坊）",
    site: "https://docs.luminaryworks.dev",
    repoUrl: "https://github.com/LuminaryWorks/docs",
    quotes: "double",
    footerFrom: 'message: "LuminaryWorks · 启明工坊 · AI 原生开源生态",',
    footerTo:
      'message: "LuminaryWorks · 启明工坊 · 公开阅读 · 禁止用于 AI 训练或生成同类产品（/legal/ai-use）",',
    writeReadme: true,
  },
  {
    root: path.join(workspace, "DataLuminary/docs"),
    product: "DataLuminary（数据明鉴）",
    site: "https://docs.dataluminary.dev",
    repoUrl: "https://github.com/DataLuminary/docs",
    quotes: "double",
    footerFrom: `    ],
  },
});`,
    footerTo: `    ],
    footer: {
      message: "DataLuminary · 数据明鉴 · 公开阅读 · 禁止用于 AI 训练或生成同类产品（/legal/ai-use）",
    },
  },
});`,
  },
  {
    root: path.join(workspace, "DoerFlow/repos/docs"),
    product: "DoerFlow（智工网）",
    site: "https://docs.doerflow.dev",
    repoUrl: "https://github.com/doerflow/docs",
    quotes: "single",
    footerFrom: "message: 'DoerFlow · doerflow.dev · MIT',",
    footerTo:
      "message: 'DoerFlow · doerflow.dev · Polyform Noncommercial · 禁止用于 AI 训练或生成同类产品（/legal/ai-use）',",
  },
  {
    root: path.join(workspace, "VistaCast/docs"),
    product: "VistaCast（视界云遥）",
    site: "https://docs.vistacast.dev",
    repoUrl: "https://github.com/VistaCast/VistaCast",
    quotes: "double",
    footerFrom:
      'message: "VistaCast · 视界云遥 · LuminaryWorks 启明工坊生态 · Apache-2.0",',
    footerTo:
      'message: "VistaCast · 视界云遥 · Polyform Noncommercial · 禁止用于 AI 训练或生成同类产品（/legal/ai-use）",',
  },
  {
    root: path.join(workspace, "VistaRemote/docs"),
    product: "VistaRemote（视界远程）",
    site: null,
    repoUrl: "https://github.com/VistaRemote/docs",
    quotes: "single",
    locales: true,
    footerFrom: "message: '© VibeCode · VistaRemote — 立足中国，面向全球开源社区',",
    footerTo:
      "message: '© VibeCode · VistaRemote · 公开阅读 · 禁止用于 AI 训练或生成同类产品（/legal/ai-use）',",
  },
  {
    root: path.join(workspace, "SyncroBrain/docs"),
    product: "SyncroBrain（万物智脑）",
    site: null,
    repoUrl: "https://github.com/syncrobrain/docs",
    quotes: "double",
    footerFrom: `      message:
        "SyncroBrain · 万物智脑 · LuminaryWorks 生态 · 公开文档仓 syncrobrain/docs",`,
    footerTo: `message:
        "SyncroBrain · 万物智脑 · 公开阅读 · 禁止用于 AI 训练或生成同类产品（/legal/ai-use）",`,
  },
];

function writeUtf8(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (text.includes("\uFFFD") || /\?{3,}/.test(text)) {
    throw new Error(`refusing to write mojibake: ${file}`);
  }
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

function readText(file) {
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}

function policyUrl(site) {
  if (site.site) return `${site.site}/legal/ai-use`;
  return `${site.repoUrl}/blob/main/AI-USE.md`;
}

function chineseBody(site) {
  const where = site.site
    ? `发布站点：${site.site}。`
    : `公开仓库：${site.repoUrl}。仓库里的 Markdown 同样适用下面的边界。`;
  return `这些文档是公开的，供人阅读。${where}

搜索引擎可以抓取页面、建立索引，并在搜索结果中显示标题和短摘录。短摘录不包括把正文交给生成式模型。

## 不许可

权利人是 ${site.product}。仓库根目录的 LICENSE 是 [Polyform Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)。下面两种使用没有获得许可，也不属于该许可证中的允许目的：

1. 用这些文档训练、微调或评测机器学习模型，包括当作预训练语料、指令数据或偏好数据。
2. 把这些文档当作规格或输入，生成、改写或拼装出与 ${site.product} 实质相同或可替代的产品、架构或实现。包括把全文交给对话式 AI，让它按这些文档做一套一样的产品。

普通人阅读、链接到文档、引用短句，以及法律没有允许权利人排除的合理使用，仍然可以。

## 机器可读声明

同一边界也写在爬虫能读的位置。文档站发布后可以在这些地址看到：

- \`/robots.txt\`：允许搜索；\`Content-Signal: search=yes, ai-train=no, ai-input=no\`；并拒绝常见 AI 爬虫抓取全文
- \`/.well-known/tdmrep.json\`：按欧盟《数字化单一市场版权指令》第 4 条，保留文本与数据挖掘权利（\`tdm-reservation: 1\`）
- 每个 HTML 页面的 \`noai\`、\`noimageai\`、\`noarchive\` 与 \`tdm-reservation\`

GitHub 上的仓库页面由 GitHub 控制，不能靠文档站的 robots.txt 挡住。对仓库副本，以本说明和 LICENSE 为准。

## 做不到的事

文档只要公开，就拦不住有人复制文字再贴进某个 AI。这些声明也删不掉已经进过模型的旧副本。它们写明这项使用没有许可，并让遵守 robots.txt 和欧盟保留声明的爬虫不要把文档收进训练集，或当作模型输入。

## English

This documentation is public for people to read and for search engines to index titles and short excerpts.

You may not use it to train or fine-tune machine-learning models, or as input to generate a competing or substantially similar implementation of ${site.product}. That includes pasting these documents into a chatbot and asking it to rebuild the product.

This is not a technical lock. It is a rights reservation, including a machine-readable reservation of text-and-data-mining rights under EU Directive 2019/790 Article 4.
`;
}

function englishPage(site) {
  return `---
title: Documentation use
---

# Documentation use

This documentation is public for people to read. Search engines may index it and show titles and short excerpts. Short excerpts do not include feeding the body into a generative model.

Copyright in ${site.product} is reserved. The repository LICENSE is Polyform Noncommercial 1.0.0. The following uses are not licensed, and are not permitted purposes under that license:

1. Training, fine-tuning, or evaluating machine-learning models on these documents.
2. Using these documents as a specification or model input to generate a substantially similar or substitute product, architecture, or implementation. That includes asking a chatbot to rebuild the product from this text.

Reading, linking, short quotation, and uses the law does not allow a rightsholder to reserve, remain allowed.

Machine-readable form: \`/robots.txt\` (\`Content-Signal: search=yes, ai-train=no, ai-input=no\`), \`/.well-known/tdmrep.json\` (\`tdm-reservation: 1\`, EU Directive 2019/790 Article 4), and page meta tags \`noai\`, \`noimageai\`, \`noarchive\`.

A public page can still be copied by a person into a chatbot. This page states that such use is not permitted. It does not erase copies already inside a model. The Chinese statement is [文档使用边界](/legal/ai-use).
`;
}

function sitePage(site) {
  return `---
title: 文档使用边界
---

# 文档使用边界

${chineseBody(site)}`;
}

function aiUse(site) {
  return `# 文档使用边界

本文件约束本 Git 仓库中的产品文档；文档站若已发布，站内页面适用同一边界。许可证原文在仓库根目录 [LICENSE](./LICENSE)。

${chineseBody(site)}`;
}

function readmeSection() {
  return `## 使用边界

这些文档公开供人阅读，也允许搜索引擎索引。**不允许**用于训练 AI，也不允许把文档交给 AI 去生成一套同类产品。详见 [AI-USE.md](./AI-USE.md)。
`;
}

function insertHead(configPath, site) {
  let text = readText(configPath);
  if (text.includes("tdm-reservation")) return;
  const q = site.quotes === "single" ? "'" : '"';
  const url = policyUrl(site);
  const block = `  head: [
    [${q}meta${q}, { name: ${q}robots${q}, content: ${q}noai, noimageai, noarchive${q} }],
    [${q}meta${q}, { name: ${q}tdm-reservation${q}, content: ${q}1${q} }],
    [${q}meta${q}, { name: ${q}tdm-policy${q}, content: ${q}${url}${q} }],
  ],
`;
  const needle = "export default defineConfig({";
  const at = text.indexOf(needle);
  if (at < 0) throw new Error(`defineConfig not found: ${configPath}`);
  const nl = text.indexOf("\n", at);
  text = `${text.slice(0, nl + 1)}${block}${text.slice(nl + 1)}`;
  writeUtf8(configPath, text);
}

function patchFooter(configPath, site) {
  let text = readText(configPath);
  if (text.includes("禁止用于 AI 训练或生成同类产品")) return;
  if (!text.includes(site.footerFrom)) {
    throw new Error(`footer anchor missing in ${configPath}`);
  }
  text = text.replace(site.footerFrom, site.footerTo);
  writeUtf8(configPath, text);
}

function patchBuild(pkgPath) {
  let text = readText(pkgPath);
  if (text.includes("publish-ai-reservation")) return;
  const next = text.replace(/"build": "([^"]+)"/, (_m, cmd) => {
    return `"build": "${cmd} && node scripts/publish-ai-reservation.mjs"`;
  });
  if (next === text) throw new Error(`build script not found: ${pkgPath}`);
  writeUtf8(pkgPath, next);
}

function patchReadme(readmePath) {
  if (!fs.existsSync(readmePath)) return;
  let text = readText(readmePath);
  if (text.includes("AI-USE.md")) return;
  const nl = text.indexOf("\n");
  const section = readmeSection();
  text = `${text.slice(0, nl + 1)}\n${section}\n${text.slice(nl + 1)}`;
  writeUtf8(readmePath, text);
}

function apply(site) {
  if (!fs.existsSync(site.root)) throw new Error(`missing ${site.root}`);
  const publicDir = path.join(site.root, "docs/public");
  writeUtf8(path.join(publicDir, "robots.txt"), PREAMBLE);
  const tdm = [
    {
      location: "/",
      "tdm-reservation": 1,
      "tdm-policy": policyUrl(site),
    },
  ];
  const tdmText = `${JSON.stringify(tdm, null, 2)}\n`;
  JSON.parse(tdmText);
  writeUtf8(path.join(publicDir, ".well-known/tdmrep.json"), tdmText);
  writeUtf8(path.join(site.root, "scripts/publish-ai-reservation.mjs"), PUBLISH_SCRIPT);
  writeUtf8(path.join(site.root, "AI-USE.md"), aiUse(site));
  if (site.locales) {
    writeUtf8(path.join(site.root, "docs/zh/legal/ai-use.md"), sitePage(site));
    writeUtf8(path.join(site.root, "docs/en/legal/ai-use.md"), englishPage(site));
  } else {
    writeUtf8(path.join(site.root, "docs/legal/ai-use.md"), sitePage(site));
  }
  if (site.writeReadme && !fs.existsSync(path.join(site.root, "README.md"))) {
    writeUtf8(
      path.join(site.root, "README.md"),
      `# ${site.product} 文档\n\n发布站点：${site.site}\n\n${readmeSection()}`,
    );
  }
  patchReadme(path.join(site.root, "README.md"));
  insertHead(path.join(site.root, "rspress.config.ts"), site);
  patchFooter(path.join(site.root, "rspress.config.ts"), site);
  patchBuild(path.join(site.root, "package.json"));
  console.log("applied", site.root);
}

for (const site of sites) apply(site);

const written = [];
for (const site of sites) {
  const stack = [site.root];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      if (name === "node_modules" || name === "doc_build" || name === ".git") continue;
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) stack.push(full);
      else if (/\.(md|json|txt|mjs|ts)$/.test(name)) written.push(full);
    }
  }
}

for (const file of written) {
  if (!file.includes("AI-USE") && !file.includes("ai-use") && !file.includes("tdmrep") && !file.includes("robots.txt") && !file.includes("rspress.config") && !file.includes("publish-ai-reservation") && !file.endsWith("README.md") && !file.endsWith("package.json")) {
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("\uFFFD") || text.charCodeAt(0) === 0xfeff) {
    throw new Error(`encoding check failed: ${file}`);
  }
}
console.log("encoding ok");
