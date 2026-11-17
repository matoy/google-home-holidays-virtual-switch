import crypto from "node:crypto";
import { getAppConfig } from "./config";

interface ServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
}

interface CachedGoogleToken {
  accessToken: string;
  expiresAtMs: number;
}

const HOMEGRAPH_SCOPE = "https://www.googleapis.com/auth/homegraph";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REPORT_STATE_URL = "https://homegraph.googleapis.com/v1/devices:reportStateAndNotification";
const REQUEST_SYNC_URL = "https://homegraph.googleapis.com/v1/devices:requestSync";

let cachedAccessToken: CachedGoogleToken | null = null;

export function getServiceAccountCredentials(): ServiceAccountCredentials | null {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    let normalized = rawJson;
    if (
      (normalized.startsWith("'") && normalized.endsWith("'")) ||
      (normalized.startsWith('"') && normalized.endsWith('"'))
    ) {
      normalized = normalized.slice(1, -1).trim();
    }

    let jsonText = normalized;
    if (!jsonText.startsWith("{")) {
      jsonText = Buffer.from(normalized, "base64").toString("utf8");
    }

    let parsed: {
      type?: string;
      client_email?: string;
      private_key?: string;
      installed?: unknown;
      web?: unknown;
    };
    try {
      parsed = JSON.parse(jsonText) as typeof parsed;
    } catch {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON is not valid single-line JSON or base64-encoded JSON.",
      );
    }

    if (parsed.installed || parsed.web) {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON contains an OAuth Client ID JSON (installed/web), not a Service Account key. Create a Service Account key under Google Cloud Console → IAM & Admin → Service Accounts.",
      );
    }

    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(
        'GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key (expected a Service Account key JSON with "type": "service_account").',
      );
    }

    return {
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key.replace(/\\n/g, "\n"),
    };
  }

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim();
  if (clientEmail && privateKey) {
    return {
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, "\n"),
    };
  }

  return null;
}

export function getHomeGraphConfigStatus(): { configured: boolean; error: string | null } {
  try {
    return {
      configured: getServiceAccountCredentials() !== null,
      error: null,
    };
  } catch (err) {
    return {
      configured: false,
      error: err instanceof Error ? err.message : "Invalid HomeGraph Service Account configuration.",
    };
  }
}

export function isHomeGraphConfigured(): boolean {
  return getHomeGraphConfigStatus().configured;
}

function createServiceAccountJwt(creds: ServiceAccountCredentials): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claimSet = Buffer.from(
    JSON.stringify({
      iss: creds.clientEmail,
      scope: HOMEGRAPH_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  ).toString("base64url");

  const unsigned = `${header}.${claimSet}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(creds.privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function getHomeGraphAccessToken(): Promise<string> {
  const nowMs = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAtMs - 60_000 > nowMs) {
    return cachedAccessToken.accessToken;
  }

  const creds = getServiceAccountCredentials();
  if (!creds) {
    throw new Error(
      "HomeGraph Service Account is not configured (set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY).",
    );
  }

  const assertion = createServiceAccountJwt(creds);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to obtain HomeGraph OAuth token (HTTP ${response.status}): ${errText}`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("Google OAuth token response missing access_token");
  }

  cachedAccessToken = {
    accessToken: data.access_token,
    expiresAtMs: nowMs + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

export async function reportSwitchStateToHomeGraph(params: {
  isOn: boolean;
  requestId?: string;
  agentUserId?: string;
  deviceId?: string;
}): Promise<{ requestId: string }> {
  const config = getAppConfig();
  const accessToken = await getHomeGraphAccessToken();
  const requestId = params.requestId || crypto.randomUUID();
  const agentUserId = params.agentUserId || config.agentUserId;
  const deviceId = params.deviceId || config.deviceId;

  const payload = {
    requestId,
    agentUserId,
    payload: {
      devices: {
        states: {
          [deviceId]: {
            online: true,
            on: params.isOn,
          },
        },
      },
    },
  };

  const response = await fetch(REPORT_STATE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HomeGraph reportStateAndNotification failed (HTTP ${response.status}): ${errText}`);
  }

  return { requestId };
}

export async function requestSyncToHomeGraph(agentUserId?: string): Promise<void> {
  const config = getAppConfig();
  const accessToken = await getHomeGraphAccessToken();

  const response = await fetch(REQUEST_SYNC_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agentUserId: agentUserId || config.agentUserId,
      async: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HomeGraph requestSync failed (HTTP ${response.status}): ${errText}`);
  }
}
