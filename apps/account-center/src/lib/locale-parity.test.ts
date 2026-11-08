import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@rstest/core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REQUIRED = [
  "en",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko",
  "pt",
  "nl",
  "it",
  "es",
  "fr",
];

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

  it("has the ten login locales and matching keys", () => {
    const expected = flatten(en).sort();
    const locales = readdirSync(join(root, "public/locales")).sort();
    expect(locales).toEqual([...REQUIRED].sort());
    for (const locale of locales) {
      const file = join(root, "public/locales", locale, "common.json");
      const json = JSON.parse(readFileSync(file, "utf8")) as Record<
        string,
        unknown
      >;
      expect(flatten(json).sort(), locale).toEqual(expected);
    }
  });

  it("does not use i18next defaultValue in source", () => {
    const hits = walk(join(root, "src")).filter((file) =>
      /defaultValue\s*:/.test(readFileSync(file, "utf8")),
    );
    expect(hits).toEqual([]);
  });
});
