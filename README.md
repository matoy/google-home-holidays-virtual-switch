# Google Home Zone C School Holidays Virtual Switch

A zero-database Next.js (TypeScript) application designed for **Vercel** that exposes a read-only **Google Home Cloud-to-cloud virtual switch** driven by the official French Ministry of Education **Zone C** school holiday calendar (`Zone-C.ics`).

## Switch Rules

Evaluated in the **`Europe/Paris`** timezone (`00:00` boundary):

- **Outside holidays** (regular school days, normal weekends, and ignored non-holiday entries such as *Rentrée scolaire* / *Prérentrée des enseignants*): switch is **OFF**.
- **During holidays** (*Vacances de la Toussaint*, *Noël*, *Hiver*, *Printemps*, *Été*, and *Pont de l'Ascension*):
  - **1st Saturday & 1st Sunday** inside each holiday period: switch is **OFF**.
  - **All remaining days** of the holiday period (including any 2nd/3rd weekends): switch is **ON**.

## Endpoints

- `/` — Live switch status dashboard, upcoming Zone C periods, date simulator, and manual HomeGraph sync controls.
- `/oauth/authorize` — Single-user OAuth 2.0 authorization page for Google Home account linking.
- `/api/oauth/token` — OAuth 2.0 token exchange (`authorization_code` and `refresh_token`).
- `/api/smarthome` — Google Home Cloud-to-cloud Fulfillment (`SYNC`, `QUERY`, `EXECUTE`, `DISCONNECT`).
- `/api/cron` — Scheduled daily check (`5 0 * * *` UTC in `vercel.json`) that calls HomeGraph `reportStateAndNotification` whenever the state transitions day-over-day (or with `?force=1`).
- `/api/status` — Public JSON status (`?date=YYYY-MM-DD` optional).
- `/api/admin/sync` — Admin endpoint (`ADMIN_PASSWORD`) to trigger `report_state` or `request_sync` on demand.

---

## Deployment & Google Home Setup Guide

### 1. Deploy to Vercel

1. Push this repository to GitHub/GitLab/Bitbucket and import it into **Vercel** (Hobby plan works).
2. Generate random secrets (for example with `openssl rand -hex 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
3. Configure these Environment Variables in **Vercel Project → Settings → Environment Variables**:

| Variable | Description |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Random string you create and paste into Google Home Account Linking |
| `GOOGLE_CLIENT_SECRET` | Random string you create and paste into Google Home Account Linking |
| `OAUTH_SIGNING_SECRET` | Random secret (32+ chars) used to sign stateless OAuth codes & tokens |
| `ADMIN_PASSWORD` | Password used on `/oauth/authorize` and dashboard HomeGraph controls |
| `CRON_SECRET` | Random alphanumeric secret sent automatically by Vercel Cron (`Authorization: Bearer <CRON_SECRET>`) |
| `GOOGLE_PROJECT_ID` | *(Optional)* Your Google Home project ID to lock OAuth `redirect_uri` strictly |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Single-line JSON key for a Google Cloud Service Account with HomeGraph API enabled |
| `DEVICE_NAME` | *(Optional)* Display name in Google Home (defaults to `Vacances Scolaires Zone C`) |

4. Deploy so you get your production URL, e.g. `https://your-app.vercel.app`.

### 2. Enable HomeGraph API & Create a Service Account

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select/create your project.
2. Enable **HomeGraph API** (**APIs & Services → Library → HomeGraph API → Enable**).
3. Go to **IAM & Admin → Service Accounts → Create Service Account**.
4. Open the created Service Account → **Keys → Add Key → Create new key → JSON**.
5. Paste the downloaded JSON content (minified onto one line) into `GOOGLE_SERVICE_ACCOUNT_JSON` in Vercel and redeploy.

### 3. Create the Google Home Cloud-to-cloud Integration

1. Open the [Google Home Developer Console](https://console.home.google.com/) and open the **same Google Cloud project**.
2. Create a **Cloud-to-cloud** integration (no public certification/publishing is required for private personal use):
   - **Device type**: Switch (`OnOff`).
   - **Cloud fulfillment URL**: `https://your-app.vercel.app/api/smarthome`
3. Under **Account linking (OAuth 2.0)**:
   - **Client ID**: matches `GOOGLE_CLIENT_ID`
   - **Client secret**: matches `GOOGLE_CLIENT_SECRET`
   - **Authorization URL**: `https://your-app.vercel.app/oauth/authorize`
   - **Token URL**: `https://your-app.vercel.app/api/oauth/token`
   - **Scope**: `smarthome` (any value is accepted)
4. Save and click **Test** in the Google Home Developer Console.

### 4. Link in the Google Home App

1. On your phone, open **Google Home** (signed in with the same Google account that owns the Developer Console project).
2. Tap **Devices → + Add → Works with Google Home**.
3. Search for `[test] <Your Integration Name>`, enter your `ADMIN_PASSWORD` on the `/oauth/authorize` screen, and approve.
4. Return to `https://your-app.vercel.app/`, enter `ADMIN_PASSWORD` in **Google HomeGraph Control**, and click **Report State Now** to seed the initial state in HomeGraph.

### 5. Using the Switch in Google Home Automations

- Because `queryOnlyOnOff` is `true` and `willReportState` is `true`, you can use the switch as a **Starter** (when it turns ON or OFF) or a **Condition** in Google Home Automations / the [Google Home Script Editor](https://home.google.com/).
- **Vercel Hobby Cron timing note:** Vercel Hobby runs `5 0 * * *` (`00:05 UTC`) within a ~1-hour window (`01:05–02:05` CET / `02:05–03:05` CEST). If you want state transitions pushed right at `00:01 Europe/Paris`, configure a free external scheduler (e.g. GitHub Actions or cron-job.org) to `GET https://your-app.vercel.app/api/cron` with header `Authorization: Bearer <CRON_SECRET>`.

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
