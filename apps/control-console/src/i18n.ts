import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../public/locales/en/common.json";
import zh from "../public/locales/zh/common.json";

export type ConsoleLocale = "en" | "zh-CN" | "zh-TW" | "es";

/** Shell JSON only has en/zh. Traditional Chinese uses zh; Spanish uses en. */
export function shellLanguage(locale: string): "en" | "zh" {
  return locale === "zh-CN" || locale === "zh" || locale === "zh-TW"
    ? "zh"
    : "en";
}

export function readConsoleLocale(): ConsoleLocale {
  if (typeof localStorage === "undefined") return "en";
  const raw = localStorage.getItem("lw-cc-lang") || "en";
  if (raw === "zh" || raw === "zh-CN") return "zh-CN";
  if (raw === "zh-TW" || raw === "es" || raw === "en") return raw;
  return "en";
}

void i18n.use(initReactI18next).init({
  lng: shellLanguage(readConsoleLocale()),
  fallbackLng: "en",
  ns: ["common"],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  resources: {
    en: { common: en },
    zh: { common: zh },
  },
});

export function setLanguage(locale: ConsoleLocale) {
  localStorage.setItem("lw-cc-lang", locale);
  void i18n.changeLanguage(shellLanguage(locale));
}

export default i18n;
