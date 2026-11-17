import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken,
  getAdminCookieAttributes,
} from "@/lib/admin-auth";
import { getAppConfig } from "@/lib/config";
import { constantTimeEquals } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const config = getAppConfig();
  if (!config.adminPassword || !config.oauthSigningSecret) {
    return NextResponse.json(
      { error: "ADMIN_PASSWORD or OAUTH_SIGNING_SECRET is not configured" },
      { status: 500 },
    );
  }

  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!constantTimeEquals(body.password || "", config.adminPassword)) {
    return NextResponse.json({ error: "Invalid admin password" }, { status: 401 });
  }

  const token = createAdminSessionToken();
  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    token,
    getAdminCookieAttributes(ADMIN_SESSION_TTL_SECONDS),
  );
  return response;
}
