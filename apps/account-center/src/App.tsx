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
import { readAccountLocale, setLanguage } from "./i18n";
import { createApiClient } from "./lib/api-client";
import { isCallbackPath, restoreSession, signOut } from "./lib/auth";
import { readIdentityProfile } from "./lib/identity";
import { browserApiBase, type RuntimeConfig } from "./lib/runtime-config";
import { CallbackPage } from "./pages/CallbackPage";
import { LegalPrivacyPage, LegalTermsPage } from "./pages/LegalPages";
import { LoginPage } from "./pages/LoginPage";

const AccountShell = lazy(() =>
  import("./AccountShell").then((mod) => ({ default: mod.AccountShell })),
);

export function App({ runtime }: { runtime: RuntimeConfig }) {
  const { t } = useTranslation();
  const [locale, setLocale] = useState(readAccountLocale);
  const location = useLocation();
  const origin = window.location.origin;
  const [session, setSession] = useState<LuminaryAuthSession | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const dev = import.meta.env.DEV;

  const ai = useMemo(
    () =>
      createApiClient({
        baseUrl: browserApiBase(runtime.aiPlatformBaseUrl, "/ai-api", dev),
        tokens: {
          getAccessToken: () => session?.accessToken ?? null,
          onUnauthorized: () => {
            setSession(null);
            setNeedLogin(true);
          },
        },
      }),
    [runtime.aiPlatformBaseUrl, session],
  );

  const entitlement = useMemo(
    () =>
      createApiClient({
        baseUrl: browserApiBase(
          runtime.entitlementBaseUrl,
          "/entitlement-api",
          dev,
        ),
        reauthOn401: false,
        tokens: {
          getAccessToken: () => session?.accessToken ?? null,
          onUnauthorized: () => {
            setSession(null);
            setNeedLogin(true);
          },
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

  if (window.location.pathname === "/legal/terms") return <LegalTermsPage />;
  if (window.location.pathname === "/legal/privacy")
    return <LegalPrivacyPage />;

  if (
    isCallbackPath(location.pathname) ||
    isCallbackPath(window.location.pathname)
  ) {
    if (session) return <Navigate to="/" replace />;
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

  const profile = readIdentityProfile(session.accessToken, session.idToken);

  return (
    <Suspense
      fallback={
        <main className="login-page">
          <p>{t("common.loading")}</p>
        </main>
      }
    >
      <AccountShell
        ai={ai}
        entitlement={entitlement}
        runtime={runtime}
        profile={profile}
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
