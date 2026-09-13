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

const LOCALES = ["zh", "en"];
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

function localePath(locale, slug) {
  return locale === "zh" ? `/legal/${slug}/` : `/en/legal/${slug}/`;
}

function rewriteLinks(markdown, locale) {
  return markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, label, href) => {
    const trimmed = href.trim();

    // Strip internal MetaRepo spec links — keep label text only
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
        return `[${label}](${localePath(locale, slug)})`;
      }
      if (trimmed.startsWith("../en/")) {
        return `[${label}](${localePath("en", slug)})`;
      }
      if (trimmed.startsWith("../zh/")) {
        return `[${label}](${localePath("zh", slug)})`;
      }
    }

    return full;
  });
}

function syncFile(locale, slug) {
  const src = path.join(SPEC_LEGAL, locale, `${slug}.md`);
  const dest = path.join(WEBSITE_LEGAL, locale, `${slug}.md`);

  if (!fs.existsSync(src)) {
    throw new Error(`Missing source: ${src}`);
  }

  const raw = fs.readFileSync(src, "utf8");
  assertUtf8(raw, src);
  const rewritten = rewriteLinks(raw, locale);
  assertUtf8(rewritten, dest);

  return { src, dest, content: rewritten };
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const synced = [];

  for (const locale of LOCALES) {
    for (const slug of SLUGS) {
      const { src, dest, content } = syncFile(locale, slug);

      if (checkOnly) {
        if (!fs.existsSync(dest)) {
          throw new Error(`Missing destination (run sync): ${dest}`);
        }
        const existing = fs.readFileSync(dest, "utf8");
        if (existing !== content) {
          throw new Error(`Out of sync: ${dest} (source: ${src})`);
        }
        synced.push(dest);
        continue;
      }

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content, "utf8");
      synced.push(dest);
    }
  }

  const mode = checkOnly ? "check OK" : "synced";
  console.log(`sync-legal: ${mode} ${synced.length} file(s):`);
  for (const file of synced) {
    console.log(`  ${path.relative(ROOT, file)}`);
  }
}

main();
