import fs from 'node:fs'
import path from 'node:path'
import { resolveWorkspacePath } from './lib/workspace.mjs'

const content = `---
description: NestJS HTTP adapter must be Fastify — never Express
alwaysApply: true
---

# NestJS + Fastify (LuminaryWorks ecosystem)

All NestJS HTTP services in the LuminaryWorks ecosystem use **\`@nestjs/platform-fastify\`**. Do **not** use Express.

## Required

- Bootstrap with \`FastifyAdapter\` + \`NestFastifyApplication\`.
- Dependencies: \`@nestjs/platform-fastify\`, \`fastify\` (pin to the version expected by the Nest platform package when types conflict).
- OpenAPI / Swagger UI on Fastify: install \`@fastify/static\` (do **not** add \`swagger-ui-express\`).
- Prefer Fastify plugins / hooks (\`app.register\`, content-type parsers) over Express-style \`app.use\` middleware.
- Raw body (e.g. webhook HMAC): custom Fastify \`addContentTypeParser\` / hooks — Nest's Express-only \`rawBody: true\` is forbidden.

## Forbidden

- \`@nestjs/platform-express\`
- \`NestExpressApplication\` / \`ExpressAdapter\`
- \`express\`, \`@types/express\`, \`swagger-ui-express\` as Nest HTTP stack deps
- Copy-pasting Express middleware patterns into new NestJS services

## Reference

- DataTalk: \`DataTalk/src/main.ts\` (\`FastifyAdapter\`)
- Entitlement: \`LuminaryWorks/services/entitlement/src/main.ts\`

## Scope

Applies to LuminaryWorks MetaRepo and all ecosystem products: DataLuminary, BlockyEdu, DoerFlow, VistaRemote, VistaCast, SyncroBrain (and their nested NestJS repos).
`

/** Segments under {workspace}/ (PascalCase dirs; resolved case-insensitively). */
const relativeTargets = [
  ['LuminaryWorks', '.cursor/rules/nestjs-fastify.mdc'],
  ['DataLuminary', '.cursor/rules/nestjs-fastify.mdc'],
  ['DataLuminary', 'DataTalk', '.cursor/rules/nestjs-fastify.mdc'],
  ['BlockyEdu', '.cursor/rules/nestjs-fastify.mdc'],
  ['BlockyEdu', 'edu-server', '.cursor/rules/nestjs-fastify.mdc'],
  ['BlockyEdu', 'server', '.cursor/rules/nestjs-fastify.mdc'],
  ['DoerFlow', '.cursor/rules/nestjs-fastify.mdc'],
  ['DoerFlow', 'repos', 'api', '.cursor/rules/nestjs-fastify.mdc'],
  ['VistaRemote', '.cursor/rules/nestjs-fastify.mdc'],
  ['VistaRemote', 'server', '.cursor/rules/nestjs-fastify.mdc'],
  ['VistaCast', '.cursor/rules/nestjs-fastify.mdc'],
  ['SyncroBrain', '.cursor/rules/nestjs-fastify.mdc'],
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
  console.log(`${bom ? 'BOM!' : 'ok '} ${file}`)
}
