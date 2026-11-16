export const DEFAULT_CALENDAR_ICS_URL =
  "https://fr.ftp.opendatasoft.com/openscol/fr-en-calendrier-scolaire/Zone-C.ics";
export const PARIS_TIMEZONE = "Europe/Paris";
export const DEFAULT_DEVICE_ID = "zone-c-school-holidays";
export const DEFAULT_DEVICE_NAME = "Vacances Scolaires Zone C";
export const DEFAULT_AGENT_USER_ID = "zone-c-user-1";

export interface AppConfig {
  calendarIcsUrl: string;
  deviceId: string;
  deviceName: string;
  agentUserId: string;
  googleClientId: string;
  googleClientSecret: string;
  googleProjectId: string;
  oauthSigningSecret: string;
  adminPassword: string;
  cronSecret: string;
}

export function getAppConfig(): AppConfig {
  return {
    calendarIcsUrl: process.env.CALENDAR_ICS_URL?.trim() || DEFAULT_CALENDAR_ICS_URL,
    deviceId: process.env.DEVICE_ID?.trim() || DEFAULT_DEVICE_ID,
    deviceName: process.env.DEVICE_NAME?.trim() || DEFAULT_DEVICE_NAME,
    agentUserId: process.env.AGENT_USER_ID?.trim() || DEFAULT_AGENT_USER_ID,
    googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || "",
    googleProjectId: process.env.GOOGLE_PROJECT_ID?.trim() || "",
    oauthSigningSecret: process.env.OAUTH_SIGNING_SECRET?.trim() || "",
    adminPassword: process.env.ADMIN_PASSWORD || "",
    cronSecret: process.env.CRON_SECRET?.trim() || "",
  };
}

export function requireEnvValue(value: string, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
