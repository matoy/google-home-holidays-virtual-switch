import assert from "node:assert/strict";
import test from "node:test";
import { evaluateScheduleFromIcs } from "../src/lib/holidays";
import { getHomeGraphConfigStatus, getServiceAccountCredentials } from "../src/lib/homegraph";
import {
  createAccessAndRefreshTokens,
  createAuthorizationCode,
  extractOAuthClientCredentials,
  isAllowedGoogleRedirectUri,
  verifyOAuthToken,
} from "../src/lib/oauth";
import { handleSmartHomeIntent } from "../src/lib/smarthome";

const TEST_SECRET = "test-signing-secret-at-least-32-characters-long";

test("OAuth tokens sign, verify, and reject tampering or expiration", () => {
  process.env.OAUTH_SIGNING_SECRET = TEST_SECRET;
  process.env.GOOGLE_CLIENT_ID = "my-google-client";
  process.env.GOOGLE_CLIENT_SECRET = "my-google-secret";
  process.env.AGENT_USER_ID = "user-42";

  const now = 1_800_000_000;
  const code = createAuthorizationCode({
    clientId: "my-google-client",
    redirectUri: "https://oauth-redirect.googleusercontent.com/r/my-project",
    secret: TEST_SECRET,
    nowSeconds: now,
  });

  const verifiedCode = verifyOAuthToken(code, "code", TEST_SECRET, now + 60);
  assert.ok(verifiedCode);
  assert.equal(verifiedCode.sub, "user-42");
  assert.equal(verifiedCode.cid, "my-google-client");

  // Expired code must fail
  assert.equal(verifyOAuthToken(code, "code", TEST_SECRET, now + 301), null);
  // Wrong token type must fail
  assert.equal(verifyOAuthToken(code, "access", TEST_SECRET, now + 10), null);
  // Tampered payload/sig must fail
  assert.equal(verifyOAuthToken(`${code}x`, "code", TEST_SECRET, now + 10), null);

  const tokens = createAccessAndRefreshTokens({
    clientId: "my-google-client",
    agentUserId: "user-42",
    secret: TEST_SECRET,
    nowSeconds: now,
  });
  assert.ok(tokens.refresh_token);
  assert.ok(verifyOAuthToken(tokens.access_token, "access", TEST_SECRET, now + 100));
  assert.equal(verifyOAuthToken(tokens.access_token, "access", TEST_SECRET, now + 3601), null);
  assert.ok(verifyOAuthToken(tokens.refresh_token, "refresh", TEST_SECRET, now + 86400 * 365));
});

test("isAllowedGoogleRedirectUri accepts official Google redirect hosts and blocks arbitrary URLs", () => {
  assert.equal(
    isAllowedGoogleRedirectUri("https://oauth-redirect.googleusercontent.com/r/proj-123", ""),
    true,
  );
  assert.equal(
    isAllowedGoogleRedirectUri(
      "https://oauth-redirect-sandbox.googleusercontent.com/r/proj-123",
      "proj-123",
    ),
    true,
  );
  assert.equal(
    isAllowedGoogleRedirectUri("https://oauth-redirect.googleusercontent.com/r/other", "proj-123"),
    false,
  );
  assert.equal(isAllowedGoogleRedirectUri("https://evil.example.com/r/proj-123", ""), false);
  assert.equal(
    isAllowedGoogleRedirectUri("http://oauth-redirect.googleusercontent.com/r/proj-123", ""),
    false,
  );
});

test("extractOAuthClientCredentials handles both Basic Auth and form body", () => {
  const basicHeader = `Basic ${Buffer.from("id%2B1:sec%3Aret").toString("base64")}`;
  const fromBasic = extractOAuthClientCredentials(basicHeader, new URLSearchParams());
  assert.deepEqual(fromBasic, { clientId: "id+1", clientSecret: "sec:ret" });

  const form = new URLSearchParams({ client_id: "c1", client_secret: "s1" });
  const fromForm = extractOAuthClientCredentials(null, form);
  assert.deepEqual(fromForm, { clientId: "c1", clientSecret: "s1" });
});

test("Smart Home intents SYNC, QUERY, EXECUTE, and DISCONNECT adhere to Google schema", async () => {
  process.env.DEVICE_ID = "zone-c-school-holidays";
  process.env.DEVICE_NAME = "Vacances Scolaires Zone C";
  process.env.AGENT_USER_ID = "zone-c-user-1";

  const fakeIcs = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:test-toussaint",
    "DTSTART;VALUE=DATE:20261017",
    "DTEND;VALUE=DATE:20261102",
    "SUMMARY:Vacances de la Toussaint",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const syncRes = (await handleSmartHomeIntent({
    requestId: "req-sync",
    inputs: [{ intent: "action.devices.SYNC" }],
  })) as {
    requestId: string;
    payload: {
      agentUserId: string;
      devices: Array<{
        id: string;
        type: string;
        traits: string[];
        willReportState: boolean;
        attributes: { queryOnlyOnOff: boolean; commandOnlyOnOff: boolean };
      }>;
    };
  };

  assert.equal(syncRes.requestId, "req-sync");
  assert.equal(syncRes.payload.agentUserId, "zone-c-user-1");
  assert.equal(syncRes.payload.devices.length, 1);
  assert.equal(syncRes.payload.devices[0].id, "zone-c-school-holidays");
  assert.equal(syncRes.payload.devices[0].type, "action.devices.types.SWITCH");
  assert.deepEqual(syncRes.payload.devices[0].traits, ["action.devices.traits.OnOff"]);
  assert.equal(syncRes.payload.devices[0].willReportState, true);
  assert.equal(syncRes.payload.devices[0].attributes.queryOnlyOnOff, false);

  const queryRes = (await handleSmartHomeIntent(
    {
      requestId: "req-query",
      inputs: [
        {
          intent: "action.devices.QUERY",
          payload: { devices: [{ id: "zone-c-school-holidays" }, { id: "unknown-id" }] },
        },
      ],
    },
    {
      getSnapshot: async () => evaluateScheduleFromIcs(fakeIcs, { targetDate: "2026-10-20" }),
    },
  )) as {
    requestId: string;
    payload: { devices: Record<string, Record<string, unknown>> };
  };

  assert.deepEqual(queryRes.payload.devices["zone-c-school-holidays"], {
    online: true,
    status: "SUCCESS",
    on: true,
  });
  assert.deepEqual(queryRes.payload.devices["unknown-id"], {
    online: false,
    status: "ERROR",
    errorCode: "deviceNotFound",
  });

  const executeRes = (await handleSmartHomeIntent(
    {
      requestId: "req-exec",
      inputs: [
        {
          intent: "action.devices.EXECUTE",
          payload: {
            commands: [
              {
                devices: [{ id: "zone-c-school-holidays" }],
                execution: [{ command: "action.devices.commands.OnOff", params: { on: false } }],
              },
            ],
          },
        },
      ],
    },
    {
      getSnapshot: async () => evaluateScheduleFromIcs(fakeIcs, { targetDate: "2026-10-20" }),
    },
  )) as {
    requestId: string;
    payload: {
      commands: Array<{
        ids: string[];
        status: string;
        states?: { online: boolean; on: boolean };
      }>;
    };
  };

  assert.deepEqual(executeRes.payload.commands, [
    {
      ids: ["zone-c-school-holidays"],
      status: "SUCCESS",
      states: {
        online: true,
        on: true,
      },
    },
  ]);

  const disconnectRes = await handleSmartHomeIntent({
    requestId: "req-disc",
    inputs: [{ intent: "action.devices.DISCONNECT" }],
  });
  assert.deepEqual(disconnectRes, {});
});

test("HomeGraph Service Account parser validates Service Account JSON and rejects OAuth Client JSON", () => {
  const prevJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const prevEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const prevKey = process.env.GOOGLE_PRIVATE_KEY;

  try {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_CLIENT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;

    assert.deepEqual(getHomeGraphConfigStatus(), { configured: false, error: null });

    // OAuth Client ID ("installed") JSON must report a helpful error
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      installed: { client_id: "123.apps.googleusercontent.com", client_secret: "secret" },
    });
    const oauthJsonStatus = getHomeGraphConfigStatus();
    assert.equal(oauthJsonStatus.configured, false);
    assert.ok(oauthJsonStatus.error?.includes("OAuth Client ID JSON"));

    // Valid single-line Service Account JSON
    const validSa = JSON.stringify({
      type: "service_account",
      client_email: "homegraph@proj.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n",
    });
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = validSa;
    assert.deepEqual(getHomeGraphConfigStatus(), { configured: true, error: null });
    assert.equal(
      getServiceAccountCredentials()?.clientEmail,
      "homegraph@proj.iam.gserviceaccount.com",
    );
    assert.ok(getServiceAccountCredentials()?.privateKey.includes("\nABC\n"));

    // Valid base64-encoded Service Account JSON
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = Buffer.from(validSa, "utf8").toString("base64");
    assert.deepEqual(getHomeGraphConfigStatus(), { configured: true, error: null });
  } finally {
    if (prevJson === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prevJson;
    if (prevEmail === undefined) delete process.env.GOOGLE_CLIENT_EMAIL;
    else process.env.GOOGLE_CLIENT_EMAIL = prevEmail;
    if (prevKey === undefined) delete process.env.GOOGLE_PRIVATE_KEY;
    else process.env.GOOGLE_PRIVATE_KEY = prevKey;
  }
});
