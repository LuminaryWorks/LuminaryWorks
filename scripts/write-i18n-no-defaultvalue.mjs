import fs from 'node:fs'
import path from 'node:path'
import { resolveWorkspacePath } from './lib/workspace.mjs'

const content = `---
description: i18n — never use defaultValue in t(); put strings in locale JSON
alwaysApply: true
---

# i18n：禁止 \`defaultValue\`（LuminaryWorks 生态）

全生态（DataLuminary、BlockyEdu、DoerFlow、VistaRemote、VistaCast、SyncroBrain 等）统一：**不要在 \`t()\` / \`i18n.t()\` 里写 \`defaultValue\`**。

## Required

- 文案写入 locale JSON：**英文** \`public/locales/en/{ns}.json\`（或各产品等价路径），**中文** \`public/locales/zh/{ns}.json\`。
- 组件内只传 key；需要插值时只保留 \`{{var}}\` 对应字段：

\`\`\`tsx
// ✅ GOOD
t("ai.model");
t("ai.testOk", { model: result.model });

// ❌ BAD — 禁止 inline fallback
t("ai.model", { defaultValue: "Model" });
t(item.labelKey, { defaultValue: item.defaultLabel });
\`\`\`

- 新增 key 时 **同时** 补 \`en\` + \`zh\`；缺失 key 应修 locale 文件，而不是在代码里兜底。
- 非 React 模块用 \`import i18n from "@/i18n"\`（或各产品等价入口）后 \`i18n.t("key")\`。

## Forbidden

- \`t("key", { defaultValue: "…" })\` 或任何 i18next \`defaultValue\` 选项
- 用中文/英文硬编码充当「临时 fallback」而不写入 locale JSON
- 动态 \`defaultValue\`（如 \`titleDefault\`、\`item.defaultLabel\` 传给 \`t()\`）

## 不在此规则范围

以下 **不是** i18n，允许保留命名 \`defaultValue\`：

- Ant Design / React Hook Form 字段初值（\`<Select defaultValue={…}>\`、\`Form.Item initialValue\`）
- 实体/DTO 字段名（如 Variable 的 \`defaultValue: null\`）
- 环境变量 helper 参数名（如 \`env('KEY', defaultValue)\`）

## Reference

- DataView（示例）：\`DataLuminary/DataView/src/i18n/\` · \`public/locales/\`
- 生态同步：在 LuminaryWorks 根目录运行 \`pnpm sync:cursor-i18n-rule\`

## Scope

Applies to all LuminaryWorks MetaRepos and nested product repos with i18next / react-i18next UI.
`

/** Same layout as write-model-usage-policy.mjs */
const relativeTargets = [
  ['LuminaryWorks', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['DataLuminary', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['DataLuminary', 'DataTalk', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['DataLuminary', 'DataView', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['BlockyEdu', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['BlockyEdu', 'edu-server', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['BlockyEdu', 'server', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['BlockyEdu', 'edu-app-web', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['BlockyEdu', 'code-app-web', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['DoerFlow', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['DoerFlow', 'repos', 'api', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['DoerFlow', 'repos', 'web', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['DoerFlow', 'repos', 'admin', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['DoerFlow', 'repos', 'wallet', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['DoerFlow', 'repos', 'worker', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['VistaRemote', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['VistaRemote', 'server', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['VistaRemote', 'web', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['VistaRemote', 'shared', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['VistaCast', '.cursor/rules/i18n-no-defaultvalue.mdc'],
  ['SyncroBrain', '.cursor/rules/i18n-no-defaultvalue.mdc'],
]

const targets = relativeTargets.map((segs) => resolveWorkspacePath(...segs))

for (const file of targets) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, { encoding: 'utf8' })
}

console.log(`wrote ${targets.length} files`)
for (const file of targets) {
  const buf = fs.readFileSync(file)
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  if (bom) throw new Error(`BOM: ${file}`)
  if (!fs.readFileSync(file, 'utf8').includes('alwaysApply: true')) {
    throw new Error(`missing alwaysApply: ${file}`)
  }
}
console.log('utf8-no-bom ok')
