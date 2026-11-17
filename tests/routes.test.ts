import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as adminLoginPost } from "../src/app/api/admin/login/route";
import { POST as adminLogoutPost } from "../src/app/api/admin/logout/route";
import { POST as adminSwitchPost } from "../src/app/api/admin/switch/route";
import { POST as adminSyncPost } from "../src/app/api/admin/sync/route";
import { GET as cronGet } from "../src/app/api/cron/route";
import { POST as authorizePost } from "../src/app/api/oauth/authorize/route";
import { POST as tokenPost } from "../src/app/api/oauth/token/route";
import { POST as smarthomePost } from "../src/app/api/smarthome/route";
import { GET as statusGet } from "../src/app/api/status/route";
import { ADMIN_SESSION_COOKIE } from "../src/lib/admin-auth";
import { resetIcsCacheForTests } from "../src/lib/holidays";
import { createAccessAndRefreshTokens } from "../src/lib/oauth";
import { resetMemoryOverridesForTests } from "../src/lib/override";

const FIXTURE_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:toussaint-2026",
  "DTSTART;VALUE=DATE:20261017",
  "DTEND;VALUE=DATE:20261102",
  "SUMMARY:Vacances de la Toussaint",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:rentree-2026",
  "DTSTART;VALUE=DATE:20260901",
  "DTEND;VALUE=DATE:20260902",
  "SUMMARY:Rentrée scolaire",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

function setupTestEnv() {
  process.env.CALENDAR_ICS_URL = "https://mock.local/Zone-C.ics";
  process.env.GOOGLE_CLIENT_ID = "route-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "route-client-secret";
  process.env.GOOGLE_PROJECT_ID = "route-proj";
  process.env.OAUTH_SIGNING_SECRET = "route-signing-secret-at-least-32-chars-long";
  process.env.ADMIN_PASSWORD = "route-admin-password";
  process.env.CRON_SECRET = "route-cron-secret-1234";
  process.env.DEVICE_ID = "zone-c-school-holidays";
  process.env.DEVICE_NAME = "Vacances Scolaires Zone C";
  process.env.AGENT_USER_ID = "zone-c-user-1";
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_CLIENT_EMAIL;
  delete process.env.GOOGLE_PRIVATE_KEY;
}

async function withMockIcsFetch<T>(fn: () => Promise<T>): Promise<T> {
  resetIcsCacheForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://mock.local/Zone-C.ics") {
      return new Response(FIXTURE_ICS, {
        status: 200,
        headers: { "Content-Type": "text/calendar; charset=utf-8" },
      });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    resetIcsCacheForTests();
  }
}

test("Full OAuth2 authorize -> token -> refresh -> Smart Home SYNC/QUERY/EXECUTE flow", async () => {
  setupTestEnv();

  // 1. Bad password redirects back with error=invalid_password
  const badForm = new FormData();
  badForm.set("client_id", "route-client-id");
  badForm.set("redirect_uri", "https://oauth-redirect.googleusercontent.com/r/route-proj");
  badForm.set("response_type", "code");
  badForm.set("state", "st-1");
  badForm.set("password", "wrong");

  const badAuthRes = await authorizePost(
    new NextRequest("https://app.example.com/api/oauth/authorize", {
      method: "POST",
      body: badForm,
    }),
  );
  assert.equal(badAuthRes.status, 303);
  assert.ok(badAuthRes.headers.get("location")?.includes("error=invalid_password"));

  // 2. Valid password redirects to Google with code & state
  const goodForm = new FormData();
  goodForm.set("client_id", "route-client-id");
  goodForm.set("redirect_uri", "https://oauth-redirect.googleusercontent.com/r/route-proj");
  goodForm.set("response_type", "code");
  goodForm.set("state", "st-1");
  goodForm.set("password", "route-admin-password");

  const goodAuthRes = await authorizePost(
    new NextRequest("https://app.example.com/api/oauth/authorize", {
      method: "POST",
      body: goodForm,
    }),
  );
  assert.equal(goodAuthRes.status, 302);
  const redirUrl = new URL(goodAuthRes.headers.get("location") || "");
  assert.equal(redirUrl.origin, "https://oauth-redirect.googleusercontent.com");
  assert.equal(redirUrl.pathname, "/r/route-proj");
  assert.equal(redirUrl.searchParams.get("state"), "st-1");
  const code = redirUrl.searchParams.get("code") || "";
  assert.ok(code.length > 10);

  // 3. Exchange authorization_code for tokens
  const tokenRes = await tokenPost(
    new NextRequest("https://app.example.com/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "route-client-id",
        client_secret: "route-client-secret",
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://oauth-redirect.googleusercontent.com/r/route-proj",
      }).toString(),
    }),
  );
  assert.equal(tokenRes.status, 200);
  const tokenBody = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
  };
  assert.equal(tokenBody.token_type, "Bearer");
  assert.ok(tokenBody.access_token);
  assert.ok(tokenBody.refresh_token);

  // 4. Refresh token via HTTP Basic Auth
  const basicCreds = Buffer.from("route-client-id:route-client-secret").toString("base64");
  const refreshRes = await tokenPost(
    new NextRequest("https://app.example.com/api/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicCreds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokenBody.refresh_token,
      }).toString(),
    }),
  );
  assert.equal(refreshRes.status, 200);
  const refreshed = (await refreshRes.json()) as { access_token: string };
  assert.ok(refreshed.access_token);

  // 5. Smart Home endpoint rejects unauthenticated calls
  const unauthRes = await smarthomePost(
    new NextRequest("https://app.example.com/api/smarthome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "req-0", inputs: [{ intent: "action.devices.SYNC" }] }),
    }),
  );
  assert.equal(unauthRes.status, 401);

  // 6. Smart Home SYNC & QUERY with valid Bearer token
  const syncRes = await smarthomePost(
    new NextRequest("https://app.example.com/api/smarthome", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${refreshed.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requestId: "req-1", inputs: [{ intent: "action.devices.SYNC" }] }),
    }),
  );
  assert.equal(syncRes.status, 200);
  const syncJson = (await syncRes.json()) as {
    payload: { devices: Array<{ id: string; attributes: { queryOnlyOnOff: boolean } }> };
  };
  assert.equal(syncJson.payload.devices[0].id, "zone-c-school-holidays");
  assert.equal(syncJson.payload.devices[0].attributes.queryOnlyOnOff, false);

  await withMockIcsFetch(async () => {
    const queryRes = await smarthomePost(
      new NextRequest("https://app.example.com/api/smarthome", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${refreshed.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: "req-2",
          inputs: [
            {
              intent: "action.devices.QUERY",
              payload: { devices: [{ id: "zone-c-school-holidays" }] },
            },
          ],
        }),
      }),
    );
    assert.equal(queryRes.status, 200);
    const queryJson = (await queryRes.json()) as {
      payload: { devices: Record<string, { online: boolean; status: string; on: boolean }> };
    };
    assert.equal(queryJson.payload.devices["zone-c-school-holidays"].online, true);
    assert.equal(queryJson.payload.devices["zone-c-school-holidays"].status, "SUCCESS");
    assert.equal(typeof queryJson.payload.devices["zone-c-school-holidays"].on, "boolean");
  });
});

test("Status, Cron, and Admin routes validate inputs and auth", async () => {
  setupTestEnv();

  await withMockIcsFetch(async () => {
    const badDateRes = await statusGet(
      new NextRequest("https://app.example.com/api/status?date=2026-99-99"),
    );
    assert.equal(badDateRes.status, 400);

    const satRes = await statusGet(
      new NextRequest("https://app.example.com/api/status?date=2026-10-17"),
    );
    assert.equal(satRes.status, 200);
    const satJson = (await satRes.json()) as { current: { isOn: boolean; reason: string } };
    assert.equal(satJson.current.isOn, false);
    assert.equal(satJson.current.reason, "first_saturday_excluded");

    const monRes = await statusGet(
      new NextRequest("https://app.example.com/api/status?date=2026-10-19"),
    );
    assert.equal(monRes.status, 200);
    const monJson = (await monRes.json()) as { current: { isOn: boolean; reason: string } };
    assert.equal(monJson.current.isOn, true);
    assert.equal(monJson.current.reason, "holiday_active");

    const cronUnauth = await cronGet(new NextRequest("https://app.example.com/api/cron"));
    assert.equal(cronUnauth.status, 401);

    const cronAuth = await cronGet(
      new NextRequest("https://app.example.com/api/cron", {
        headers: { Authorization: "Bearer route-cron-secret-1234" },
      }),
    );
    assert.equal(cronAuth.status, 200);
    const cronJson = (await cronAuth.json()) as { ok: boolean; homeGraphConfigured: boolean };
    assert.equal(cronJson.ok, true);
    assert.equal(cronJson.homeGraphConfigured, false);
  });

  const adminBadPwd = await adminSyncPost(
    new NextRequest("https://app.example.com/api/admin/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong", action: "report_state" }),
    }),
  );
  assert.equal(adminBadPwd.status, 401);

  const adminNoHg = await adminSyncPost(
    new NextRequest("https://app.example.com/api/admin/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "route-admin-password", action: "report_state" }),
    }),
  );
  assert.equal(adminNoHg.status, 400);
});

test("Admin session cookie auth and switch test override affect Smart Home QUERY and reset on Cron", async () => {
  setupTestEnv();
  resetMemoryOverridesForTests();

  // 1. Unauthenticated /api/admin/switch fails with 401
  const unauthSwitch = await adminSwitchPost(
    new NextRequest("https://app.example.com/api/admin/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "on" }),
    }),
  );
  assert.equal(unauthSwitch.status, 401);

  // 2. Bad login fails with 401
  const badLogin = await adminLoginPost(
    new NextRequest("https://app.example.com/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    }),
  );
  assert.equal(badLogin.status, 401);

  // 3. Valid login sets signed HttpOnly cookie
  const goodLogin = await adminLoginPost(
    new NextRequest("https://app.example.com/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "route-admin-password" }),
    }),
  );
  assert.equal(goodLogin.status, 200);
  const sessionCookie = goodLogin.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  assert.ok(sessionCookie);

  const { access_token } = createAccessAndRefreshTokens({
    clientId: "route-client-id",
    agentUserId: "zone-c-user-1",
    includeRefreshToken: false,
  });

  await withMockIcsFetch(async () => {
    // 4. Force ON using session cookie
    const forceOnRes = await adminSwitchPost(
      new NextRequest("https://app.example.com/api/admin/switch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${ADMIN_SESSION_COOKIE}=${sessionCookie}`,
        },
        body: JSON.stringify({ mode: "on" }),
      }),
    );
    assert.equal(forceOnRes.status, 200);
    const forceOnJson = (await forceOnRes.json()) as { isOn: boolean; override: { isOn: boolean } };
    assert.equal(forceOnJson.isOn, true);
    assert.equal(forceOnJson.override.isOn, true);

    // 5. Smart Home QUERY reflects override ON
    const queryOnRes = await smarthomePost(
      new NextRequest("https://app.example.com/api/smarthome", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: "req-ovr-on",
          inputs: [
            {
              intent: "action.devices.QUERY",
              payload: { devices: [{ id: "zone-c-school-holidays" }] },
            },
          ],
        }),
      }),
    );
    const queryOnJson = (await queryOnRes.json()) as {
      payload: { devices: Record<string, { on: boolean }> };
    };
    assert.equal(queryOnJson.payload.devices["zone-c-school-holidays"].on, true);

    // 6. Status endpoint exposes effectiveIsOn and override
    const statusRes = await statusGet(new NextRequest("https://app.example.com/api/status"));
    const statusJson = (await statusRes.json()) as {
      effectiveIsOn: boolean;
      override: { isOn: boolean } | null;
    };
    assert.equal(statusJson.effectiveIsOn, true);
    assert.equal(statusJson.override?.isOn, true);

    // 7. Force OFF using session cookie
    const forceOffRes = await adminSwitchPost(
      new NextRequest("https://app.example.com/api/admin/switch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${ADMIN_SESSION_COOKIE}=${sessionCookie}`,
        },
        body: JSON.stringify({ mode: "off" }),
      }),
    );
    assert.equal(forceOffRes.status, 200);

    // 8. Reset to auto mode
    const autoRes = await adminSwitchPost(
      new NextRequest("https://app.example.com/api/admin/switch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${ADMIN_SESSION_COOKIE}=${sessionCookie}`,
        },
        body: JSON.stringify({ mode: "auto" }),
      }),
    );
    assert.equal(autoRes.status, 200);
    const autoJson = (await autoRes.json()) as { mode: string; override: unknown };
    assert.equal(autoJson.mode, "auto");
    assert.equal(autoJson.override, null);

    // 9. Force ON again, then Cron clears override and marks changed if calendar differs
    await adminSwitchPost(
      new NextRequest("https://app.example.com/api/admin/switch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${ADMIN_SESSION_COOKIE}=${sessionCookie}`,
        },
        body: JSON.stringify({ mode: "on" }),
      }),
    );
    const cronRes = await cronGet(
      new NextRequest("https://app.example.com/api/cron", {
        headers: { Authorization: "Bearer route-cron-secret-1234" },
      }),
    );
    const cronJson = (await cronRes.json()) as { overrideCleared: boolean };
    assert.equal(cronJson.overrideCleared, true);
  });

  // 10. Logout clears cookie
  const logoutRes = await adminLogoutPost();
  assert.equal(logoutRes.status, 200);
  assert.equal(logoutRes.cookies.get(ADMIN_SESSION_COOKIE)?.value, "");
  resetMemoryOverridesForTests();
});
