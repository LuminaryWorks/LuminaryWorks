import {
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
  if (callbackInflight) return callbackInflight;
  callbackInflight = handleSignInCallback(config).finally(() => {
    callbackInflight = null;
  });
  return callbackInflight;
}

export async function signOut(
  runtime: RuntimeConfig,
  origin: string,
): Promise<void> {
  const config = toIdpConfig(runtime, origin);
  if (!config) return;
  await signOutRedirect(config);
}
