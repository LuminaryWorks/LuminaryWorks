import {
  getCurrentUser,
  handleSignInCallback,
  isIdpConfigured,
  type LuminaryAuthSession,
  type LuminaryIdpConfig,
  signOutRedirect,
} from "@luminaryworks/auth-react";
import type { RuntimeConfig } from "./runtime-config";
import { bindRedirects } from "./runtime-config";

export const CALLBACK_PATH = "/auth/callback";

/** Dedupes StrictMode double-mount; oidc-client PKCE state is single-use. */
let callbackInflight: Promise<{
  session: LuminaryAuthSession;
  returnUrl?: string;
}> | null = null;
/** Survives StrictMode remount so we never re-run signinRedirectCallback after success. */
let callbackResolved: {
  session: LuminaryAuthSession;
  returnUrl?: string;
} | null = null;

export function toIdpConfig(
  runtime: RuntimeConfig,
  origin: string,
): LuminaryIdpConfig | null {
  const bound = bindRedirects(runtime, origin);
  const partial: Partial<LuminaryIdpConfig> = {
    issuer: bound.issuer,
    clientId: bound.clientId,
    redirectUri: bound.redirectUri,
    popupRedirectUri: bound.redirectUri,
    postLogoutRedirectUri: bound.postLogoutRedirectUri,
    scopes: bound.scopes,
    audience: bound.audience,
    experienceApiBase: bound.experienceApiBase,
    iamProvider: bound.iamProvider,
  };
  if (!isIdpConfigured(partial)) return null;
  return partial;
}

export function isCallbackPath(pathname: string): boolean {
  return pathname.replace(/\/$/, "") === CALLBACK_PATH;
}

export async function completeCallback(
  runtime: RuntimeConfig,
  origin: string,
): Promise<{ session: LuminaryAuthSession; returnUrl?: string }> {
  const config = toIdpConfig(runtime, origin);
  if (!config) throw new Error("Identity is not configured");
  if (callbackResolved) return callbackResolved;
  if (callbackInflight) return callbackInflight;
  // StrictMode remounts after the code is consumed — reuse stored UserManager session.
  const existing = await getCurrentUser(config);
  if (existing?.accessToken) {
    callbackResolved = { session: existing };
    return callbackResolved;
  }
  callbackInflight = handleSignInCallback(config)
    .then((result) => {
      callbackResolved = result;
      return result;
    })
    .finally(() => {
      callbackInflight = null;
    });
  return callbackInflight;
}

/** Hydrate SPA session after hard navigation / refresh. */
export async function restoreSession(
  runtime: RuntimeConfig,
  origin: string,
): Promise<LuminaryAuthSession | null> {
  const config = toIdpConfig(runtime, origin);
  if (!config) return null;
  return getCurrentUser(config);
}

export async function signOut(
  runtime: RuntimeConfig,
  origin: string,
): Promise<void> {
  const config = toIdpConfig(runtime, origin);
  if (!config) return;
  await signOutRedirect(config);
}
