import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../public/locales/en/common.json";
import es from "../public/locales/es/common.json";
import fr from "../public/locales/fr/common.json";
import it from "../public/locales/it/common.json";
import ja from "../public/locales/ja/common.json";
import ko from "../public/locales/ko/common.json";
import nl from "../public/locales/nl/common.json";
import pt from "../public/locales/pt/common.json";
import zh from "../public/locales/zh/common.json";
import zhTW from "../public/locales/zh-TW/common.json";
import {
  detectClientPreferredLocale,
  type PreferredLocale,
} from "./preferred-locale";

export type ConsoleLocale = PreferredLocale;

const STORAGE_KEY = "lw-cc-lang";

export function readConsoleLocale(): ConsoleLocale {
  const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  return detectClientPreferredLocale(stored);
}

void i18n.use(initReactI18next).init({
  lng: readConsoleLocale(),
  fallbackLng: {
    "zh-TW": ["zh-CN", "en"],
    zh: ["zh-CN", "en"],
    default: ["en"],
  },
  ns: ["common"],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  resources: {
    en: { common: en },
    zh: { common: zh },
    "zh-CN": { common: zh },
    "zh-TW": { common: zhTW },
    ja: { common: ja },
    ko: { common: ko },
    pt: { common: pt },
    nl: { common: nl },
    it: { common: it },
    es: { common: es },
    fr: { common: fr },
  },
});

export function setLanguage(locale: ConsoleLocale) {
  localStorage.setItem(STORAGE_KEY, locale);
  void i18n.changeLanguage(locale);
}

export default i18n;
