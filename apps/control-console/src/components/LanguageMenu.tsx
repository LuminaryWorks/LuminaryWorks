import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConsoleLocale } from "../i18n";
import { PREFERRED_LOCALES } from "../preferred-locale";

const SHORT_KEY: Record<ConsoleLocale, string> = {
  en: "lang.short.en",
  "zh-CN": "lang.short.zhCN",
  "zh-TW": "lang.short.zhTW",
  ja: "lang.short.ja",
  ko: "lang.short.ko",
  pt: "lang.short.pt",
  nl: "lang.short.nl",
  it: "lang.short.it",
  es: "lang.short.es",
  fr: "lang.short.fr",
};

const FULL_KEY: Record<ConsoleLocale, string> = {
  en: "lang.full.en",
  "zh-CN": "lang.full.zhCN",
  "zh-TW": "lang.full.zhTW",
  ja: "lang.full.ja",
  ko: "lang.full.ko",
  pt: "lang.full.pt",
  nl: "lang.full.nl",
  it: "lang.full.it",
  es: "lang.full.es",
  fr: "lang.full.fr",
};

function GlobeIcon() {
  return (
    <svg
      className="lang-icon"
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <circle
        cx="10"
        cy="10"
        r="7.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <ellipse
        cx="10"
        cy="10"
        rx="3.2"
        ry="7.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M3 10h14M4.2 6.5h11.6M4.2 13.5h11.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function LanguageMenu({
  locale,
  onChange,
  tone = "default",
}: {
  locale: ConsoleLocale;
  onChange: (next: ConsoleLocale) => void;
  tone?: "default" | "onDark";
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      className={tone === "onDark" ? "lang-menu is-on-dark" : "lang-menu"}
      ref={rootRef}
    >
      <button
        type="button"
        className="plain-control lang-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t("nav.language")}
        onClick={() => setOpen((value) => !value)}
      >
        <GlobeIcon />
        <span>{t(SHORT_KEY[locale])}</span>
      </button>
      {open ? (
        <div id={menuId} className="lang-list" role="menu">
          {PREFERRED_LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={code === locale}
              onClick={() => {
                onChange(code);
                setOpen(false);
              }}
            >
              <span>{t(FULL_KEY[code])}</span>
              {code === locale ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
