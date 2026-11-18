# Google Home Zone C School Holidays Virtual Switch

A zero-database Next.js (TypeScript) application designed for **Vercel** that exposes a read-only **Google Home Cloud-to-cloud virtual switch** driven by the official French Ministry of Education **Zone C** school holiday calendar (`Zone-C.ics`).

## Switch Rules

Evaluated in the **`Europe/Paris`** timezone (`00:00` boundary):

- **Outside holidays** (regular school days, normal weekends, and ignored non-holiday entries such as *Rentrée scolaire* / *Prérentrée des enseignants*): switch is **OFF**.
- **During holidays** (*Vacances de la Toussaint*, *Noël*, *Hiver*, *Printemps*, *Été*, and *Pont de l'Ascension*):
  - **1st Saturday & 1st Sunday** inside each holiday period: switch is **OFF**.
  - **All remaining days** of the holiday period (including any 2nd/3rd weekends): switch is **ON**.

## Endpoints

- `/` — Live switch status dashboard, upcoming Zone C periods, date simulator, admin login, test switch override controls, and manual HomeGraph sync controls.
- `/oauth/authorize` — Single-user OAuth 2.0 authorization page for Google Home account linking.
- `/api/oauth/token` — OAuth 2.0 token exchange (`authorization_code` and `refresh_token`).
- `/api/smarthome` — Google Home Cloud-to-cloud Fulfillment (`SYNC`, `QUERY`, `EXECUTE`, `DISCONNECT`).
- `/api/cron` — Target for the daily **Vercel Schedule** (`0 2 * * *` `Europe/Paris`, 15-minute jitter in `vercel.json`) that clears any temporary test override and calls HomeGraph `reportStateAndNotification` whenever the state transitions.
- `/api/status` — Public JSON status (`?date=YYYY-MM-DD` optional).
- `/api/admin/login`, `/api/admin/logout` — `ADMIN_PASSWORD` session cookie login/logout for the dashboard.
- `/api/admin/switch` — Authenticated endpoint to force the virtual switch `on`, `off`, or reset back to `auto` (Zone C calendar) and push the state to HomeGraph.
- `/api/admin/sync` — Authenticated endpoint to trigger `report_state` or `request_sync` on demand.

---

## Deployment & Google Home Setup Guide

### 1. Generate Random Secrets

You will need random strings for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_SIGNING_SECRET`, `ADMIN_PASSWORD`, and `CRON_SECRET` (none of these come from Google — you create them yourself and share `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` with the Google Home Developer Console in Step 4).

> Use URL- and HTTP-header-safe characters only (hex `0-9a-f` or `base64url`, no spaces or quotes), especially for `CRON_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`.

**Option A — Generate all 5 at once with Node.js (Windows, macOS, Linux):**

```bash
node -e "const c = require('crypto'); for (const [k, n] of [['GOOGLE_CLIENT_ID', 16], ['GOOGLE_CLIENT_SECRET', 32], ['OAUTH_SIGNING_SECRET', 32], ['ADMIN_PASSWORD', 24], ['CRON_SECRET', 32]]) console.log(k + '=' + c.randomBytes(n).toString('hex'))"
```

*(If you want an easier-to-type password on mobile for `ADMIN_PASSWORD`, replace its generated value with your own strong passphrase.)*

**Option B — Generate one value at a time:**

- **Node.js (any OS):**
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- **Windows PowerShell (`pwsh`):**
  ```powershell
  $bytes = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes); ([BitConverter]::ToString($bytes) -replace '-','').ToLower()
  ```
- **OpenSSL (macOS, Linux, Git Bash):**
  ```bash
  openssl rand -hex 32
  ```
  *(Use `16` bytes instead of `32` if you want a shorter `GOOGLE_CLIENT_ID`.)*

### 2. Deploy to Vercel

1. Push this repository to GitHub/GitLab/Bitbucket and import it into **Vercel** (Hobby plan works).
2. Configure these Environment Variables in **Vercel Project → Settings → Environment Variables** using the values generated above:

| Variable | Description |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Random string you created (also pasted into Google Home Account Linking) |
| `GOOGLE_CLIENT_SECRET` | Random string you created (also pasted into Google Home Account Linking) |
| `OAUTH_SIGNING_SECRET` | Random secret (32+ chars) used to sign stateless OAuth codes & tokens |
| `ADMIN_PASSWORD` | Password used on `/oauth/authorize` and dashboard HomeGraph controls |
| `CRON_SECRET` | Random alphanumeric/hex secret sent automatically by Vercel Cron (`Authorization: Bearer <CRON_SECRET>`) |
| `GOOGLE_PROJECT_ID` | *(Optional)* Your Google Home project ID to lock OAuth `redirect_uri` strictly |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Single-line (or base64) JSON key for a Google Cloud Service Account with HomeGraph API enabled |
| `DEVICE_NAME` | *(Optional)* Display name in Google Home (defaults to `Vacances Scolaires Zone C`) |

3. Deploy so you get your production URL, e.g. `https://your-app.vercel.app`.

### 3. Enable HomeGraph API & Create a Service Account

> **Important:** Make sure you create a **Service Account** JSON key (which contains `"type": "service_account"`, `"client_email"`, and `"private_key"`), **not** an OAuth 2.0 Client ID JSON (`{"installed": ...}` or `{"web": ...}` from *APIs & Services → Credentials*).

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select/create your project.
2. Enable **HomeGraph API** (**APIs & Services → Library → HomeGraph API → Enable**).
3. Go to **IAM & Admin → Service Accounts → Create Service Account**, enter a name, and under **Permissions (Role)** select **Service Accounts → Service Account OpenID Connect Identity Token Creator** (`roles/iam.serviceAccountOpenIdTokenCreator`), then click **Done** (no extra user access in step 3 is needed).
4. Open the created Service Account → **Keys → Add Key → Create new key → JSON** and download the `.json` file.
5. Minify the downloaded JSON file onto a single line (or encode it as base64) before pasting it into `GOOGLE_SERVICE_ACCOUNT_JSON` in Vercel (or unquoted / single-quoted in `.env` — never double-quoted `"{...}"`):
   ```bash
   node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('service-account.json', 'utf8'))))"
   ```
   *(Or base64-encoded, which is also accepted directly and avoids shell/env quoting issues:)*
   ```bash
   node -e "console.log(require('fs').readFileSync('service-account.json').toString('base64'))"
   ```
6. Redeploy on Vercel after adding `GOOGLE_SERVICE_ACCOUNT_JSON` (or restart `npm run dev` if editing `.env` / `.env.local` locally).

### 4. Create the Google Home Cloud-to-cloud Integration

1. Open the [Google Home Developer Console](https://console.home.google.com/) and open the **same Google Cloud project**.
2. Create a **Cloud-to-cloud** integration (no public certification/publishing is required for private personal use):
   - **Integration name**: Choose any descriptive display name for your integration (for example `Vacances Scolaires Zone C` or `Zone C Holidays`; avoid including `"Google"` in the name). This is only the name shown under **Works with Google Home** when linking (prefixed with `[test]`), and does not need to match any environment variable (the switch device's own name in Google Home comes from `DEVICE_NAME`).
   - **Device type**: Switch (`OnOff`).
   - **App branding**: Upload the included `144×144` px transparent PNG icon [`public/icon-144.png`](public/icon-144.png) (required by the console form, even for private test mode).
   - **Cloud fulfillment URL**: `https://your-app.vercel.app/api/smarthome`
3. Under **Account linking (OAuth 2.0)**:
   - **Client ID**: matches `GOOGLE_CLIENT_ID`
   - **Client secret**: matches `GOOGLE_CLIENT_SECRET`
   - **Authorization URL**: `https://your-app.vercel.app/oauth/authorize`
   - **Token URL**: `https://your-app.vercel.app/api/oauth/token`
   - **Scope**: `smarthome` (any value is accepted)
4. Save and click **Test** in the Google Home Developer Console.

### 5. Link in the Google Home App

1. On your phone, open **Google Home** (signed in with the same Google account that owns the Developer Console project).
2. Tap **Devices → + Add → Works with Google Home**.
3. Search for `[test] <Your Integration Name>`, enter your `ADMIN_PASSWORD` on the `/oauth/authorize` screen, and approve.
4. Return to `https://your-app.vercel.app/`, sign in under **Admin & Google Home Control** with `ADMIN_PASSWORD`, and click **Report State Now** to seed the initial state in HomeGraph.
5. *(Optional testing)* While signed in, you can use **Force ON** / **Force OFF** to temporarily override the switch and verify the state updates in the Google Home app (and test Automations), then click **Reset to Calendar (Auto)**. Overrides also auto-expire after 12 hours or when `/api/cron` runs. *(On Vercel, if you want `QUERY` intents on fresh cold-started instances to see test overrides too, optionally configure `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` or `KV_REST_API_URL` + `KV_REST_API_TOKEN`.)*

### 6. Using the Switch in Google Home Automations

- Because `willReportState` is `true` on a standard `SWITCH` (`queryOnlyOnOff: false`), the Google Home mobile tile opens cleanly without crashing and you can use the switch as a **Starter** (when it turns ON or OFF) or a **Condition** in Google Home Automations / the [Google Home Script Editor](https://home.google.com/). Any manual tap on the tile (`EXECUTE`) automatically returns the authoritative Zone C calendar (or test override) state so it stays in sync.
- **Vercel Schedule timing note:** [vercel.json](vercel.json) uses **Vercel Schedules** at `0 2 * * *` in `Europe/Paris` with `jitter: 15` (the maximum allowed by Vercel Schedules and fixed on the Hobby plan — so it runs between `02:00` and `02:15` Paris time). If you want state transitions pushed right at `00:01 Europe/Paris`, you can also trigger `POST` or `GET https://your-app.vercel.app/api/cron` with header `Authorization: Bearer <CRON_SECRET>` from an external scheduler.

---

## Local Development

```bash
cp .env.example .env.local
npm install
npm run dev
```

Run checks:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```
