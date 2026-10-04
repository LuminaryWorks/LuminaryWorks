import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveWorkspacePath } from './lib/workspace.mjs'

const source = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../.cursor/rules/product-login-terms.mdc',
)
const content = fs.readFileSync(source, 'utf8')
if (!content.includes('alwaysApply: true')) {
  throw new Error('source rule missing alwaysApply')
}

const relativeTargets = [
  ['LuminaryWorks', '.cursor/rules/product-login-terms.mdc'],
  ['DataLuminary', '.cursor/rules/product-login-terms.mdc'],
  ['DataLuminary', 'DataTalk', '.cursor/rules/product-login-terms.mdc'],
  ['DataLuminary', 'DataView', '.cursor/rules/product-login-terms.mdc'],
  ['BlockyEdu', '.cursor/rules/product-login-terms.mdc'],
  ['DoerFlow', '.cursor/rules/product-login-terms.mdc'],
  ['DoerFlow', 'repos', 'web', '.cursor/rules/product-login-terms.mdc'],
  ['DoerFlow', 'repos', 'wallet', '.cursor/rules/product-login-terms.mdc'],
  ['VistaRemote', '.cursor/rules/product-login-terms.mdc'],
  ['VistaRemote', 'web', '.cursor/rules/product-login-terms.mdc'],
  ['VistaCast', '.cursor/rules/product-login-terms.mdc'],
  ['SyncroBrain', '.cursor/rules/product-login-terms.mdc'],
]

let written = 0
for (const segs of relativeTargets) {
  const productRoot = resolveWorkspacePath(segs[0])
  if (segs[0] !== 'LuminaryWorks' && !fs.existsSync(productRoot)) {
    console.warn(`skip missing ${segs[0]}`)
    continue
  }
  const file = resolveWorkspacePath(...segs)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, { encoding: 'utf8' })
  const buf = fs.readFileSync(file)
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  if (bom) throw new Error(`BOM: ${file}`)
  written += 1
}

console.log(`wrote ${written} files`)
