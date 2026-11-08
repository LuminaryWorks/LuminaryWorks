import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  detectClientPreferredLocale,
  type PreferredLocale,
} from "./preferred-locale";

export type AccountLocale = PreferredLocale;

const STORAGE_KEY = "lw-ac-lang";

type CommonJson = { default: Record<string, unknown> };

const loaders: Record<AccountLocale, () => Promise<CommonJson>> = {
  en: () => import("../public/locales/en/common.json"),
  "zh-CN": () => import("../public/locales/zh-CN/common.json"),
  "zh-TW": () => import("../public/locales/zh-TW/common.json"),
  ja: () => import("../public/locales/ja/common.json"),
  ko: () => import("../public/locales/ko/common.json"),
  pt: () => import("../public/locales/pt/common.json"),
  nl: () => import("../public/locales/nl/common.json"),
  it: () => import("../public/locales/it/common.json"),
  es: () => import("../public/locales/es/common.json"),
  fr: () => import("../public/locales/fr/common.json"),
};

export function readAccountLocale(): AccountLocale {
  const stored =
    typeof localStorage === "undefined"
      ? null
      : localStorage.getItem(STORAGE_KEY);
  return detectClientPreferredLocale(stored);
}

async function addLocale(locale: AccountLocale): Promise<void> {
  if (i18n.hasResourceBundle(locale, "common")) return;
  const pack = (await loaders[locale]()).default;
  i18n.addResourceBundle(locale, "common", pack, true, true);
}

export async function initAccountI18n(): Promise<void> {
  const lng = readAccountLocale();
  const en = (await loaders.en()).default;
  const pack = lng === "en" ? en : (await loaders[lng]()).default;
  await i18n.use(initReactI18next).init({
    lng,
    fallbackLng: "en",
    ns: ["common"],
    defaultNS: "common",
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    resources: {
      en: { common: en },
      ...(lng === "en" ? {} : { [lng]: { common: pack } }),
    },
  });
}

export function setLanguage(locale: AccountLocale) {
  localStorage.setItem(STORAGE_KEY, locale);
  void addLocale(locale).then(() => i18n.changeLanguage(locale));
}

export default i18n;
