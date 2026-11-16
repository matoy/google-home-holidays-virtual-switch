import { NextRequest, NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";
import {
  constantTimeEquals,
  createAuthorizationCode,
  isAllowedGoogleRedirectUri,
  validateOAuthClient,
} from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const config = getAppConfig();
  const formData = await request.formData();

  const clientId = String(formData.get("client_id") || "");
  const redirectUri = String(formData.get("redirect_uri") || "");
  const state = String(formData.get("state") || "");
  const responseType = String(formData.get("response_type") || "");
  const password = String(formData.get("password") || "");

  if (responseType !== "code" || !validateOAuthClient(clientId)) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Invalid client_id or response_type" },
      { status: 400 },
    );
  }

  if (!isAllowedGoogleRedirectUri(redirectUri)) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Disallowed redirect_uri" },
      { status: 400 },
    );
  }

  if (!config.adminPassword || !config.oauthSigningSecret) {
    return NextResponse.json(
      {
        error: "server_error",
        error_description: "ADMIN_PASSWORD or OAUTH_SIGNING_SECRET is not configured",
      },
      { status: 500 },
    );
  }

  if (!constantTimeEquals(password, config.adminPassword)) {
    const retryUrl = new URL("/oauth/authorize", request.url);
    retryUrl.searchParams.set("client_id", clientId);
    retryUrl.searchParams.set("redirect_uri", redirectUri);
    retryUrl.searchParams.set("response_type", responseType);
    if (state) {
      retryUrl.searchParams.set("state", state);
    }
    retryUrl.searchParams.set("error", "invalid_password");
    return NextResponse.redirect(retryUrl, 303);
  }

  const code = createAuthorizationCode({
    clientId,
    redirectUri,
    agentUserId: config.agentUserId,
  });

  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  if (state) {
    target.searchParams.set("state", state);
  }

  return NextResponse.redirect(target.toString(), 302);
}
