import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { getAppConfig } from "./config";
import { constantTimeEquals, signOAuthToken, verifyOAuthToken } from "./oauth";

export const ADMIN_SESSION_COOKIE = "gh_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 24 * 3600;

export function getAdminPasswordFingerprint(password: string): string {
  return crypto.createHash("sha256").update(password, "utf8").digest("hex").slice(0, 16);
}

export function createAdminSessionToken(
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const config = getAppConfig();
  if (!config.adminPassword) {
    throw new Error("ADMIN_PASSWORD is not configured");
  }
  if (!config.oauthSigningSecret) {
    throw new Error("OAUTH_SIGNING_SECRET is not configured");
  }

  return signOAuthToken(
    {
      typ: "admin",
      sub: getAdminPasswordFingerprint(config.adminPassword),
      cid: "admin-ui",
      exp: nowSeconds + ADMIN_SESSION_TTL_SECONDS,
    },
    config.oauthSigningSecret,
  );
}

export function verifyAdminSessionToken(
  token: string | undefined | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!token) {
    return false;
  }
  const config = getAppConfig();
  if (!config.adminPassword || !config.oauthSigningSecret) {
    return false;
  }

  const payload = verifyOAuthToken(token, "admin", config.oauthSigningSecret, nowSeconds);
  if (!payload || payload.cid !== "admin-ui") {
    return false;
  }

  return constantTimeEquals(payload.sub, getAdminPasswordFingerprint(config.adminPassword));
}

export function isAdminRequestAuthorized(
  request: NextRequest,
  bodyPassword?: string,
): boolean {
  const cookieToken = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (verifyAdminSessionToken(cookieToken)) {
    return true;
  }

  const config = getAppConfig();
  if (config.adminPassword && bodyPassword) {
    return constantTimeEquals(bodyPassword, config.adminPassword);
  }

  return false;
}

export function getAdminCookieAttributes(maxAgeSeconds: number) {
  return {
    name: ADMIN_SESSION_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSeconds,
  };
}
