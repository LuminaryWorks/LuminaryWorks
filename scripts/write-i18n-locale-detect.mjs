import fs from 'node:fs'
import path from 'node:path'
import { resolveWorkspacePath } from './lib/workspace.mjs'

const content = `---
description: i18n locale detection — browser language, then time zone, then English
alwaysApply: true
---

# i18n：语言检测与 10 语

登录页和产品界面使用同一套语言。实现以 \`@luminaryworks/auth-react\` 的 \`resolvePreferredLocale\` 为准；独立仓库复制 \`preferred-locale.ts\`，文件头注明与 auth-react 保持一致。

## 顺序

1. 用户已保存的语言（localStorage / cookie / 显式 URL）
2. 浏览器或系统语言列表（\`navigator.languages\` 或 \`Accept-Language\`），取第一个支持的标签
3. 时区只在上面都对不上支持列表时使用
4. 否则英文

已识别的浏览器语言不要被时区覆盖。例如浏览器是 \`en-US\`、时区是 \`Asia/Shanghai\` 时仍用英文。

## 支持语言

与登录卡片一致：\`zh-CN\`、\`zh-TW\`、\`ja\`、\`ko\`、\`en\`、\`pt\`、\`nl\`、\`it\`、\`es\`、\`fr\`。

- \`zh\` / \`zh-Hans\` → \`zh-CN\`；\`zh-TW\` / \`zh-HK\` / \`zh-Hant\` → \`zh-TW\`
- 未知标签最终回落 \`en\`，不要回落中文
- i18next 的最终 \`fallbackLng\` 为 \`en\`。\`zh-TW\` 可以先回落 \`zh-CN\` 再回落 \`en\`
- 不要在 \`t()\` 里写 \`defaultValue\`

## Scope

LuminaryWorks 与 DataLuminary、BlockyEdu、DoerFlow、VistaRemote、VistaCast、SyncroBrain 的登录页和产品界面。
`

const relativeTargets = [
  ['LuminaryWorks', '.cursor/rules/i18n-locale-detect.mdc'],
  ['DataLuminary', '.cursor/rules/i18n-locale-detect.mdc'],
  ['DataLuminary', 'DataTalk', '.cursor/rules/i18n-locale-detect.mdc'],
  ['DataLuminary', 'DataView', '.cursor/rules/i18n-locale-detect.mdc'],
  ['BlockyEdu', '.cursor/rules/i18n-locale-detect.mdc'],
  ['BlockyEdu', 'edu-server', '.cursor/rules/i18n-locale-detect.mdc'],
  ['BlockyEdu', 'server', '.cursor/rules/i18n-locale-detect.mdc'],
  ['BlockyEdu', 'edu-app-web', '.cursor/rules/i18n-locale-detect.mdc'],
  ['BlockyEdu', 'code-app-web', '.cursor/rules/i18n-locale-detect.mdc'],
  ['DoerFlow', '.cursor/rules/i18n-locale-detect.mdc'],
  ['DoerFlow', 'repos', 'api', '.cursor/rules/i18n-locale-detect.mdc'],
  ['DoerFlow', 'repos', 'web', '.cursor/rules/i18n-locale-detect.mdc'],
  ['DoerFlow', 'repos', 'admin', '.cursor/rules/i18n-locale-detect.mdc'],
  ['DoerFlow', 'repos', 'wallet', '.cursor/rules/i18n-locale-detect.mdc'],
  ['DoerFlow', 'repos', 'worker', '.cursor/rules/i18n-locale-detect.mdc'],
  ['VistaRemote', '.cursor/rules/i18n-locale-detect.mdc'],
  ['VistaRemote', 'server', '.cursor/rules/i18n-locale-detect.mdc'],
  ['VistaRemote', 'web', '.cursor/rules/i18n-locale-detect.mdc'],
  ['VistaRemote', 'shared', '.cursor/rules/i18n-locale-detect.mdc'],
  ['VistaCast', '.cursor/rules/i18n-locale-detect.mdc'],
  ['SyncroBrain', '.cursor/rules/i18n-locale-detect.mdc'],
]

const targets = relativeTargets.map((segs) => resolveWorkspacePath(...segs))

for (const file of targets) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, { encoding: 'utf8' })
}

console.log(`wrote ${targets.length} locale-detect rules`)
for (const file of targets) {
  const buf = fs.readFileSync(file)
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) throw new Error(`BOM: ${file}`)
  const text = fs.readFileSync(file, 'utf8')
  if (text.includes('\uFFFD') || text.includes('??')) throw new Error(`mojibake: ${file}`)
}
console.log('utf8-no-bom ok')
