import type { LuminaryAuthSession } from "@luminaryworks/auth-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation } from "react-router-dom";
import { readConsoleLocale, setLanguage } from "./i18n";
import { createApiClient } from "./lib/api-client";
import { isCallbackPath, restoreSession, signOut } from "./lib/auth";
import type { RuntimeConfig } from "./lib/runtime-config";
import { CallbackPage } from "./pages/CallbackPage";
import { LegalPrivacyPage, LegalTermsPage } from "./pages/LegalPages";
import { LoginPage } from "./pages/LoginPage";

const ConsoleShell = lazy(() =>
  import("./ConsoleShell").then((mod) => ({ default: mod.ConsoleShell })),
);

export function App({ runtime }: { runtime: RuntimeConfig }) {
  const { t } = useTranslation();
  const [locale, setLocale] = useState(readConsoleLocale);
  const location = useLocation();
  const origin = window.location.origin;
  const [session, setSession] = useState<LuminaryAuthSession | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  const api = useMemo(() => {
    // Local entitlement is reached via the SPA /v1 proxy. Calling a loopback
    // absolute URL from localhost↔127.0.0.1 aliases breaks some writes with
    // opaque "Failed to fetch" even when CORS allowlists both hosts.
    let baseUrl = runtime.entitlementBaseUrl;
    try {
      const host = new URL(baseUrl).hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
        baseUrl = "";
      }
    } catch {
      /* keep configured base */
    }
    return createApiClient({
      baseUrl,
      tokens: {
        getAccessToken: () => session?.accessToken ?? null,
        onUnauthorized: () => {
          setSession(null);
          setNeedLogin(true);
        },
      },
    });
  }, [runtime.entitlementBaseUrl, session]);

  const onSession = useCallback((next: LuminaryAuthSession) => {
    setSession(next);
    setNeedLogin(false);
  }, []);

  useEffect(() => {
    if (session) setNeedLogin(false);
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    void restoreSession(runtime, origin)
      .then((existing) => {
        if (!cancelled && existing) {
          setSession(existing);
          setNeedLogin(false);
        }
      })
      .finally(() => {
        if (!cancelled) setSessionReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, origin]);

  if (window.location.pathname === "/legal/terms") {
    return <LegalTermsPage product="LuminaryWorks Control Console" />;
  }
  if (window.location.pathname === "/legal/privacy") {
    return <LegalPrivacyPage product="LuminaryWorks Control Console" />;
  }

  if (
    isCallbackPath(location.pathname) ||
    isCallbackPath(window.location.pathname)
  ) {
    if (session) {
      return <Navigate to="/" replace />;
    }
    return (
      <CallbackPage runtime={runtime} origin={origin} onSession={onSession} />
    );
  }

  if (!sessionReady) {
    return (
      <main className="login-page">
        <p>{t("auth.callback")}</p>
      </main>
    );
  }

  if (!session || needLogin) {
    return (
      <LoginPage runtime={runtime} origin={origin} onSession={onSession} />
    );
  }

  return (
    <Suspense
      fallback={
        <main className="login-page">
          <p>{t("common.loading")}</p>
        </main>
      }
    >
      <ConsoleShell
        api={api}
        runtime={runtime}
        accessToken={session.accessToken}
        locale={locale}
        onLocaleChange={(next) => {
          setLanguage(next);
          setLocale(next);
        }}
        onSignOut={() => void signOut(runtime, origin)}
      />
    </Suspense>
  );
}
