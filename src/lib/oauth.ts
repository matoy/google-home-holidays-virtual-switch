import crypto from "node:crypto";
import { getAppConfig, requireEnvValue } from "./config";

export type OAuthTokenType = "code" | "access" | "refresh";

export interface OAuthTokenPayload {
  typ: OAuthTokenType;
  sub: string;
  cid: string;
  exp: number;
  redir?: string;
  jti?: string;
}

const ACCESS_TOKEN_TTL_SECONDS = 3600;
const AUTH_CODE_TTL_SECONDS = 300;
const REFRESH_TOKEN_TTL_SECONDS = 10 * 365 * 24 * 3600;

/**
 * Constant-time string comparison using SHA-256 digests so lengths never leak.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a, "utf8").digest();
  const hashB = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function signOAuthToken(payload: OAuthTokenPayload, secret: string): string {
  requireEnvValue(secret, "OAUTH_SIGNING_SECRET");
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${sig}`;
}

export function verifyOAuthToken(
  token: string,
  expectedType: OAuthTokenType,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): OAuthTokenPayload | null {
  if (!secret || !token) {
    return null;
  }
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0 || dotIdx === token.length - 1) {
    return null;
  }

  const encodedPayload = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  if (!constantTimeEquals(providedSig, expectedSig)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as OAuthTokenPayload;
    if (
      !parsed ||
      parsed.typ !== expectedType ||
      typeof parsed.sub !== "string" ||
      typeof parsed.cid !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp <= nowSeconds) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createAuthorizationCode(params: {
  clientId: string;
  redirectUri: string;
  agentUserId?: string;
  secret?: string;
  nowSeconds?: number;
}): string {
  const config = getAppConfig();
  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const secret = requireEnvValue(params.secret ?? config.oauthSigningSecret, "OAUTH_SIGNING_SECRET");

  return signOAuthToken(
    {
      typ: "code",
      sub: params.agentUserId || config.agentUserId,
      cid: params.clientId,
      redir: params.redirectUri,
      exp: nowSeconds + AUTH_CODE_TTL_SECONDS,
      jti: crypto.randomUUID(),
    },
    secret,
  );
}

export function createAccessAndRefreshTokens(params: {
  clientId: string;
  agentUserId: string;
  secret?: string;
  nowSeconds?: number;
  includeRefreshToken?: boolean;
}): {
  token_type: "Bearer";
  access_token: string;
  expires_in: number;
  refresh_token?: string;
} {
  const config = getAppConfig();
  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const secret = requireEnvValue(params.secret ?? config.oauthSigningSecret, "OAUTH_SIGNING_SECRET");

  const access_token = signOAuthToken(
    {
      typ: "access",
      sub: params.agentUserId,
      cid: params.clientId,
      exp: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
    },
    secret,
  );

  const result: {
    token_type: "Bearer";
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  } = {
    token_type: "Bearer",
    access_token,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
  };

  if (params.includeRefreshToken !== false) {
    result.refresh_token = signOAuthToken(
      {
        typ: "refresh",
        sub: params.agentUserId,
        cid: params.clientId,
        exp: nowSeconds + REFRESH_TOKEN_TTL_SECONDS,
      },
      secret,
    );
  }

  return result;
}

/**
 * Validates that redirect_uri belongs to Google Home's official OAuth redirect endpoints.
 */
export function isAllowedGoogleRedirectUri(
  redirectUri: string,
  configuredProjectId: string = getAppConfig().googleProjectId,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  const allowedHosts = new Set([
    "oauth-redirect.googleusercontent.com",
    "oauth-redirect-sandbox.googleusercontent.com",
  ]);
  if (!allowedHosts.has(parsed.hostname)) {
    return false;
  }

  if (configuredProjectId) {
    return parsed.pathname === `/r/${configuredProjectId}`;
  }

  return /^\/r\/[A-Za-z0-9._-]+$/.test(parsed.pathname);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

/**
 * Extracts client_id and client_secret from HTTP Basic Auth header or form-urlencoded body.
 */
export function extractOAuthClientCredentials(
  authorizationHeader: string | null,
  formParams: URLSearchParams,
): { clientId: string; clientSecret: string } {
  if (authorizationHeader?.toLowerCase().startsWith("basic ")) {
    const rawB64 = authorizationHeader.slice(6).trim();
    const decoded = Buffer.from(rawB64, "base64").toString("utf8");
    const colonIdx = decoded.indexOf(":");
    if (colonIdx >= 0) {
      return {
        clientId: safeDecodeURIComponent(decoded.slice(0, colonIdx)),
        clientSecret: safeDecodeURIComponent(decoded.slice(colonIdx + 1)),
      };
    }
  }

  return {
    clientId: formParams.get("client_id") || "",
    clientSecret: formParams.get("client_secret") || "",
  };
}

export function validateOAuthClient(clientId: string, clientSecret?: string): boolean {
  const config = getAppConfig();
  if (!config.googleClientId || !config.googleClientSecret) {
    return false;
  }
  if (!constantTimeEquals(clientId, config.googleClientId)) {
    return false;
  }
  if (clientSecret !== undefined && !constantTimeEquals(clientSecret, config.googleClientSecret)) {
    return false;
  }
  return true;
}

export function authenticateFulfillmentBearer(
  authorizationHeader: string | null,
  nowSeconds?: number,
): OAuthTokenPayload | null {
  if (!authorizationHeader?.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = authorizationHeader.slice(7).trim();
  const config = getAppConfig();
  return verifyOAuthToken(token, "access", config.oauthSigningSecret, nowSeconds);
}
