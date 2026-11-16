import { NextRequest, NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";
import {
  createAccessAndRefreshTokens,
  extractOAuthClientCredentials,
  validateOAuthClient,
  verifyOAuthToken,
} from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function oauthError(error: string, description: string, status: number = 400) {
  return NextResponse.json(
    { error, error_description: description },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}

export async function POST(request: NextRequest) {
  const config = getAppConfig();
  if (!config.oauthSigningSecret) {
    return oauthError("server_error", "OAUTH_SIGNING_SECRET is not configured", 500);
  }

  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);
  const { clientId, clientSecret } = extractOAuthClientCredentials(
    request.headers.get("authorization"),
    params,
  );

  if (!validateOAuthClient(clientId, clientSecret)) {
    return oauthError("invalid_client", "Invalid OAuth client credentials", 401);
  }

  const grantType = params.get("grant_type") || "";

  if (grantType === "authorization_code") {
    const code = params.get("code") || "";
    const redirectUri = params.get("redirect_uri") || "";
    const payload = verifyOAuthToken(code, "code", config.oauthSigningSecret);

    if (!payload || payload.cid !== clientId) {
      return oauthError("invalid_grant", "Authorization code is invalid or expired");
    }
    if (redirectUri && payload.redir && payload.redir !== redirectUri) {
      return oauthError("invalid_grant", "redirect_uri mismatch");
    }

    const tokens = createAccessAndRefreshTokens({
      clientId,
      agentUserId: payload.sub,
      includeRefreshToken: true,
    });

    return NextResponse.json(tokens, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    });
  }

  if (grantType === "refresh_token") {
    const refreshToken = params.get("refresh_token") || "";
    const payload = verifyOAuthToken(refreshToken, "refresh", config.oauthSigningSecret);

    if (!payload || payload.cid !== clientId) {
      return oauthError("invalid_grant", "Refresh token is invalid or expired");
    }

    const tokens = createAccessAndRefreshTokens({
      clientId,
      agentUserId: payload.sub,
      includeRefreshToken: false,
    });

    return NextResponse.json(tokens, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    });
  }

  return oauthError("unsupported_grant_type", `Unsupported grant_type: ${grantType}`);
}
