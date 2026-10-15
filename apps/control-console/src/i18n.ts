import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  detectClientPreferredLocale,
  type PreferredLocale,
} from "./preferred-locale";

export type ConsoleLocale = PreferredLocale;

const STORAGE_KEY = "lw-cc-lang";

type CommonJson = { default: Record<string, unknown> };

const loaders: Record<ConsoleLocale, () => Promise<CommonJson>> = {
  en: () => import("../public/locales/en/common.json"),
  "zh-CN": () => import("../public/locales/zh/common.json"),
  "zh-TW": () => import("../public/locales/zh-TW/common.json"),
  ja: () => import("../public/locales/ja/common.json"),
  ko: () => import("../public/locales/ko/common.json"),
  pt: () => import("../public/locales/pt/common.json"),
  nl: () => import("../public/locales/nl/common.json"),
  it: () => import("../public/locales/it/common.json"),
  es: () => import("../public/locales/es/common.json"),
  fr: () => import("../public/locales/fr/common.json"),
};

export function readConsoleLocale(): ConsoleLocale {
  const stored =
    typeof localStorage === "undefined"
      ? null
      : localStorage.getItem(STORAGE_KEY);
  return detectClientPreferredLocale(stored);
}

async function addLocale(locale: ConsoleLocale): Promise<void> {
  if (i18n.hasResourceBundle(locale, "common")) return;
  const pack = (await loaders[locale]()).default;
  i18n.addResourceBundle(locale, "common", pack, true, true);
}

export async function initConsoleI18n(): Promise<void> {
  const lng = readConsoleLocale();
  const pack = (await loaders[lng]()).default;
  await i18n.use(initReactI18next).init({
    lng,
    fallbackLng: lng,
    ns: ["common"],
    defaultNS: "common",
    interpolation: { escapeValue: false },
    resources: { [lng]: { common: pack } },
  });
}

export function setLanguage(locale: ConsoleLocale) {
  localStorage.setItem(STORAGE_KEY, locale);
  void addLocale(locale).then(() => i18n.changeLanguage(locale));
}

export default i18n;
