/**
 * Convert NestJS injectable class imports from `import type` to value imports
 * so emitDecoratorMetadata / DI tokens remain at runtime.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "src");

/** Symbols that Nest must resolve at runtime via design:paramtypes or @Inject. */
const RUNTIME_SYMBOLS = new Set([
  "DataSource",
  "ConfigService",
  "Reflector",
  "HealthCheckService",
  "TypeOrmHealthIndicator",
  "ModuleRef",
  "HttpService",
  "Request",
]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".spec.ts")) out.push(p);
  }
  return out;
}

function fixFile(file) {
  let src = fs.readFileSync(file, "utf8");
  const original = src;

  // import type { A, B } from "x" where A/B are runtime Nest deps
  src = src.replace(
    /import\s+type\s*\{([^}]+)\}\s*from\s*(["'][^"']+["']);/g,
    (full, names, from) => {
      const parts = names.split(",").map((s) => s.trim()).filter(Boolean);
      const runtime = [];
      const typesOnly = [];
      for (const p of parts) {
        const name = p.replace(/^type\s+/, "").trim();
        if (RUNTIME_SYMBOLS.has(name) || /Service$|Guard$|Adapter$|Indicator$/.test(name)) {
          // Keep DTO/types that happen to end with Service? No — be conservative:
          if (RUNTIME_SYMBOLS.has(name) || /(Service|Guard|Adapter|Indicator)$/.test(name)) {
            // Avoid converting pure DTO modules
            if (from.includes("/dto") || from.includes(".dto") || from.includes("auth.types") || from.includes("constants") || from.includes("partner.dto") || from.includes("notify-adapter") || from.includes("payment-adapter") || from.includes("ed25519") || from.includes("entitlement.config")) {
              typesOnly.push(p.startsWith("type ") ? p : `type ${name}`);
            } else {
              runtime.push(name);
            }
          } else {
            typesOnly.push(p);
          }
        } else {
          typesOnly.push(p.startsWith("type ") ? p : p.includes(" ") ? p : `type ${name}`);
        }
      }
      // Simplify: for known runtime set always value-import
      const forcedRuntime = parts
        .map((p) => p.replace(/^type\s+/, "").trim())
        .filter((n) => RUNTIME_SYMBOLS.has(n));
      const rest = parts
        .map((p) => p.replace(/^type\s+/, "").trim())
        .filter((n) => !RUNTIME_SYMBOLS.has(n));
      if (forcedRuntime.length === 0) return full;
      const valuePart = forcedRuntime.join(", ");
      const typePart = rest.map((n) => `type ${n}`).join(", ");
      if (typePart) return `import { ${valuePart}, ${typePart} } from ${from};`;
      return `import { ${valuePart} } from ${from};`;
    },
  );

  // Also fix inline `import { type HealthCheckService, ...}`
  src = src.replace(
    /import\s*\{([^}]+)\}\s*from\s*(["']@nestjs\/terminus["']);/g,
    (full, names, from) => {
      const parts = names.split(",").map((s) => s.trim()).filter(Boolean);
      const next = parts.map((p) => {
        const m = p.match(/^type\s+(\w+)$/);
        if (m && RUNTIME_SYMBOLS.has(m[1])) return m[1];
        return p;
      });
      return `import { ${next.join(", ")} } from ${from};`;
    },
  );

  src = src.replace(
    /import\s*\{([^}]+)\}\s*from\s*(["']@nestjs\/config["']);/g,
    (full, names, from) => {
      const parts = names.split(",").map((s) => s.trim()).filter(Boolean);
      const next = parts.map((p) => {
        const m = p.match(/^type\s+(\w+)$/);
        if (m && RUNTIME_SYMBOLS.has(m[1])) return m[1];
        return p;
      });
      return `import { ${next.join(", ")} } from ${from};`;
    },
  );

  if (src !== original) {
    fs.writeFileSync(file, src);
    return true;
  }
  return false;
}

const files = walk(ROOT);
let n = 0;
for (const f of files) {
  if (fixFile(f)) {
    console.log("fixed", path.relative(ROOT, f));
    n += 1;
  }
}
console.log(`done: ${n} files`);
