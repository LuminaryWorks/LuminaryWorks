#!/usr/bin/env node
/**
 * Sync spec/legal markdown into website/content/legal for static export.
 *
 * Usage:
 *   node scripts/sync-legal.mjs          # write synced files
 *   node scripts/sync-legal.mjs --check  # verify only (CI)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SPEC_LEGAL = path.join(ROOT, "spec/legal");
const WEBSITE_LEGAL = path.join(ROOT, "website/content/legal");

/** spec/legal still uses `zh`; website stores Simplified Chinese as `zh-CN`. */
const LOCALE_MAP = [
  { spec: "zh", dest: "zh-CN", linkLocale: "zh-CN" },
  { spec: "en", dest: "en", linkLocale: "en" },
];

const SLUGS = ["terms", "privacy", "trial-data-deletion"];

const SLUG_FROM_FILE = {
  "terms.md": "terms",
  "privacy.md": "privacy",
  "trial-data-deletion.md": "trial-data-deletion",
};

function assertUtf8(text, fileLabel) {
  if (text.includes("\uFFFD") || /\?{2,}/.test(text)) {
    throw new Error(`Mojibake detected in ${fileLabel}`);
  }
}

function localePath(linkLocale, slug) {
  return linkLocale === "zh-CN" ? `/legal/${slug}/` : `/en/legal/${slug}/`;
}

function rewriteLinks(markdown, linkLocale) {
  return markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, label, href) => {
    const trimmed = href.trim();

    if (
      trimmed.startsWith("../../") ||
      trimmed.startsWith("../decisions/") ||
      trimmed.startsWith("../payment-platform") ||
      trimmed.includes("subscription-and-entitlement")
    ) {
      return label;
    }

    const fileName = path.basename(trimmed);
    if (SLUG_FROM_FILE[fileName]) {
      const slug = SLUG_FROM_FILE[fileName];
      if (trimmed.startsWith("./")) {
        return `[${label}](${localePath(linkLocale, slug)})`;
      }
      if (trimmed.startsWith("../en/")) {
        return `[${label}](${localePath("en", slug)})`;
      }
      if (trimmed.startsWith("../zh/")) {
        return `[${label}](${localePath("zh-CN", slug)})`;
      }
    }

    return full;
  });
}

function syncFile(specLocale, destLocale, linkLocale, slug) {
  const src = path.join(SPEC_LEGAL, specLocale, `${slug}.md`);
  const dest = path.join(WEBSITE_LEGAL, destLocale, `${slug}.md`);

  if (!fs.existsSync(src)) {
    throw new Error(`Missing source: ${src}`);
  }

  const raw = fs.readFileSync(src, "utf8");
  assertUtf8(raw, src);
  const rewritten = rewriteLinks(raw, linkLocale);
  assertUtf8(rewritten, dest);

  return { src, dest, content: rewritten };
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const synced = [];

  for (const { spec, dest, linkLocale } of LOCALE_MAP) {
    for (const slug of SLUGS) {
      const { src, dest: destPath, content } = syncFile(spec, dest, linkLocale, slug);

      if (checkOnly) {
        if (!fs.existsSync(destPath)) {
          throw new Error(`Missing destination (run sync): ${destPath}`);
        }
        const existing = fs.readFileSync(destPath, "utf8");
        if (existing !== content) {
          throw new Error(`Out of sync: ${destPath} (source: ${src})`);
        }
        synced.push(destPath);
        continue;
      }

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, content, "utf8");
      synced.push(destPath);
    }
  }

  const mode = checkOnly ? "check OK" : "synced";
  console.log(`sync-legal: ${mode} ${synced.length} file(s):`);
  for (const file of synced) {
    console.log(`  ${path.relative(ROOT, file)}`);
  }
}

main();
