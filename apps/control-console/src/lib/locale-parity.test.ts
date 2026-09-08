import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function flatten(value: unknown, prefix = ""): string[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, nested]) => flatten(nested, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(full);
  }
  return acc;
}

describe("locale parity", () => {
  const en = JSON.parse(
    readFileSync(join(root, "public/locales/en/common.json"), "utf8"),
  ) as Record<string, unknown>;
  const zh = JSON.parse(
    readFileSync(join(root, "public/locales/zh/common.json"), "utf8"),
  ) as Record<string, unknown>;

  it("has matching en/zh keys", () => {
    expect(flatten(en).sort()).toEqual(flatten(zh).sort());
  });

  it("does not use i18next defaultValue in source", () => {
    const hits = walk(join(root, "src")).filter((file) =>
      /defaultValue\s*:/.test(readFileSync(file, "utf8")),
    );
    expect(hits).toEqual([]);
  });
});
