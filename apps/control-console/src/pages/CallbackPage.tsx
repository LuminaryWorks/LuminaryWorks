import type { LuminaryAuthSession } from "@luminaryworks/auth-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { completeCallback } from "../lib/auth";
import type { RuntimeConfig } from "../lib/runtime-config";

export function CallbackPage({
  runtime,
  origin,
  onSession,
}: {
  runtime: RuntimeConfig;
  origin: string;
  onSession: (session: LuminaryAuthSession) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    // Dev StrictMode remounts effects; oidc-client state is single-use.
    if (started.current) return;
    started.current = true;
    void completeCallback(runtime, origin)
      .then(({ session, returnUrl }) => {
        const next = returnUrl?.startsWith("/") ? returnUrl : "/";
        window.history.replaceState(null, "", next);
        onSession(session);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }, [runtime, origin, onSession]);

  return (
    <main className="login-page">
      <h1>{error ? t("auth.callbackError") : t("auth.callback")}</h1>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
