import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../public/locales/en/common.json";
import zh from "../public/locales/zh/common.json";

void i18n.use(initReactI18next).init({
  lng:
    typeof localStorage !== "undefined"
      ? localStorage.getItem("lw-cc-lang") || "en"
      : "en",
  fallbackLng: "en",
  ns: ["common"],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  resources: {
    en: { common: en },
    zh: { common: zh },
  },
});

export function setLanguage(lng: "en" | "zh") {
  localStorage.setItem("lw-cc-lang", lng);
  void i18n.changeLanguage(lng);
}

export default i18n;
