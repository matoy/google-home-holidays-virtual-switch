import { getAppConfig } from "@/lib/config";
import { isAllowedGoogleRedirectUri, validateOAuthClient } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AuthorizePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function OAuthAuthorizePage({ searchParams }: AuthorizePageProps) {
  const params = await searchParams;
  const config = getAppConfig();

  const clientId = pickString(params.client_id);
  const redirectUri = pickString(params.redirect_uri);
  const responseType = pickString(params.response_type);
  const state = pickString(params.state);
  const errorParam = pickString(params.error);

  const isClientValid = validateOAuthClient(clientId);
  const isRedirectValid = isAllowedGoogleRedirectUri(redirectUri);
  const isResponseTypeValid = responseType === "code";
  const isServerConfigured = Boolean(
    config.googleClientId &&
      config.googleClientSecret &&
      config.oauthSigningSecret &&
      config.adminPassword,
  );

  let validationError: string | null = null;
  if (!isServerConfigured) {
    validationError =
      "Server OAuth environment variables are incomplete (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_SIGNING_SECRET, ADMIN_PASSWORD).";
  } else if (!isResponseTypeValid) {
    validationError = `Unsupported response_type: "${responseType || "(missing)"}". Expected "code".`;
  } else if (!isClientValid) {
    validationError = "Unknown client_id. Verify GOOGLE_CLIENT_ID matches the Google Home Developer Console.";
  } else if (!isRedirectValid) {
    validationError =
      "Invalid redirect_uri. Only official Google Home OAuth redirect URLs are allowed.";
  }

  return (
    <main className="auth-container">
      <section className="card auth-card">
        <h1>Link to Google Home</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: "1rem" }}>
          Authorize Google Home to read your <strong>{config.deviceName}</strong> virtual switch.
        </p>

        {validationError ? (
          <div className="alert alert-error">{validationError}</div>
        ) : (
          <form method="POST" action="/api/oauth/authorize">
            {errorParam === "invalid_password" && (
              <div className="alert alert-error">
                Incorrect admin password. Please try again.
              </div>
            )}

            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="redirect_uri" value={redirectUri} />
            <input type="hidden" name="response_type" value={responseType} />
            <input type="hidden" name="state" value={state} />

            <div className="field">
              <label htmlFor="password">Admin Password</label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                placeholder="Enter ADMIN_PASSWORD"
              />
            </div>

            <button type="submit" className="btn-primary" style={{ width: "100%" }}>
              Authorize &amp; Link Account
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
