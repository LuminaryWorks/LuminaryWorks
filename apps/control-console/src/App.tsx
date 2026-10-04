import type { LuminaryAuthSession } from "@luminaryworks/auth-react";
import { LoginLanguageSwitcher } from "@luminaryworks/auth-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { type ConsoleLocale, readConsoleLocale, setLanguage } from "./i18n";
import { createApiClient } from "./lib/api-client";
import { isCallbackPath, signOut } from "./lib/auth";
import type { RuntimeConfig } from "./lib/runtime-config";
import { CallbackPage } from "./pages/CallbackPage";
import { LoginPage } from "./pages/LoginPage";
import { LegalPrivacyPage, LegalTermsPage } from "./pages/LegalPages";
import {
  CapacityPage,
  CleanupPage,
  LegalPage,
  OrdersPage,
} from "./pages/OpsPages";
import {
  CatalogPage,
  OverviewPage,
  ProvidersPage,
} from "./pages/OverviewCatalogProviders";

export function App({ runtime }: { runtime: RuntimeConfig }) {
  const { t } = useTranslation();
  const [locale, setLocale] = useState(readConsoleLocale);
  const location = useLocation();
  const origin = window.location.origin;
  const [session, setSession] = useState<LuminaryAuthSession | null>(null);
  const [needLogin, setNeedLogin] = useState(false);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: runtime.entitlementBaseUrl,
        tokens: {
          getAccessToken: () => session?.accessToken ?? null,
          onUnauthorized: () => setNeedLogin(true),
        },
      }),
    [runtime.entitlementBaseUrl, session],
  );

  const onSession = useCallback((next: LuminaryAuthSession) => {
    setSession(next);
    setNeedLogin(false);
  }, []);

  useEffect(() => {
    if (session) setNeedLogin(false);
  }, [session]);

  if (window.location.pathname === "/legal/terms") {
    return <LegalTermsPage product="LuminaryWorks Control Console" />;
  }
  if (window.location.pathname === "/legal/privacy") {
    return <LegalPrivacyPage product="LuminaryWorks Control Console" />;
  }

  if (isCallbackPath(window.location.pathname)) {
    if (session) {
      return <Navigate to="/" replace />;
    }
    return (
      <CallbackPage runtime={runtime} origin={origin} onSession={onSession} />
    );
  }

  if (!session || needLogin) {
    return (
      <LoginPage runtime={runtime} origin={origin} onSession={onSession} />
    );
  }

  const nav = [
    { to: "/", key: "nav.overview" },
    { to: "/catalog", key: "nav.catalog" },
    { to: "/providers", key: "nav.providers" },
    { to: "/orders", key: "nav.orders" },
    { to: "/cleanup", key: "nav.cleanup" },
    { to: "/legal", key: "nav.legal" },
    { to: "/capacity", key: "nav.capacity" },
  ];

  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside>
        <p className="brand">{t("app.title")}</p>
        <p className="muted">{t("app.notLogtoAdmin")}</p>
        <nav aria-label="primary">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}>
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
        <div className="aside-foot">
          <LoginLanguageSwitcher
            variant="onDark"
            locale={locale}
            label={t("nav.language")}
            onChange={(next) => {
              const value = next as ConsoleLocale;
              setLanguage(value);
              setLocale(value);
            }}
          />
          <button type="button" onClick={() => void signOut(runtime, origin)}>
            {t("nav.logout")}
          </button>
        </div>
      </aside>
      <main id="main">
        <Routes>
          <Route
            path="/"
            element={<OverviewPage api={api} runtime={runtime} />}
          />
          <Route path="/catalog" element={<CatalogPage api={api} />} />
          <Route path="/providers" element={<ProvidersPage api={api} />} />
          <Route path="/orders" element={<OrdersPage api={api} />} />
          <Route path="/cleanup" element={<CleanupPage api={api} />} />
          <Route
            path="/legal"
            element={
              <LegalPage api={api} legalDocsUrl={runtime.legalDocsUrl} />
            }
          />
          <Route
            path="/capacity"
            element={<CapacityPage api={api} runtime={runtime} />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <p className="muted route-hint">{location.pathname}</p>
      </main>
    </div>
  );
}
